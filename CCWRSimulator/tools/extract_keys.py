#!/usr/bin/env python3
"""Cut the lit Power and Start keys out of a powered capture.

The screen artwork is a fixed JPEG of a machine with its control power OFF: the
Power key is red and Start is dimmed. Pressing Power in the simulator has to
show that, and there is no way to recolour baked pixels.

Duplicating all 66 screens in a powered variant would be 16MB of near-identical
art, and worse, it would assert a powered look for screens where we never
checked what the bottom bar does. So only the two keys that change are cut out,
and the app lays them over the artwork where — and only where — we observed
them to be live.

Source is a Ruffle capture, so these carry Ruffle's rendering. They are two
small keys, and the alternative was showing a red Power key while claiming the
machine is on.

    python3 tools/extract_keys.py <powered-capture.png> <outdir>
"""
import os
import sys

from PIL import Image

# Movie-space rects, the same coordinates the navmap uses.
KEYS = {
    'power-on': (504, 528, 593, 591),
    'start-on': (702, 528, 790, 590),
}


def main(capture, outdir):
    im = Image.open(capture).convert('RGB')
    # Captures are taken at the canvas's own backing store, larger than 800x600.
    scale = im.width / 800.0
    os.makedirs(outdir, exist_ok=True)
    for name, (x0, y0, x1, y1) in KEYS.items():
        box = tuple(round(v * scale) for v in (x0, y0, x1, y1))
        key = im.crop(box)
        path = os.path.join(outdir, name + '.png')
        key.save(path)
        print('%-10s movie %s -> %s  %dx%d' % (name, (x0, y0, x1, y1), path, *key.size))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
