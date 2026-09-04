#!/usr/bin/env python3
"""
A label map of the fourteen weigh hoppers on Production's Combination screen.

The hoppers are the only blue things in the ring area, so each blue pixel is
given the number of the nearest badge (navmap.production.badges). The app greys a deactivated head by
desaturating the pixels that carry its number, and finds the head under a tap
the same way.

    python3 tools/combination_masks.py
"""
import json
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')


def main():
    nav = json.load(open(os.path.join(ROOT, 'src/data/navmap.json')))
    spec = nav['production']
    im = Image.open(os.path.join(PUB, nav['screens'][spec['screen']]['image'])).convert('RGB')
    a = np.array(im).astype(int)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    blue = (b > r + 40) & (b > g + 40) & (b > 90)
    x0, y0, x1, y1 = spec['ring']
    region = np.zeros_like(blue)
    region[y0:y1, x0:x1] = True
    blue &= region
    # The hoppers along the sides touch, so connected pieces would merge:
    # every blue pixel instead takes the number of the nearest badge, which
    # sits at each hopper's centre.
    ys, xs = np.where(blue)
    badges = spec['badges']
    bx = np.array([bd['x'] for bd in badges])
    by = np.array([bd['y'] for bd in badges])
    nos = np.array([bd['no'] for bd in badges], np.uint8)
    d2 = (xs[:, None] - bx[None, :]) ** 2 + (ys[:, None] - by[None, :]) ** 2
    labels = np.zeros(blue.shape, np.uint8)
    labels[ys, xs] = nos[d2.argmin(axis=1)]
    out = os.path.join(PUB, spec['labelMap'])
    Image.fromarray(labels).save(out)
    counts = {no: int((labels == no).sum()) for no in range(1, 15)}
    print('px per head', counts)


if __name__ == '__main__':
    main()
