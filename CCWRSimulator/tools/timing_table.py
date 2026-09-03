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
               tags=(22, 392, 49, 82, 414), arrow=(20, 371, 62, 387), uparrow=(49, 353, 70, 390)),
    'rt': dict(cap='rt-row-', panel=(308, 82, 773, 382), header=(309, 45, 509, 81), cutaway=(0, 60, 300, 400),
               tags=(50, 355, 79, 110, 379), arrow=(48, 333, 92, 350), uparrow=(76, 316, 97, 352)),
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


def ring_band(sc, neutral_im, lit_im):
    """The weigh-hopper ring, cut out of the cutaway.

    Its rows are where the WH ON capture is blue; the rect runs from just above
    them to the bottom of the black base under them, and a flood fill of the
    flat background from the rect's edges leaves the ring itself as the mask.
    Returns (rect, mask, dy) where dy is one ring-height down - where a row of
    booster hoppers sits on a machine that has them.
    """
    import numpy as np
    from collections import deque
    from PIL import ImageFilter
    x0, y0, x1, y1 = sc['cutaway']
    lit = np.array(lit_im).astype(int)[y0:y1, x0:x1]
    blue = (lit[:, :, 2] - (lit[:, :, 0] + lit[:, :, 1]) / 2) > 60
    # A row of hoppers is dozens of blue pixels wide; the little DS/IS tags
    # lower down are blue too, and must not stretch the band to them.
    rows = np.where(blue.sum(axis=1) > 40)[0] + y0
    cols = np.where(blue[rows - y0].any(axis=0))[0] + x0
    top, bottom = int(rows.min()), int(rows.max())
    cx = int((cols.min() + cols.max()) / 2)
    neu = np.array(neutral_im).astype(int)
    base = bottom
    while base + 1 < y1 and neu[base + 1, cx].sum() < 300:   # the black base under the ring
        base += 1
    rect = (x0, top - 4, x1, base + 4)
    band = neu[rect[1]:rect[3], rect[0]:rect[2]]
    free = np.abs(band - np.array(PANEL_GREY)).sum(axis=2) < 24
    h, w = free.shape
    reached = np.zeros_like(free, bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if free[y, x]:
                reached[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if free[y, x]:
                reached[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and free[ny, nx] and not reached[ny, nx]:
                reached[ny, nx] = True
                dq.append((ny, nx))
    mask = Image.fromarray(((~reached) * 255).astype('uint8'))
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    return rect, mask, bottom - top + 1, int(cols.max())


def ring_arrow(sc, whph_im, cols_max, band_rect):
    """The blue arrow WH-PH draws beside the rings (pointing up, WH to PH),
    cut out of that capture with a mask of its own blue pixels."""
    import numpy as np
    from PIL import ImageFilter
    x0, y0, x1, y1 = sc['cutaway']
    a = np.array(whph_im).astype(int)
    blue = (a[:, :, 2] - (a[:, :, 0] + a[:, :, 1]) / 2) > 60
    region = np.zeros_like(blue)
    region[y0:band_rect[3], cols_max + 3:x1] = True
    hit = blue & region
    ys, xs = np.where(hit)
    bx0, by0, bx1, by1 = int(xs.min()) - 2, int(ys.min()) - 2, int(xs.max()) + 3, int(ys.max()) + 3
    mask = Image.fromarray((hit[by0:by1, bx0:bx1] * 255).astype('uint8')).filter(ImageFilter.MaxFilter(3))
    return (bx0, by0, bx1, by1), whph_im.crop((bx0, by0, bx1, by1)), mask


def with_arrow(im, arrow, mask, box, dy, flip):
    """WH-BH: the arrow one ring lower and turned to point down (WH to BH);
    BH-WH: the same arrow pointing up."""
    from PIL import ImageOps
    out = im.copy()
    a, m = (ImageOps.flip(arrow), ImageOps.flip(mask)) if flip else (arrow, mask)
    out.paste(a, (box[0], box[1] + dy), m)
    return out


def with_boosters(im, src, rect, mask, dy):
    """Paste the ring one ring-height lower: the booster hoppers."""
    out = im.copy()
    out.paste(src.crop(rect), (rect[0], rect[1] + dy), mask)
    return out


def is_wh_fix(im, sc):
    """IS-WH on the program lit the DS tag; on the machine only IS is blue.
    The tag strip of the WH-DS capture has DS plain and IS blue."""
    x0, y0, xm, x1, y1 = sc['tags']
    im.paste(load(sc['cap'] + 'whds').crop((x0, y0, x1, y1)), (x0, y0))
    return im


def is_th(prefix, sc):
    """IS-TH and IS-DTH: nothing lit on the captured machine, the IS tag blue,
    and an arrow pointing DOWN at it - WH-DS's up arrow, turned over. The
    timing hopper or DTH itself is drawn by the app and lights there."""
    from PIL import ImageOps, ImageFilter
    import numpy as np
    base = clear_table(neutral(load(sc['cap'] + 'whon'), load(sc['cap'] + 'phon'), sc['cutaway']), sc)
    whds = load(sc['cap'] + 'whds')
    x0, y0, xm, x1, y1 = sc['tags']
    base.paste(whds.crop((xm, y0, x1, y1)), (xm, y0))          # IS blue, DS left plain
    ax0, ay0, ax1, ay1 = sc['uparrow']
    a = np.array(whds).astype(int)[ay0:ay1, ax0:ax1]
    blue = (a[:, :, 2] - (a[:, :, 0] + a[:, :, 1]) / 2) > 60
    mask = Image.fromarray((blue * 255).astype('uint8')).filter(ImageFilter.MaxFilter(3))
    arrow = whds.crop((ax0, ay0, ax1, ay1))
    base.paste(ImageOps.flip(arrow), (ax0, ay0), ImageOps.flip(mask))
    return base


def main():
    os.makedirs(OUT, exist_ok=True)
    for prefix, sc in SCREENS.items():
        for row in ROWS:
            im = clear_table(load(sc['cap'] + row), sc)
            if row == 'iswh':
                im = is_wh_fix(im, sc)
            im.save(os.path.join(OUT, '%s-cut-%s.jpg' % (prefix, row)), quality=92, optimize=True)
        clear_table(neutral(load(sc['cap'] + 'whon'), load(sc['cap'] + 'phon'), sc['cutaway']), sc).save(
            os.path.join(OUT, '%s-cut-neutral.jpg' % prefix), quality=92, optimize=True)
        is_ds(prefix, sc).save(os.path.join(OUT, '%s-cut-isds.jpg' % prefix), quality=92, optimize=True)
        is_th(prefix, sc).save(os.path.join(OUT, '%s-cut-isth.jpg' % prefix), quality=92, optimize=True)
        # A booster-hopper machine: every cutaway gets a grey ring of boosters
        # under the weigh hoppers, cut from the cutaway itself; the BH rows get
        # that ring lit, cut from the WH ON capture so the tint is the render's.
        neutral_im = Image.open(os.path.join(OUT, '%s-cut-neutral.jpg' % prefix)).convert('RGB')
        lit_im = Image.open(os.path.join(OUT, '%s-cut-whon.jpg' % prefix)).convert('RGB')
        rect, mask, dy, rect_cols_max = ring_band(sc, neutral_im, lit_im)
        for key in ROWS + ['neutral', 'isds', 'isth']:
            im = Image.open(os.path.join(OUT, '%s-cut-%s.jpg' % (prefix, key))).convert('RGB')
            with_boosters(im, neutral_im, rect, mask, dy).save(
                os.path.join(OUT, '%s-cut-%s-bh.jpg' % (prefix, key)), quality=92, optimize=True)
        with_boosters(neutral_im, lit_im, rect, mask, dy).save(
            os.path.join(OUT, '%s-cut-bhlit.jpg' % prefix), quality=92, optimize=True)
        # WH-BH and BH-WH: both rings lit, like WH-PH lights both of its, and
        # WH-PH's arrow between them - turned down for WH-BH, up for BH-WH.
        whph_im = Image.open(os.path.join(OUT, '%s-cut-whph.jpg' % prefix)).convert('RGB')
        both = with_boosters(lit_im, lit_im, rect, mask, dy)
        box, arrow, amask = ring_arrow(sc, whph_im, rect_cols_max, rect)
        with_arrow(both, arrow, amask, box, dy, True).save(
            os.path.join(OUT, '%s-cut-whbh.jpg' % prefix), quality=92, optimize=True)
        with_arrow(both, arrow, amask, box, dy, False).save(
            os.path.join(OUT, '%s-cut-bhwh.jpg' % prefix), quality=92, optimize=True)
        print(prefix, 'ring', rect, 'dy', dy, 'arrow', box)
    print('wrote', sorted(f for f in os.listdir(OUT) if '-cut-' in f))


if __name__ == '__main__':
    main()
