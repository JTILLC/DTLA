#!/usr/bin/env python3
"""
Preset > Timing Adjustment, drawn live.

Captured off the running program (2026-09-03), one grab per selected row:
the highlight band moves, the 3-D cutaway paints the hoppers the row is about
(weigh hoppers for WH-DS / IS-WH / WH-ON, pool hoppers for PH-RF / PH-ON), and
the DS/IS tags and the blue arrow change with it. Those seven captures become
the screen's backgrounds, one per selected row, with the value cells and the
bar cells erased so the app can write the live numbers and draw the bars.

The bars are a timeline: WH-DS 110 ms is 4 px, WH-ON 450 is 17, and 1105 ms
entered on the keypad drew 38-40 px - about 0.036 px per ms - and the two PH
rows start where WH-PH ends. Measured on the 800x600 downsamples.

    python3 tools/timing_table.py
"""
import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')
OUT = os.path.join(PUB, 'derived')

ROWS = ['whds', 'iswh', 'whph', 'phrf', 'stagger', 'whon', 'phon']
# Row bands (top, bottom) on the capture, the value cell and the bar cell.
BANDS = [(117, 129), (135, 146), (152, 163), (168, 181), (186, 198), (202, 215), (220, 232)]
VALUE_X = (400, 467)
BAR_X = (468, 572)


def load(name):
    manifest = json.load(open(os.path.join(PUB, 'captured/manifest.json')))
    entry = manifest[name]
    if 'alias' in entry:
        entry = manifest[entry['alias']]
    return Image.open(os.path.join(PUB, entry['file'])).convert('RGB')


def main():
    os.makedirs(OUT, exist_ok=True)
    for row in ROWS:
        im = load('pt-row-' + row)
        px = im.load()
        for (y0, y1) in BANDS:
            # The digits hang a few px below the band, into the gap that holds
            # the row separator; x=380 carries that separator too, so copying
            # it across keeps the line and loses the digits.
            for y in range(y0 - 1, y1 + 5):
                # The cell's own background, taken from the gap between the
                # label and the number, so a selected row stays band-blue.
                c = px[380, y]
                for x in range(VALUE_X[0], BAR_X[1] + 1):
                    px[x, y] = c
        im.save(os.path.join(OUT, 'pt-row-%s.jpg' % row), quality=92, optimize=True)
    print('wrote', ['pt-row-%s.jpg' % r for r in ROWS])


if __name__ == '__main__':
    main()
