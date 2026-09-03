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
    'pt': dict(cap='pt-row-', panel=(267, 114, 573, 402), header=(268, 86, 467, 114), cutaway=(0, 90, 262, 420),
               tags=(22, 392, 49, 82, 414), arrow=(20, 371, 62, 387)),
    'rt': dict(cap='rt-row-', panel=(308, 82, 773, 382), header=(309, 45, 509, 81), cutaway=(0, 60, 300, 400),
               tags=(50, 355, 79, 110, 379), arrow=(48, 333, 92, 350)),
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
            r, g, b = pa[x, y] if (ba - (ra + ga) / 2) <= (bb - (rb + gb) / 2) else pb[x, y]
            # Where the two highlights' edges overlap both are a little blue;
            # that pixel is grey metal underneath, so it is desaturated.
            if b - (r + g) / 2 > 35:
                m = int((r + g) / 2)
                r, g, b = m, m, m
            po[x, y] = (r, g, b)
    return out


ARROW_BLUE = (48, 16, 190)


def left_arrow(im, box):
    """A blue arrow pointing left, drawn at 4x and downsampled so its edges are
    as soft as the program's own arrows."""
    from PIL import ImageDraw
    x0, y0, x1, y1 = box
    w, h = (x1 - x0) * 4, (y1 - y0) * 4
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    midy = h // 2
    head = int(w * 0.38)
    shaft = int(h * 0.36)
    d.polygon([(0, midy), (head, 0), (head, midy - shaft // 2), (w, midy - shaft // 2),
               (w, midy + shaft // 2), (head, midy + shaft // 2), (head, h)], fill=ARROW_BLUE + (255,))
    layer = layer.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    im.paste(layer, (x0, y0), layer)
    return im


def is_ds(prefix, sc):
    """IS-DS on a running machine: nothing lit, BOTH tags blue, and an arrow
    pointing left beside them (photographed 2026-09-03). Built from the
    neutral cutaway, the blue DS tag of the IS-WH capture and the blue IS tag
    of the WH-DS capture."""
    base = clear_table(neutral(load(sc['cap'] + 'whon'), load(sc['cap'] + 'phon'), sc['cutaway']), sc)
    ds_src = load(sc['cap'] + 'iswh')
    is_src = load(sc['cap'] + 'whds')
    x0, y0, xm, x1, y1 = sc['tags']
    base.paste(ds_src.crop((x0, y0, xm, y1)), (x0, y0))
    base.paste(is_src.crop((xm, y0, x1, y1)), (xm, y0))
    return left_arrow(base, sc['arrow'])


def main():
    os.makedirs(OUT, exist_ok=True)
    for prefix, sc in SCREENS.items():
        for row in ROWS:
            clear_table(load(sc['cap'] + row), sc).save(
                os.path.join(OUT, '%s-cut-%s.jpg' % (prefix, row)), quality=92, optimize=True)
        clear_table(neutral(load(sc['cap'] + 'whon'), load(sc['cap'] + 'phon'), sc['cutaway']), sc).save(
            os.path.join(OUT, '%s-cut-neutral.jpg' % prefix), quality=92, optimize=True)
        is_ds(prefix, sc).save(os.path.join(OUT, '%s-cut-isds.jpg' % prefix), quality=92, optimize=True)
    print('wrote', sorted(f for f in os.listdir(OUT) if '-cut-' in f))


if __name__ == '__main__':
    main()
