#!/usr/bin/env python3
"""Print centerline values onto the RCU screens, in the machine's own boxes.

The screenshots have one customer's numbers baked into them (POTATO CHIPS at
90.0g). To show somebody else's settings, each value box is repainted in the
field's own background colour and the new value drawn in the RCU's blue. The
result reads as the screen that customer should be looking at, which is the
point: an operator can hold it against the live machine and compare.

Usage: python3 tools/overlay.py <screens-dir> <values.json> <outdir>
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RCU_BLUE = (0, 0, 204)


def _font(size):
    for path in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf',
                 '/System/Library/Fonts/Helvetica.ttc'):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _repaint(image, box):
    """Erase a value, leaving the field looking untouched.

    A flat fill is wrong: these buttons have a vertical gradient across their
    face, so a single sampled colour leaves a visible patch. Each row is
    repainted with the median of its OWN non-text pixels instead, which follows
    the gradient and works just as well on the green list panels as on grey.
    """
    x0, y0, x1, y1 = box
    px = image.load()
    for y in range(y0, y1 + 1):
        row = []
        for x in range(x0, x1 + 1):
            r, g, b = px[x, y]
            # The value text is dark and blue; anything else is field.
            if not (r < 140 and g < 140 and b > r + 30):
                row.append((r, g, b))
        if not row:
            continue
        row.sort(key=lambda c: c[0] + c[1] + c[2])
        mid = row[len(row) // 2]
        for x in range(x0, x1 + 1):
            px[x, y] = mid


def render(screen_path, fields, values, out_path):
    im = Image.open(screen_path).convert('RGB')
    draw = ImageDraw.Draw(im)
    written = []
    for field in fields:
        value = values.get(field['key'])
        if value is None:
            continue
        box = field['box']
        _repaint(im, box)
        text = str(value)
        if field.get('unit') and not text.endswith(field['unit']):
            text += field['unit']
        font = _font(15)
        w = draw.textlength(text, font=font)
        cx = (box[0] + box[2]) / 2
        cy = (box[1] + box[3]) / 2
        draw.text((cx - w / 2, cy - 9), text, fill=RCU_BLUE, font=font)
        written.append((field['label'], text))
    im.save(out_path)
    return written


def main(screens_dir, values_path, outdir):
    spec = json.load(open(os.path.join(HERE, 'data', 'rcu-fields.json')))
    values = json.load(open(values_path))
    os.makedirs(outdir, exist_ok=True)
    for slug, screen in spec['screens'].items():
        vals = values.get(slug, {})
        if not vals:
            continue
        src = os.path.join(screens_dir, slug + '.jpg')
        if not os.path.exists(src):
            print('missing screen:', src)
            continue
        out = os.path.join(outdir, slug + '.png')
        written = render(src, screen['fields'], vals, out)
        print('%s -> %d values' % (slug, len(written)))
        for label, text in written:
            print('    %-34s %s' % (label, text))


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
