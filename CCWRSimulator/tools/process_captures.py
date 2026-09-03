#!/usr/bin/env python3
"""
Turn the Ruffle captures into screens the app can serve.

The harness grabs the stage at its backing-store size, 1439x1079 — nearly 2x
the RCU's 800x600 — so each capture is downsampled with Lanczos, which is
supersampling and comes out sharper than a 1:1 render would. They are written
as JPEG at a quality where the text stays crisp; the extracted artwork in
public/screens is JPEG too, so nothing looks out of place beside it.

Exact-duplicate captures (the same state grabbed twice under different names)
are folded: only the first name is written, and the manifest maps the others
to it so a state can be referred to by whichever name was used.

    python3 tools/process_captures.py [tools/original/captures] [public/captured]
"""
import hashlib
import json
import os
import sys

from PIL import Image

SIZE = (800, 600)
QUALITY = 90


def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    manifest_path = os.path.join(dst, 'manifest.json')
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    by_hash, written, aliased = {}, 0, 0

    for name in sorted(os.listdir(src)):
        if not name.endswith('.png') or name.startswith('probe'):
            continue
        stem = name[:-4]
        data = open(os.path.join(src, name), 'rb').read()
        digest = hashlib.sha1(data).hexdigest()
        if digest in by_hash:
            manifest[stem] = {'alias': by_hash[digest]}
            aliased += 1
            continue
        by_hash[digest] = stem
        out = os.path.join(dst, stem + '.jpg')
        if manifest.get(stem, {}).get('sha1') != digest or not os.path.exists(out):
            im = Image.open(os.path.join(src, name)).convert('RGB')
            if im.size != SIZE:
                im = im.resize(SIZE, Image.LANCZOS)
            im.save(out, quality=QUALITY, optimize=True)
            written += 1
        manifest[stem] = {'sha1': digest, 'file': 'captured/%s.jpg' % stem}

    json.dump(manifest, open(manifest_path, 'w'), indent=1, sort_keys=True)
    print('%d states, %d written, %d aliases' % (len(by_hash), written, aliased))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'tools/original/captures',
         sys.argv[2] if len(sys.argv) > 2 else 'public/captured')
