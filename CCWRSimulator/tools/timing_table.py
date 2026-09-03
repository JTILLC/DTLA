#!/usr/bin/env python3
"""
Timing Adjustment backgrounds.

The table itself is drawn live by the app (the rows depend on which units the
machine has: booster hoppers, a timing hopper, diverting timing hoppers), so the
captures only supply the CUTAWAY - which hoppers light for the selected row -
and the frame around the table. This erases the table's rows and its header
text from each per-row capture (2026-09-03, one grab per selected row), leaving
the panel and the ms ruler, and builds one neutral cutaway with nothing lit for
the rows the program never had.

    python3 tools/timing_table.py
"""
import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')
OUT = os.path.join(PUB, 'derived')

ROWS = ['whds', 'iswh', 'whph', 'phrf', 'stagger', 'whon', 'phon']
PANEL = (267, 114, 573, 402)      # the rows area inside the table frame
HEADER = (268, 86, 467, 114)      # the "C1:1-14 / WH-DS" box, ruler excluded
PANEL_GREY = (208, 208, 208)
HEADER_GREY = (129, 129, 129)
CUTAWAY = (0, 90, 262, 420)


def load(name):
    manifest = json.load(open(os.path.join(PUB, 'captured/manifest.json')))
    entry = manifest[name]
    if 'alias' in entry:
        entry = manifest[entry['alias']]
    return Image.open(os.path.join(PUB, entry['file'])).convert('RGB')


def clear_table(im):
    px = im.load()
    for y in range(PANEL[1], PANEL[3]):
        for x in range(PANEL[0], PANEL[2]):
            px[x, y] = PANEL_GREY
    for y in range(HEADER[1], HEADER[3]):
        for x in range(HEADER[0], HEADER[2]):
            px[x, y] = HEADER_GREY
    return im


def neutral(a, b):
    """The cutaway with nothing lit: WH ON lights the weigh hoppers and PH ON
    the pool hoppers, and neither has a tag or an arrow, so the less-blue of
    the two at every pixel is the plain machine."""
    out = a.copy()
    pa, pb, po = a.load(), b.load(), out.load()
    for y in range(CUTAWAY[1], CUTAWAY[3]):
        for x in range(CUTAWAY[0], CUTAWAY[2]):
            ra, ga, ba = pa[x, y]
            rb, gb, bb = pb[x, y]
            po[x, y] = pa[x, y] if (ba - (ra + ga) / 2) <= (bb - (rb + gb) / 2) else pb[x, y]
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for row in ROWS:
        clear_table(load('pt-row-' + row)).save(os.path.join(OUT, 'pt-cut-%s.jpg' % row), quality=92, optimize=True)
    clear_table(neutral(load('pt-row-whon'), load('pt-row-phon'))).save(
        os.path.join(OUT, 'pt-cut-neutral.jpg'), quality=92, optimize=True)
    for stale in os.listdir(OUT):
        if stale.startswith('pt-row-'):
            os.remove(os.path.join(OUT, stale))
    print('wrote', sorted(f for f in os.listdir(OUT) if f.startswith('pt-cut-')))


if __name__ == '__main__':
    main()
