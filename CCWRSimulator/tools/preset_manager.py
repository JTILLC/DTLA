#!/usr/bin/env python3
"""
Display & Data Manager > Preset Manager, drawn live.

Captured off the running program (2026-09-03): the tab opens on "Loading
preset data", both Source and Destination have a Memory / Card list behind
their arrow key, a tap on a row in each table picks the copy source and the
copy destination, the Copy key then shows the two numbers and asks "Performs
copying of preset contents from copy source to copy destination." and Yes
writes the source preset into the destination slot.

The base is the loaded capture with the name cells, the two Memory fields and
the Copy key's number boxes cleared so the app can draw them; the live Copy
key is cut from the capture with both rows picked.

    python3 tools/preset_manager.py
"""
import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')
OUT = os.path.join(PUB, 'derived')
CELL = (192, 192, 192)
FIELD = (212, 252, 228)


def load(name):
    m = json.load(open(os.path.join(PUB, 'captured/manifest.json')))
    e = m[name]
    if 'alias' in e:
        e = m[e['alias']]
    return Image.open(os.path.join(PUB, e['file'])).convert('RGB')


def fill(im, box, colour):
    px = im.load()
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        for x in range(x0, x1):
            px[x, y] = colour


def main():
    os.makedirs(OUT, exist_ok=True)
    base = load('dp-live-loaded')
    for x0, x1 in ((40, 322), (489, 771)):
        for i in range(10):
            y0 = 141 + 27 * i
            fill(base, (x0, y0 + 1, x1, y0 + 27), CELL)
    fill(base, (116, 77, 269, 108), FIELD)      # Source: Memory
    fill(base, (512, 77, 665, 108), FIELD)      # Destination: Memory
    base.save(os.path.join(OUT, 'dp-base.jpg'), quality=92, optimize=True)

    live = load('dp-src1-dst4')
    key = live.crop((352, 190, 444, 256))
    px = key.load()
    green = px[372 - 352, 203 - 190]
    for bx0, bx1 in ((369 - 352, 395 - 352), (403 - 352, 429 - 352)):
        for y in range(195 - 190, 208 - 190):
            for x in range(bx0, bx1):
                px[x, y] = green
    key.save(os.path.join(OUT, 'dp-copy-live.png'))
    print('wrote dp-base.jpg, dp-copy-live.png')


if __name__ == '__main__':
    main()
