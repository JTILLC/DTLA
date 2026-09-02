#!/usr/bin/env python3
"""Make the Zero Adjustment selection states from our own artwork.

On the real unit, Slct All WH turns every weigh hopper blue and Slct All DF
turns the dispersion table blue: blue means selected, and Start only runs on
what is selected. The extracted screen shows everything DESELECTED, and the
movie recolors the shapes at runtime, so there is no second bitmap to extract.

Rather than photograph the selected states under the emulator — which would put
Ruffle's rendering into the shipped art — the shapes are found in our own
screenshot and recolored here. The screen stays pixel-accurate; only the fill
of the hoppers and the disc changes, the way the machine changes it.

The shapes are separable by color alone: the hoppers and the disc are
achromatic 3D renders, the wallpaper behind them is blue-purple, and the head
numbers and weights are blue text. What is left after taking the achromatic
pixels is exactly the parts that light up.

    python3 tools/tint_selection.py public/screens/zero-adjust.jpg public/screens
"""
import os
import sys

import numpy as np
from PIL import Image

# Measured on individual hopper faces, against a verified capture of the
# running original showing the ring selected:
#
#   hopper 8   off (108,109,128) -> on (75,75,202)
#   hopper 1   off (150,152,185) -> on (93,95,210)
#   hopper 11  off (160,161,167) -> on (74,74,193)
#
# Note the output barely moves while the input spans 108-160: selecting does
# not scale the grey, it REPLACES it with a blue that keeps only a little of
# the original shading. A per-channel multiply reproduces neither the hue nor
# that compression — it just washes the shapes out — so the shade is rebuilt
# from luminance instead.
BLUE_BASE = (38, 39, 148)   # the colour at zero luminance
BLUE_GAIN = (0.30, 0.30, 0.35)   # how much of the original shading survives


def recolor(value):
    return tuple(BLUE_BASE[c] + value * BLUE_GAIN[c] for c in range(3))


TOP_BAR = 40      # title bar — never part of the ring
BOTTOM_BAR = 440  # fixed key bar


def shape_mask(rgb):
    """The hoppers and the dispersion table: everything that is not wallpaper.

    Keying on the SHAPES' own colour fails — their shaded interiors are noisy
    after JPEG, so the mask comes out full of pinholes and recolouring stipples
    it. The wallpaper behind them, by contrast, is one flat purple. Masking what
    is NOT wallpaper gives solid shapes, dark interiors included.
    """
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # Sampled from an empty corner of the screen area.
    br, bg, bb = 125, 132, 238
    wallpaper = (abs(r - br) < 26) & (abs(g - bg) < 26) & (abs(b - bb) < 26)
    m = ~wallpaper
    m[:TOP_BAR, :] = False
    m[BOTTOM_BAR:, :] = False
    # The head numbers and weights are blue text ON the shapes, so they are
    # already inside the mask and recolour with them, exactly as the unit does.
    return m


# The dispersion table, measured on the artwork and checked by drawing it back
# over the screen. Separating it from the ring geometrically beats connected
# components here: JPEG noise speckles the masks and fragments the flood fill.
TABLE = {'cx': 420, 'cy': 233, 'rx': 148, 'ry': 70}


def split(mask):
    """(hoppers, dispersion table) — the table is what falls inside the ellipse."""
    h, w = mask.shape
    yy, xx = np.mgrid[0:h, 0:w]
    inside = (((xx - TABLE['cx']) / TABLE['rx']) ** 2
              + ((yy - TABLE['cy']) / TABLE['ry']) ** 2) <= 1.0
    return mask & ~inside, mask & inside


# The head numbers and weights are printed in the RCU's blue on the grey
# shapes. Recoloured with everything else they vanish into the new blue, so
# they are lifted to near-white instead — which is how they read on the real
# unit once a hopper is selected.
TEXT_ON_BLUE = (235, 238, 255)


def text_mask(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return (r < 120) & (g < 120) & (b > 110) & (b - r > 45)


def tinted(rgb, mask):
    """Recolor the masked shapes to the selected blue, keeping their shading."""
    out = rgb.astype(float).copy()
    lum = rgb.astype(float).mean(axis=2)
    text = text_mask(rgb.astype(int)) & mask
    fill = mask & ~text
    for c in range(3):
        ch = out[..., c]
        ch[fill] = np.clip(BLUE_BASE[c] + lum[fill] * BLUE_GAIN[c], 0, 255)
        ch[text] = TEXT_ON_BLUE[c]
    return out.astype('uint8')


def main(src, outdir):
    im = Image.open(src).convert('RGB')
    rgb = np.asarray(im)
    mask = shape_mask(rgb)
    hoppers, disc = split(mask)
    print('hoppers %d px, dispersion table %d px' % (hoppers.sum(), disc.sum()))

    stem = os.path.splitext(os.path.basename(src))[0]
    for name, m in (('wh', hoppers), ('df', disc), ('wh-df', hoppers | disc)):
        path = os.path.join(outdir, f'{stem}--{name}.jpg')
        Image.fromarray(tinted(rgb, m)).save(path, quality=92)
        print('  wrote', path)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
