#!/usr/bin/env python3
"""Build a label map of the Zero Adjustment pans, so each can be selected.

Selecting individual pans cannot be done with whole-screen artwork — that would
need one image per combination. Instead the shapes are found once, here, and
written out as a label map: a greyscale PNG where a pixel's value says which pan
it belongs to (1-14 for the weigh hoppers, 15 for the dispersion pan, 0 for
everything else).

The app decodes it once and uses it for both jobs: hit-testing a tap (look up
the label under the cursor) and recolouring (tint the pixels whose label is
selected). One small lossless file, and the picture and the hit areas can never
disagree because they come from the same data.

Keying on the WALLPAPER is what makes the shapes solid: the pans' own shaded
interiors are noisy after JPEG and a colour-keyed mask comes out full of
pinholes, while the purple behind them is flat.

    python3 tools/hopper_masks.py public/screens/zero-adjust.jpg public/masks
"""
import json
import os
import sys

import numpy as np
from PIL import Image

WALLPAPER = (125, 132, 238)
TOP_BAR, BOTTOM_BAR = 40, 440
# The dispersion pan, measured on the artwork and checked by drawing it back.
TABLE = {'cx': 420, 'cy': 233, 'rx': 148, 'ry': 70}
TABLE_LABEL = 15


def shape_mask(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    br, bg, bb = WALLPAPER
    wall = (abs(r - br) < 26) & (abs(g - bg) < 26) & (abs(b - bb) < 26)
    m = ~wall
    m[:TOP_BAR, :] = False
    m[BOTTOM_BAR:, :] = False
    return m


def numeral_seeds(rgb):
    """The circled head numbers — one per pan, and they are the seeds.

    Connected components on the pans themselves does NOT work: adjacent pans
    touch in the ring and merge, giving seven blobs for fourteen hoppers. But
    every pan carries its own circled numeral, and those are unmistakable —
    blue ink, 15x15, square aspect. Fifteen of them: fourteen hoppers and the
    dispersion pan's own.
    """
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    ink = (r < 130) & (g < 130) & (b > 120) & (b - r > 55)
    ink[:45, :] = False
    ink[BOTTOM_BAR:, :] = False

    seen = np.zeros_like(ink)
    h, w = ink.shape
    seeds = []
    for sy in range(h):
        for sx in range(w):
            if not ink[sy, sx] or seen[sy, sx]:
                continue
            stack, pts = [(sy, sx)], []
            seen[sy, sx] = True
            while stack:
                y, x = stack.pop()
                pts.append((y, x))
                for ny, nx in ((y+1, x), (y-1, x), (y, x+1), (y, x-1),
                               (y+1, x+1), (y-1, x-1), (y+1, x-1), (y-1, x+1)):
                    if 0 <= ny < h and 0 <= nx < w and ink[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            ys = [q[0] for q in pts]
            xs = [q[1] for q in pts]
            bw, bh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
            # The circled numeral: square, and about 15px across.
            if 13 <= bw <= 17 and 13 <= bh <= 17 and len(pts) >= 40:
                seeds.append((int(np.mean(xs)), int(np.mean(ys))))
    return seeds


def main(src, outdir):
    rgb = np.asarray(Image.open(src).convert('RGB')).astype(int)
    mask = shape_mask(rgb)

    h, w = mask.shape
    yy, xx = np.mgrid[0:h, 0:w]
    inside = (((xx - TABLE['cx']) / TABLE['rx']) ** 2
              + ((yy - TABLE['cy']) / TABLE['ry']) ** 2) <= 1.0

    seeds = numeral_seeds(rgb)
    ring_seeds = [s for s in seeds if not inside[s[1], s[0]]]
    print('numerals found: %d total, %d on the ring' % (len(seeds), len(ring_seeds)))
    if len(ring_seeds) != 14:
        raise SystemExit('expected 14 ring numerals, found %d' % len(ring_seeds))

    # Number them the way the machine prints them: head 1 at the bottom, right
    # of centre, then counter-clockwise around the ring.
    cx, cy = TABLE['cx'], TABLE['cy']
    def ang(s):
        return (np.degrees(np.arctan2(s[1] - cy, s[0] - cx)) + 360) % 360
    start = min(ring_seeds, key=lambda s: abs(ang(s) - 53))
    base = ang(start)
    # 1 -> 2 goes to the RIGHT and UP from the bottom of the ring, which is
    # DECREASING angle in screen coordinates. Sorting the other way numbers the
    # ring backwards and puts 2 where 14 belongs.
    ordered = sorted(ring_seeds, key=lambda s: (base - ang(s)) % 360)

    # Every pan pixel goes to its nearest numeral. The pans are a ring of
    # similar shapes each carrying its own label, so nearest-seed follows their
    # outlines closely, and it does not care that they touch.
    labels = np.zeros(mask.shape, dtype=np.uint8)
    labels[mask & inside] = TABLE_LABEL

    ring = mask & ~inside
    ys, xs = np.nonzero(ring)
    sx = np.array([s[0] for s in ordered])
    sy = np.array([s[1] for s in ordered])
    d = (xs[:, None] - sx[None, :]) ** 2 + (ys[:, None] - sy[None, :]) ** 2
    labels[ys, xs] = np.argmin(d, axis=1).astype(np.uint8) + 1

    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, 'zero-adjust-labels.png')
    Image.fromarray(labels).save(path, optimize=True)

    meta = [{'no': i + 1, 'cx': int(s[0]), 'cy': int(s[1]),
             'px': int((labels == i + 1).sum())} for i, s in enumerate(ordered)]
    table_seed = next((s for s in seeds if inside[s[1], s[0]]), None)
    json.dump({'table': {'label': TABLE_LABEL,
                         'cx': table_seed[0] if table_seed else TABLE['cx'],
                         'cy': table_seed[1] if table_seed else TABLE['cy'],
                         'px': int((labels == TABLE_LABEL).sum())},
               'pans': meta},
              open(os.path.join(outdir, 'zero-adjust-labels.json'), 'w'), indent=1)
    print('wrote %s (%d bytes)' % (path, os.path.getsize(path)))
    for m in meta:
        print('  pan %2d  numeral at (%3d,%3d)  %5d px' % (m['no'], m['cx'], m['cy'], m['px']))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
