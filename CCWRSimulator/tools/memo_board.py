#!/usr/bin/env python3
"""
The Message Board's base with every tool lamp off.

The extracted frame has the pencil and the black paint lit; the app lights
the lamps of the live tool and colour itself, so the two baked lamps are
replaced with the brush key's unlit lamp.

    python3 tools/memo_board.py
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')
LAMP = (10, 396, 10, 23)          # the brush key's lamp, unlit
LIT = [(200, 396), (499, 396)]    # pencil, black


def main():
    im = Image.open(os.path.join(PUB, 'screens/memo.jpg')).convert('RGB')
    x, y, w, h = LAMP
    off = im.crop((x - 1, y - 1, x + w + 1, y + h + 1))
    for lx, ly in LIT:
        im.paste(off, (lx - 1, ly - 1))
    os.makedirs(os.path.join(PUB, 'derived'), exist_ok=True)
    im.save(os.path.join(PUB, 'derived/memo-base.jpg'), quality=92, optimize=True)
    print('wrote memo-base.jpg')


if __name__ == '__main__':
    main()
