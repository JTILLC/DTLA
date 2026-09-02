#!/usr/bin/env python3
"""
Turn the raw button dump (extract_swf.py nav) into the simulator's map.

Reads assets/screens.json for the frame->slug mapping and the raw nav JSON for
button geometry, keeps only buttons that navigate to a screen we ship, and
writes src/data/navmap.json. The odd frames out:

- total-select (frame 2) is the main menu with its Select Total drawer pulled
  out; we ship main-menu only, and retarget anything aimed at it.
- reset (frame 1080) is the projector's reboot animation, not an RCU screen.
- main-menu / various-fd / various-hdrv backgrounds were pulled from the
  sprite pool (0035 / 1386 / 1401); copy_backgrounds() below places them.

Usage: python3 tools/build_navmap.py <nav_raw.json>
"""
import json, os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DROP = {'total-select', 'reset'}
RETARGET = {'total-select': 'main-menu'}
# Backgrounds the screen extractor missed because they are placed once on
# frame 1 and never re-placed; found by size (800x600) in the sprite pool
# and identified by eye.
SPRITE_BACKGROUNDS = {'main-menu': '0035.jpg',
                      'various-fd': '1386.jpg',
                      'various-hdrv': '1401.jpg'}
# (slug, button id) pairs verified wrong against the screenshots; none today,
# kept as the curation hook for anything a future re-extraction drags in.
PRUNE = set()


def build(raw_path):
    man = json.load(open(os.path.join(ROOT, 'assets', 'screens.json')))
    raw = json.load(open(raw_path))
    by_label = {s['labelJa']: s['slug'] for s in man['screens']}

    screens = {}
    for s in man['screens']:
        slug = s['slug']
        if slug in DROP:
            continue
        screens[slug] = {
            'frame': s['frame'],
            'labelJa': s['labelJa'],
            'image': 'screens/%s.jpg' % slug,
            'hotspots': [],
        }

    for f in raw:
        slug = by_label.get(f['label'])
        if slug is None or slug in DROP:
            continue
        seen = set()
        for b in f['buttons']:
            targets = set()
            for lab in b['gotoLabels']:
                t = by_label.get(lab)
                if t:
                    targets.add(RETARGET.get(t, t))
            # Frame-number gotos are ignored on purpose: the only ones in the
            # movie are a hidden popup element's gotoAndStop(1), which would
            # put an invisible main-menu hotspot mid-screen on every frame.
            targets.discard(slug)          # already-selected tab, self loops
            if len(targets) != 1:
                continue                   # no target, or ambiguous: skip
            to = targets.pop()
            if to in DROP or to not in screens:
                continue
            if (slug, b['button']) in PRUNE:
                continue
            for r in b['rects']:
                x, y, w, h = r
                # clamp to the 800x600 canvas
                x2, y2 = min(800, x + w), min(600, y + h)
                x, y = max(0, x), max(0, y)
                if x2 - x < 4 or y2 - y < 4:
                    continue
                key = (round(x), round(y), round(x2), round(y2), to)
                if key in seen:
                    continue
                seen.add(key)
                screens[slug]['hotspots'].append({
                    'x': round(x), 'y': round(y),
                    'w': round(x2 - x), 'h': round(y2 - y),
                    'to': to, 'button': b['button'],
                })

    # The Machine Set pop-up key (Operation Manual 6.4, Table 6-6 key #8).
    # Its menu is data-driven ActionScript in the movie, so the item list is
    # reconstructed: one entry per screen family the movie contains, labelled
    # with the header each family's screens carry in their own art, ordered as
    # the families sit on the movie's timeline. The tab itself is baked into
    # the art at (168,496)-(331,518) on exactly the 31 family screens
    # (verified by pixel-comparing that region across all 58 screens); the
    # main menu's art lacks it, so the app draws it there (drawTabOn).
    tab_screens = sorted(
        s for s in screens
        if s.split('-')[0] in ('manual', 'selfdiag', 'display', 'various',
                               'weigh', 'pack', 'autoadj'))
    out = {
        'canvas': {'w': 800, 'h': 600},
        'machineSet': {
            'tab': {'x': 168, 'y': 496, 'w': 163, 'h': 22},
            'screens': tab_screens,
            'drawTabOn': ['main-menu'],
            'items': [
                {'label': 'Manual Adjustment', 'to': 'manual-scale-adjust'},
                {'label': 'Self-diagnosis', 'to': 'selfdiag-device'},
                {'label': 'Display & Data Manager', 'to': 'display-screen'},
                {'label': 'Various Parameter Setting', 'to': 'various-scale-detail'},
                {'label': 'Weigher Setting', 'to': 'weigh-participation'},
                {'label': 'Peripheral Equipment Setting', 'to': 'pack-bagmaker'},
                {'label': 'Auto Adjustment', 'to': 'autoadj-afv'},
            ],
        },
        'screens': screens,
    }
    dest = os.path.join(ROOT, 'src', 'data', 'navmap.json')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    json.dump(out, open(dest, 'w'), indent=1, ensure_ascii=False)
    n = sum(len(s['hotspots']) for s in screens.values())
    print('%d screens, %d hotspots -> %s' % (len(screens), n, dest))


def copy_backgrounds():
    """Fill public/screens with every screen's art, sprite-pool ones included."""
    pub = os.path.join(ROOT, 'public', 'screens')
    os.makedirs(pub, exist_ok=True)
    src = os.path.join(ROOT, 'assets', 'screens')
    for name in os.listdir(src):
        if name.endswith('.jpg'):
            shutil.copy(os.path.join(src, name), os.path.join(pub, name))
    for slug, sprite in SPRITE_BACKGROUNDS.items():
        shutil.copy(os.path.join(ROOT, 'assets', 'sprites', sprite),
                    os.path.join(pub, '%s.jpg' % slug))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    build(sys.argv[1])
    copy_backgrounds()
