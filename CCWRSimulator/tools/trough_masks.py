#!/usr/bin/env python3
"""Label the radial-trough wedges on the Production feeder screen.

Selecting a head turns its whole wedge blue, so each wedge needs its own
region. The pans on Zero Adjustment could be found by colour — they sit on flat
purple wallpaper — but these wedges are grey on a grey panel, and the two
overlap in luminance. So geometry does the work instead: the wedges radiate
from the central cone, and each head's numeral gives the angle of its own
wedge, so every pixel goes to the sector its angle falls in.

The panel background is a flat 204 or 212 with r == g == b exactly, which is
what separates it from the wedges — those are shaded and never that uniform.

    python3 tools/trough_masks.py public/screens/run-feeder.jpg public/masks
"""
import json
import os
import sys

import numpy as np
from PIL import Image

# The numerals printed on the wedges, in the machine's own order. Found as white
# circled glyphs and checked by drawing the numbering back over the artwork.
NUMERALS = [(219, 355), (275, 335), (304, 286), (316, 241), (297, 203),
            (264, 172), (211, 160), (157, 160), (105, 172), (71, 203),
            (55, 241), (66, 286), (96, 335), (151, 355)]

PANEL = (20, 85, 392, 406)      # the trough picture's own frame
INNER, OUTER = 46, 168          # the cone, and past the wedge tips
BG_LEVELS = (204, 212)          # flat panel greys
BG_TOL = 3


def main(src, outdir):
    rgb = np.asarray(Image.open(src).convert('RGB')).astype(int)
    h, w = rgb.shape[:2]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]

    cx = sum(p[0] for p in NUMERALS) / len(NUMERALS)
    cy = sum(p[1] for p in NUMERALS) / len(NUMERALS)

    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.hypot(xx - cx, yy - cy)

    inside = np.zeros((h, w), dtype=bool)
    x0, y0, x1, y1 = PANEL
    inside[y0:y1, x0:x1] = True
    ring = inside & (dist > INNER) & (dist < OUTER)

    # Flat panel grey, to be left alone.
    flat = (r == g) & (g == b)
    background = np.zeros((h, w), dtype=bool)
    for level in BG_LEVELS:
        background |= flat & (abs(r - level) <= BG_TOL)

    wedges = ring & ~background

    # Every wedge pixel goes to the head whose numeral shares its angle.
    ang = np.degrees(np.arctan2(yy - cy, xx - cx))
    seed_ang = np.array([np.degrees(np.arctan2(p[1] - cy, p[0] - cx)) for p in NUMERALS])

    ys, xs = np.nonzero(wedges)
    d = np.abs(((ang[ys, xs][:, None] - seed_ang[None, :]) + 180) % 360 - 180)
    labels = np.zeros((h, w), dtype=np.uint8)
    labels[ys, xs] = np.argmin(d, axis=1).astype(np.uint8) + 1

    # Head 1's wedge is baked BLUE in this capture — the real program had it
    # selected. Left alone it would read as permanently selected, so a
    # neutralised base is written where NOTHING is selected, and the app tints
    # up from that. Only genuinely blue pixels are touched, and only out in the
    # wedge annulus: the disc carries a blue numeral of its own, and the
    # anti-aliased background at a wedge's edge turns into a white halo if the
    # map is let loose on it.
    blue_ink = ring & ((b - r) > 40) & (b > 90)
    lum = rgb.mean(axis=2)
    others = wedges & ~blue_ink
    if blue_ink.sum() and others.sum():
        l1, l2 = lum[blue_ink], lum[others]
        k = l2.std() / l1.std()
        c = l2.mean() - k * l1.mean()
        neutral = rgb.astype(float).copy()
        grey = np.clip(lum[blue_ink] * k + c, 0, 255)
        for ch in range(3):
            neutral[..., ch][blue_ink] = grey
        print('de-tinted %d baked-blue px  (grey = lum * %.3f + %.1f)'
              % (blue_ink.sum(), k, c))
    else:
        neutral = rgb.astype(float)

    os.makedirs(outdir, exist_ok=True)
    # PNG, not JPEG: radar_chart.py reads this next and keys on exact colours,
    # which JPEG shifts just enough to miss the thin magenta trace.
    base_path = os.path.join(outdir, 'run-feeder--stage1.png')
    Image.fromarray(neutral.astype('uint8')).save(base_path)
    print('wrote', base_path)

    path = os.path.join(outdir, 'run-feeder-labels.png')
    Image.fromarray(labels).save(path, optimize=True)

    meta = [{'no': i + 1, 'cx': p[0], 'cy': p[1], 'px': int((labels == i + 1).sum())}
            for i, p in enumerate(NUMERALS)]
    json.dump({'centre': [round(cx), round(cy)], 'pans': meta},
              open(os.path.join(outdir, 'run-feeder-labels.json'), 'w'), indent=1)
    print('centre (%.0f, %.0f); wrote %s (%d bytes)' % (cx, cy, path, os.path.getsize(path)))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
