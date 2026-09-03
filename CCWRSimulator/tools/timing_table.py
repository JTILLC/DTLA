#!/usr/bin/env python3
"""
Timing Adjustment backgrounds, Preset (pt-) and Production (rt-).

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
PANEL_GREY = (208, 208, 208)
HEADER_GREY = (129, 129, 129)
SCREENS = {
    # prefix, capture prefix, rows area inside the frame, header box (ruler
    # excluded), the cutaway region the neutral is built over
    'pt': dict(cap='pt-row-', panel=(267, 114, 573, 402), header=(268, 86, 467, 114), cutaway=(0, 90, 262, 420)),
    'rt': dict(cap='rt-row-', panel=(308, 82, 773, 382), header=(309, 45, 509, 81), cutaway=(0, 60, 300, 400)),
}


def load(name):
    manifest = json.load(open(os.path.join(PUB, 'captured/manifest.json')))
    entry = manifest[name]
    if 'alias' in entry:
        entry = manifest[entry['alias']]
    return Image.open(os.path.join(PUB, entry['file'])).convert('RGB')


def clear_table(im, sc):
    px = im.load()
    x0, y0, x1, y1 = sc['panel']
    for y in range(y0, y1):
        for x in range(x0, x1):
            px[x, y] = PANEL_GREY
    x0, y0, x1, y1 = sc['header']
    for y in range(y0, y1):
        for x in range(x0, x1):
            px[x, y] = HEADER_GREY
    return im


def neutral(a, b, region):
    """The cutaway with nothing lit: WH ON lights the weigh hoppers and PH ON
    the pool hoppers, and neither has a tag or an arrow, so the less-blue of
    the two at every pixel is the plain machine."""
    out = a.copy()
    pa, pb, po = a.load(), b.load(), out.load()
    x0, y0, x1, y1 = region
    for y in range(y0, y1):
        for x in range(x0, x1):
            ra, ga, ba = pa[x, y]
            rb, gb, bb = pb[x, y]
            po[x, y] = pa[x, y] if (ba - (ra + ga) / 2) <= (bb - (rb + gb) / 2) else pb[x, y]
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for prefix, sc in SCREENS.items():
        for row in ROWS:
            clear_table(load(sc['cap'] + row), sc).save(
                os.path.join(OUT, '%s-cut-%s.jpg' % (prefix, row)), quality=92, optimize=True)
        clear_table(neutral(load(sc['cap'] + 'whon'), load(sc['cap'] + 'phon'), sc['cutaway']), sc).save(
            os.path.join(OUT, '%s-cut-neutral.jpg' % prefix), quality=92, optimize=True)
    print('wrote', sorted(f for f in os.listdir(OUT) if '-cut-' in f))


if __name__ == '__main__':
    main()
