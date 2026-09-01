#!/usr/bin/env python3
"""Turn a phone photo of an RCU into a straight-on picture of the screen.

A centerline goes to a customer, so a snapshot taken at arm's length over a
machine — tilted, with the plant behind it — has to come out looking like a
screen capture. Given the four corners of the screen, this maps them onto a
rectangle and throws the rest of the photo away.

The corner-finder is best-effort and meant to be a suggestion the operator
drags into place, never something trusted on its own: a reflection on the bezel
or a lit machine behind the unit pulls a corner, and a corner out by a few
percent skews every value on the page. Manual corners always win.

Usage:
  python3 tools/screen_crop.py <photo> <out.png> [x0,y0 x1,y1 x2,y2 x3,y3]
  (corners clockwise from top-left, in pixels; omit them to auto-detect)
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageOps

# The RCU screen is 4:3, so that is what it is corrected back to.
OUT_W, OUT_H = 1024, 768


def load(path):
    """The photo, decoded and the right way up.

    Two things bite here. iPhones shoot HEIC, which Pillow cannot open without
    a plugin, so on macOS it is handed to `sips` first. And phones record
    orientation in EXIF rather than rotating the pixels, so a portrait shot
    opens as landscape and every corner coordinate is wrong — except via sips,
    which bakes the rotation in as it converts.
    """
    if os.path.splitext(path)[1].lower() in ('.heic', '.heif'):
        tmp = tempfile.NamedTemporaryFile(suffix='.jpg', delete=False).name
        result = subprocess.run(['sips', '-s', 'format', 'jpeg', path, '--out', tmp],
                                capture_output=True)
        if result.returncode != 0 or not os.path.getsize(tmp):
            raise SystemExit('could not decode %s (install pillow-heif, or convert it '
                             'to JPEG first)' % os.path.basename(path))
        path = tmp
    return ImageOps.exif_transpose(Image.open(path)).convert('RGB')


def perspective_coeffs(dest, src):
    """PIL's 8 PERSPECTIVE coefficients mapping output pixels back to the photo.

    PIL asks for the INVERSE map — for each output pixel it needs to know where
    to sample — so `dest` is the output rectangle and `src` the quad in the
    photo. The wrong way round gives a plausible-looking but wrong crop.
    """
    matrix = []
    for (dx, dy), (sx, sy) in zip(dest, src):
        matrix.append([dx, dy, 1, 0, 0, 0, -dx * sx, -dy * sx])
        matrix.append([0, 0, 0, dx, dy, 1, -dx * sy, -dy * sy])
    A = np.array(matrix, dtype=float)
    B = np.array(sum(([sx, sy] for sx, sy in src), []), dtype=float)
    return np.linalg.solve(A, B)


def order_corners(points):
    """Clockwise from the top-left, however they were clicked or found."""
    pts = np.array(points, dtype=float)
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return [tuple(pts[np.argmin(s)]), tuple(pts[np.argmin(d)]),
            tuple(pts[np.argmax(s)]), tuple(pts[np.argmax(d)])]


def auto_corners(image, work=200):
    """A first guess: the largest bright blob in a downscaled copy.

    Deliberately crude — good enough to save most of the dragging, not good
    enough to skip the check.
    """
    small = image.convert('L').resize((work, max(1, int(work * image.height / image.width))))
    a = np.asarray(small, dtype=float)
    bright = a > np.percentile(a, 82)

    seen = np.zeros_like(bright, dtype=bool)
    best = []
    h, w = bright.shape
    for y0 in range(h):
        for x0 in range(w):
            if not bright[y0, x0] or seen[y0, x0]:
                continue
            stack, blob = [(y0, x0)], []
            seen[y0, x0] = True
            while stack:
                y, x = stack.pop()
                blob.append((x, y))
                for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= ny < h and 0 <= nx < w and bright[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            if len(blob) > len(best):
                best = blob
    if not best:
        return None
    pts = np.array(best, dtype=float)
    sx, sy = image.width / w, image.height / h
    diag = np.diff(pts, axis=1).ravel()
    picks = [pts[np.argmin(pts.sum(1))], pts[np.argmin(diag)],
             pts[np.argmax(pts.sum(1))], pts[np.argmax(diag)]]
    return [(float(x * sx), float(y * sy)) for x, y in picks]


def crop(photo_path, corners=None, size=(OUT_W, OUT_H)):
    im = load(photo_path)
    if corners is None:
        corners = auto_corners(im)
        if corners is None:
            raise SystemExit('could not find a screen; pass corners manually')
    corners = order_corners(corners)
    w, h = size
    dest = [(0, 0), (w, 0), (w, h), (0, h)]
    coeffs = perspective_coeffs(dest, corners)
    return im.transform(size, Image.PERSPECTIVE, coeffs, Image.BICUBIC), corners


def main(argv):
    photo, out = argv[0], argv[1]
    corners = [tuple(float(v) for v in p.split(',')) for p in argv[2:]] or None
    image, used = crop(photo, corners)
    image.save(out)
    print('corners used:', [(round(x), round(y)) for x, y in used])
    print('wrote', out)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    main(sys.argv[1:])
