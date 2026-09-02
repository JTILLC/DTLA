#!/usr/bin/env python3
"""Make the feeder radar chart live.

Two things on it should move with the settings:

- The outer ring's fourteen numbered segments highlight blue for the heads that
  are selected. Segment 1 is baked blue in the capture, so it is neutralised
  the same way head 1's wedge was.
- The magenta trace is the AMPLITUDE, one marker per head: the higher the value
  the further out its marker sits. In the capture every head is at 50.0 and the
  trace is a perfect circle at r=61, which puts full scale (100) at r=120 — the
  inner edge of the numbered ring.
- The two printed values are erased, so the app can write the live ones.
- RF AMP's lamp is baked green. The app lights its own lamps, so it is replaced
  with the OFF lamp beside it.
- The grey squares near the middle are the TIME trace. Time reads 25.0 and they
  sit at r=30, which is the SAME scale — two independent confirmations of it.
  They are grey rather than blue because the RF Time lamp is off in the capture
  (RF AMP's lamp is green, and its trace is in colour); the legend's Time marker
  is a navy diamond, which is the "blue" it is drawn in when the lamp is lit.

Both baked traces are erased so the app can draw them where the values actually
are. Two different fills are needed:

- Outside the middle, a RADIAL median: the background there is concentric rings,
  so a pixel takes the median of its own radius and the rings come back intact.
- The time squares sit ON the fourteen radial spokes and are the same grey, so a
  radial median would rub the spokes out. The chart is 14-fold symmetric, so
  each erased pixel instead takes the median of its thirteen ROTATIONAL twins —
  the same radius and the same angle within a segment, one segment round. The
  spoke, the ring lines and the background all come back because a twin has the
  same thing at the same place.

    python3 tools/radar_chart.py public/screens/run-feeder.jpg public/masks
"""
import json
import os
import sys

import numpy as np
from PIL import Image

CENTRE = (578, 261)
RING_IN, RING_OUT = 119, 149     # the numbered outer ring
R_FULL = 120                     # radius for a value of 100
SEG1_CENTRE = 77.1               # measured off the baked-blue segment
SEG = 14


def _erode(mask):
    """Shrink by one pixel in all eight directions — thin lines disappear."""
    out = mask.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            out &= np.roll(np.roll(mask, dy, 0), dx, 1)
    return out


def _grow(mask, n):
    out = mask.copy()
    for _ in range(n):
        g = out.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                g |= np.roll(np.roll(out, dy, 0), dx, 1)
        out = g
    return out


def _rotational_fill(clean, rgb, holes, erase, cx, cy, dist, ang):
    """Fill each hole from the same spot one or more segments round.

    The chart repeats every 360/14 degrees, so rotating a hole by k segments
    lands on a pixel showing the same thing — background, spoke or ring line.
    The median of the good twins restores all three without smearing.

    A square's twins are the other thirteen squares, so its core has no good
    twin at all. Those pixels take the median of their own radius instead,
    which is mostly background at r=30; that rubs out the length of spoke
    underneath, so the spokes are drawn back afterwards.
    """
    h, w = clean.shape[:2]
    step = 360.0 / SEG
    ys, xs = np.nonzero(holes)
    rr = dist[ys, xs]
    aa = ang[ys, xs]
    filled = 0
    stranded = []
    for i in range(len(ys)):
        samples = []
        for k in range(1, SEG):
            a = np.radians(aa[i] + k * step)
            x = int(round(cx + rr[i] * np.cos(a)))
            y = int(round(cy + rr[i] * np.sin(a)))
            if 0 <= x < w and 0 <= y < h and not erase[y, x]:
                samples.append(rgb[y, x])
        if samples:
            clean[ys[i], xs[i]] = np.median(samples, axis=0)
            filled += 1
        else:
            stranded.append(i)

    ri = dist.astype(int)
    for i in stranded:
        at_r = (ri == int(rr[i])) & ~erase
        if at_r.any():
            clean[ys[i], xs[i]] = np.median(rgb[at_r], axis=0)
    return filled, len(stranded)


def _redraw_spokes(clean, rgb, squares, erase, cx, cy, dist, ang):
    """Put back the spoke each time square was sitting on.

    The squares are centred on the spokes, so their own centroids give the
    angles; the colour is taken from the surviving spoke just outside the hole,
    so it matches whatever the chart actually uses.
    """
    h, w = clean.shape[:2]
    ys, xs = np.nonzero(squares)
    if not len(ys):
        return 0
    rel = ((SEG1_CENTRE - ang[ys, xs] + 180) % (360.0 / SEG))
    order = np.argsort(rel)
    # One cluster per square: sort by angle and cut where the gap jumps.
    angles = []
    a_sorted = np.sort(ang[ys, xs])
    cut = [0] + [i for i in range(1, len(a_sorted))
                 if a_sorted[i] - a_sorted[i - 1] > 5] + [len(a_sorted)]
    for i in range(len(cut) - 1):
        chunk = a_sorted[cut[i]:cut[i + 1]]
        if len(chunk) > 20:
            angles.append(float(np.mean(chunk)))

    lo = float(dist[squares].min()) - 1
    hi = float(dist[squares].max()) + 1
    drawn = 0
    for a in angles:
        rad = np.radians(a)
        # Sample the live spoke just beyond the hole for its colour.
        sx = int(round(cx + (hi + 4) * np.cos(rad)))
        sy = int(round(cy + (hi + 4) * np.sin(rad)))
        if not (0 <= sx < w and 0 <= sy < h):
            continue
        colour = rgb[sy, sx]
        for t in np.arange(lo, hi, 0.4):
            x = int(round(cx + t * np.cos(rad)))
            y = int(round(cy + t * np.sin(rad)))
            if 0 <= x < w and 0 <= y < h and squares[y, x]:
                clean[y, x] = colour
                drawn += 1
    return drawn


def main(src, outdir):
    img = Image.open(src).convert('RGB')
    rgb = np.asarray(img).astype(float)
    h, w = rgb.shape[:2]
    cx, cy = CENTRE

    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.hypot(xx - cx, yy - cy)
    ang = (np.degrees(np.arctan2(yy - cy, xx - cx)) + 360) % 360

    # Segment 1's own arc, measured from the baked blue one in the capture,
    # is centred at 77 degrees (y down) — NOT at the bottom as it looks. They
    # run to the right and up from there, matching the trough numbering.
    step = 360.0 / SEG
    rel = (SEG1_CENTRE - ang + step / 2) % 360
    seg = (rel // step).astype(int) + 1

    ring = (dist >= RING_IN) & (dist <= RING_OUT)
    labels = np.zeros((h, w), dtype=np.uint8)
    labels[ring] = seg[ring]

    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # The magenta trace, and segment 1's baked blue.
    trace = (r > 150) & (b > 150) & (r - g > 40) & (b - g > 40) & (dist < RING_IN)
    # The time squares: grey, and the same grey as the spokes they lie on, so
    # they are picked out by SHAPE. Eroding by a 3x3 kills the one-pixel spokes
    # and rings and leaves only the solid blocks, which are then grown back out
    # to catch their soft JPEG edges.
    grey = (dist < 45) & (r < 175) & (abs(r - g) < 25) & (abs(g - b) < 25)
    squares = _grow(_erode(grey), 2)
    # ONLY segment 1's arc: the thin blue ticks dividing the other segments are
    # part of the chart and erasing them left the ring looking dashed.
    seg1_blue = ring & (seg == 1) & (b - r > 40) & (b > 110)
    erase = trace | seg1_blue | squares

    clean = rgb.copy()
    ri = dist.astype(int)
    radial = erase & ~squares
    for radius in range(0, int(RING_OUT) + 2):
        at_r = (ri == radius)
        gone = at_r & radial
        if not gone.any():
            continue
        keep = at_r & ~erase
        if not keep.any():
            continue
        med = np.median(rgb[keep], axis=0)
        for c in range(3):
            clean[..., c][gone] = med[c]

    # RF AMP's lamp is green in the capture and RF Time's is not, which is why
    # the amplitude trace is in colour and the time trace grey. The app lights
    # its own lamps, so a baked green one can never be turned off — the OFF lamp
    # next door is copied over it, and the app puts the green back when the AMP
    # key is lit.
    # The green runs x 503-511, y 57-75; the copied block is a little wider so
    # no rim of it survives. The two keys are 95px apart.
    lx, ly, lw, lh = 501, 54, 14, 24
    ox = lx - 95                               # RF Time's lamp: the same lamp, off
    clean[ly:ly + lh, lx:lx + lw] = rgb[ly:ly + lh, ox:ox + lw]

    # The two printed values are erased so the app can write the live ones on
    # clean artwork. Covering them with a patch cannot work: the key face is
    # bevelled — 212 at the top of the digits, 244 through the middle, 164 at
    # the bottom — so any flat fill shows as a rectangle. Each digit pixel
    # instead takes the median of its OWN ROW across the rest of the field,
    # which is the face colour at that height and keeps the bevel intact.
    for x0, x1 in ((456, 494), (553, 591)):
        for y in range(70, 90):
            row = rgb[y, x0:x1]
            ink = (row[:, 2] - row[:, 0] > 60) & (row[:, 2] > 110)
            if ink.any() and (~ink).any():
                clean[y, x0:x1][ink] = np.median(row[~ink], axis=0)

    twinned, stranded = _rotational_fill(clean, rgb, squares, erase,
                                         cx, cy, dist, ang)
    spokes = _redraw_spokes(clean, rgb, squares, erase, cx, cy, dist, ang)

    base_path = os.path.join(os.path.dirname(src), 'run-feeder--base.jpg')
    Image.fromarray(clean.astype('uint8')).save(base_path, quality=93)

    os.makedirs(outdir, exist_ok=True)
    lab_path = os.path.join(outdir, 'run-feeder-ring.png')
    Image.fromarray(labels).save(lab_path, optimize=True)
    json.dump({'centre': [cx, cy], 'ringIn': RING_IN, 'ringOut': RING_OUT,
               'rFull': R_FULL, 'seg1Centre': SEG1_CENTRE, 'segments': SEG},
              open(os.path.join(outdir, 'run-feeder-ring.json'), 'w'), indent=1)
    print('erased %d px (trace %d, baked segment %d'
          % (erase.sum(), trace.sum(), seg1_blue.sum()), end='')
    print(', time squares %d)' % squares.sum())
    print('  filled %d from twins, %d by radius; redrew %d spoke px'
          % (twinned, stranded, spokes))
    print('wrote', base_path, 'and', lab_path)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
