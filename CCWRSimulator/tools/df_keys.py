#!/usr/bin/env python3
"""
The keys the Feeder Adjust screens grow when the dispersion feeder is picked.

Two sources, kept apart on purpose:

- Preset > Feeder Adjustment, from the running Flash program (captured
  2026-09-03): pressing the (1) under the DF bar turns it blue and a "Target Wt"
  key appears above Read OptimumVal, showing the DF target weight (500). The key
  is cut from that capture with its number erased so the app can write the
  live value.

- Production > Feeder Adjust, from a PHOTOGRAPH of a real CCW-R (IMG_4156,
  2026-09-03). With DF picked the four keys along the top read DF Time, DF AMP,
  DF Weight (a lamp key) and Target Wt. The Flash program does NOT do this — its
  keys keep saying RF — so these four are drawn: the RF keys with their label
  repainted, and the Head/Section mean keys with their faces cleared and the
  photo's labels set in the same face. They are look-alikes, and the notes on
  the screen say so.

    python3 tools/df_keys.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')
OUT = os.path.join(PUB, 'derived')
FONT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'


def font(px):
    return ImageFont.truetype(FONT, px)


def wipe(im, box, clean_x):
    """Fill a box row by row with the colour the key face has at clean_x.

    The faces are vertical gradients, so a column that carries no ink is the
    whole face: copying it across erases text and icons without a patch edge.
    """
    x0, y0, x1, y1 = box
    px = im.load()
    for y in range(y0, y1):
        c = px[clean_x, y]
        for x in range(x0, x1):
            px[x, y] = c


def text(im, xy, s, px, fill, anchor='la'):
    ImageDraw.Draw(im).text(xy, s, font=font(px), fill=fill, anchor=anchor)


def production():
    base = Image.open(os.path.join(PUB, 'derived/run-feeder--base.jpg')).convert('RGB')
    NAVY = (24, 24, 96)
    INK = (20, 20, 20)

    # RF Time -> DF Time. "RF" sits at x 430..452, y 45..59 of the screen.
    k = base.crop((406, 40, 492, 95))
    wipe(k, (20, 5, 48, 21), 12)
    text(k, (34, 13), 'DF', 14, NAVY, 'mm')
    k.save(os.path.join(OUT, 'df-time-key.png'))

    # RF AMP -> DF AMP.
    k = base.crop((501, 40, 590, 95))
    wipe(k, (20, 5, 48, 21), 12)
    text(k, (34, 13), 'DF', 14, NAVY, 'mm')
    k.save(os.path.join(OUT, 'df-amp-key.png'))

    # Head mean -> DF Weight: keep the lamp slot at the left, clear the face,
    # a short red rule where the photo has one, the label along the bottom.
    k = base.crop((600, 47, 685, 93))
    wipe(k, (15, 3, 82, 43), 14)
    ImageDraw.Draw(k).line((22, 9, 46, 9), fill=(214, 40, 40), width=2)
    text(k, (50, 34), 'DF Weight', 11, INK, 'mm')
    k.save(os.path.join(OUT, 'df-weight-key.png'))

    # Section mean -> Target Wt: no lamp on this one, so the slot goes too. The
    # number above the label is written live by the app.
    k = base.crop((697, 47, 782, 93))
    wipe(k, (3, 3, 82, 43), 84)
    text(k, (42, 34), 'Target Wt', 11, INK, 'mm')
    k.save(os.path.join(OUT, 'df-target-key.png'))


def preset():
    cap = Image.open(os.path.join(PUB, 'captured/pf-df-selected.jpg')).convert('RGB')
    # The (1) under the DF bar, painted blue by the program when DF is picked.
    cap.crop((348, 249, 374, 286)).save(os.path.join(OUT, 'pf-df-on.png'))
    # The Target Wt key, its 500 erased.
    k = cap.crop((203, 99, 297, 153))
    wipe(k, (26, 16, 88, 36), 12)
    k.save(os.path.join(OUT, 'pf-target-wt-key.png'))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    production()
    preset()
    print('wrote', sorted(os.listdir(OUT)))
