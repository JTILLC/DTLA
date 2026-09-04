#!/usr/bin/env python3
"""
Production > Weight Display with its printed weights erased.

The extracted frame prints 0.0g on every weigh hopper and 1669g on the
dispersion table; the app writes the live weights, so the labels are wiped
here by copying each row's colour from just left of the label.

    python3 tools/weight_display.py
"""
import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')


def wipe(im, box, pad=2):
    """Blend each row from the colour just left of the label to the colour
    just right of it, so the patch follows the hopper's shading."""
    px = im.load()
    x0, y0, x1, y1 = box[0] - pad, box[1] - pad, box[2] + pad + 1, box[3] + pad + 1
    for y in range(y0, y1):
        a = px[x0 - 3, y]
        b = px[x1 + 2, y]
        for x in range(x0, x1):
            t = (x - x0) / max(1, x1 - x0 - 1)
            px[x, y] = tuple(int(round(a[k] + (b[k] - a[k]) * t)) for k in range(3))


def main():
    nav = json.load(open(os.path.join(ROOT, 'src/data/navmap.json')))
    spec = nav['process']['weightDisplay']
    im = Image.open(os.path.join(PUB, 'screens/run-weight.jpg')).convert('RGB')
    for l in spec['labels']:
        wipe(im, (l['x'], l['y'], l['x'] + l['w'], l['y'] + l['h']))
    d = spec['df']
    wipe(im, (d['x'], d['y'], d['x'] + d['w'], d['y'] + d['h']))
    os.makedirs(os.path.join(PUB, 'derived'), exist_ok=True)
    im.save(os.path.join(PUB, 'derived/run-weight--base.jpg'), quality=92, optimize=True)
    print('wrote run-weight--base.jpg')


if __name__ == '__main__':
    main()
