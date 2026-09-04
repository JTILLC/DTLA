#!/usr/bin/env python3
"""
Display & Data Manager > Preset Manager and Machine Set Mngr, drawn live.

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


def clear_manager(im, numbers_from=None):
    """Clear the name cells and both store fields of a manager capture. The
    number columns are taken from `numbers_from` (a capture with no row
    banded) where the capture itself has a banded row."""
    for x0, x1 in ((40, 322), (489, 771)):
        for i in range(10):
            y0 = 141 + 27 * i
            fill(im, (x0, y0 + 1, x1, y0 + 27), CELL)
    fill(im, (116, 77, 269, 108), FIELD)
    fill(im, (512, 77, 665, 108), FIELD)
    if numbers_from is not None:
        for x0, x1 in ((8, 40), (452, 489)):
            im.paste(numbers_from.crop((x0, 141, x1, 411)), (x0, 141))
        # ... and the banded row's blue top edge, which sits on the separator.
        for x0, x1 in ((8, 323), (452, 772)):
            im.paste(numbers_from.crop((x0, 139, x1, 143)), (x0, 139))
    return im


def dimmed(im):
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            px[x, y] = (int(r * 0.62 + 60), int(g * 0.62 + 60), int(b * 0.62 + 60))
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    preset = load('dp-live-loaded')
    clear_manager(preset.copy()).save(os.path.join(OUT, 'dp-base.jpg'), quality=92, optimize=True)

    live = load('dp-src1-dst4')
    key = live.crop((352, 190, 444, 256))
    px = key.load()
    green = px[372 - 352, 203 - 190]
    for bx0, bx1 in ((369 - 352, 395 - 352), (403 - 352, 429 - 352)):
        for y in range(195 - 190, 208 - 190):
            for x in range(bx0, bx1):
                px[x, y] = green
    key.save(os.path.join(OUT, 'dp-copy-live.png'))

    # Machine Set Mngr: the program's tab is inert (nothing responded), so
    # its base is its capture cleared the same way, with the Preset tab's
    # greyed Copy key in place of its baked live one, and its pop-ups are the
    # Preset tab's lists and confirm laid over a dimmed copy of it.
    machine = load('dm-live-loaded')
    base = clear_manager(machine.copy(), numbers_from=preset)
    base.paste(preset.crop((352, 190, 444, 256)), (352, 190))
    base.save(os.path.join(OUT, 'dm-base.jpg'), quality=92, optimize=True)
    src_list = load('dp-source-list')
    dst_list = load('dp-dest-list')
    confirm = load('dp-copy-pressed')
    init = load('dp-initialize')
    m = base.copy(); m.paste(src_list.crop((108, 130, 260, 226)), (108, 130))
    m.save(os.path.join(OUT, 'dm-source-list.jpg'), quality=92, optimize=True)
    m = base.copy(); m.paste(dst_list.crop((504, 130, 670, 226)), (504, 130))
    m.save(os.path.join(OUT, 'dm-dest-list.jpg'), quality=92, optimize=True)
    for name, src in (('dm-copy', confirm), ('dm-initialize', init)):
        m = dimmed(base.copy()); m.paste(src.crop((158, 130, 640, 472)), (158, 130))
        m.save(os.path.join(OUT, '%s.jpg' % name), quality=92, optimize=True)
    print('wrote dp-base, dp-copy-live, dm-base, dm-source-list, dm-dest-list, dm-copy, dm-initialize')



if __name__ == '__main__':
    main()
