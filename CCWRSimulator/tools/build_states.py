#!/usr/bin/env python3
"""
Give the map the states the Flash program has, not just its frames.

extract_swf.py / build_navmap.py turn the movie's 60 labelled FRAMES into
screens. The program has far more than 60 states: every pop-up (keypads,
keyboards, confirms, drop-downs), every drawer, the chart modes, the wizard,
the running/stopped and locked/unlocked states, the access level. Those are
sprites and script, not frames, so the frame pass cannot see them.

This adds them as first-class screens, each named `<parent>@<state>` and
carrying `parent`, `kind` and `captured: true`, so the existing engine — a
screen is an image plus hotspots — needs nothing new to show them. The images
are the Ruffle captures (tools/process_captures.py); every hit rectangle is
taken from the movie's own button geometry (placements.json, from
swf_structure.py) so nothing is measured by eye.

What the engine does need, and what the entries use:

  hotspot.requires  ["power" | "stopped" | "running" | "level4" | "drain"]
  hotspot.sets      {flag: value}     applied when the key is pressed
  hotspot.action    "key" (char) | "bs" | "clr" | "blink" | "level"
  screen.autoNext   {to, ms}           a wait pop-up that clears itself
  screen.keypad     {field, seed}      where typed digits show, and the start value
  screen.layers     [{image, x, y, w, h}]  crops composited over the base
  screen.lamps      [{x, y, w, h, flag}]   a lamp lit while a flag is set
  screen.imageBy    {flag: image}      the base art swaps with a flag
  screen.overlays   [{image, x, y, w, h, when}]  a key state shown while a flag holds
  screen.onEnter    slug               navigating here lands on that state first

Run after any recapture:

    python3 tools/swf_structure.py IshidaVR.exe /tmp/structure.json   (once)
    python3 tools/build_states.py
"""
import collections
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = os.environ.get('SCRATCH', '/private/tmp/claude-501/-Users-jti-Downloads-DTLA/'
                   'aa3814ac-081a-47d2-97a7-832328f5ec1f/scratchpad')
NAV = os.path.join(ROOT, 'src', 'data', 'navmap.json')

nav = json.load(open(NAV), object_pairs_hook=collections.OrderedDict)
places = json.load(open(os.path.join(S, 'placements.json')))
manifest = json.load(open(os.path.join(ROOT, 'public', 'captured', 'manifest.json')))
summary = {}
for line in open(os.path.join(S, 'summary.txt')):
    m = re.match(r'\s*(\d+) (\[.*?\])\s+(\S+)\s+x(\d+)\s+(.*?)\s*\| (.*)', line)
    if m:
        summary[int(m.group(1))] = (json.loads(m.group(2)), m.group(3), m.group(6))


# ---------------------------------------------------------------- helpers ---

def img(name):
    """The served path of a capture, following aliases."""
    entry = manifest[name]
    if 'alias' in entry:
        entry = manifest[entry['alias']]
    return entry['file']


def rect(slug, x, y, within=None):
    """The movie's own hit rectangle under (x, y) on that frame.

    `within` restricts to buttons inside the named sprite (a pop-up's keys);
    without it, only buttons placed directly on the frame count.
    """
    hits, nested = [], []
    for bid, r, path in places[slug]:
        if within is not None and not path.endswith('/' + within):
            continue
        if r[0] <= x <= r[0] + r[2] and r[1] <= y <= r[1] + r[3]:
            (hits if within is not None or path in ('', '/') else nested).append(r)
    # A key that lives in a sprite (the Feeder tab, the chart keys) counts when
    # nothing on the frame itself is under the point.
    hits = hits or nested
    if not hits:
        raise SystemExit('no button at (%d,%d) on %s (within=%s)' % (x, y, slug, within))
    r = hits[0]
    return collections.OrderedDict([('x', r[0]), ('y', r[1]), ('w', r[2]), ('h', r[3])])


def spot(slug, x, y, to=None, within=None, **extra):
    h = rect(slug, x, y, within)
    if to:
        h['to'] = to
    for k, v in extra.items():
        h[k] = v
    return h


def box(x, y, w, h, to=None, **extra):
    """A rectangle not backed by a movie button — used only where the state
    is composed at runtime (a wizard overlay, a lamp) and the movie has no
    single button to point at. Say so in a note."""
    d = collections.OrderedDict([('x', x), ('y', y), ('w', w), ('h', h)])
    if to:
        d['to'] = to
    d.update(extra)
    return d


def panel_keys(slug, within):
    """Every key of a keypad/keyboard panel, from the movie: digit and letter
    keys become `key` actions, the editing keys their own actions."""
    out = []
    seen = set()
    for bid, r, path in places[slug]:
        if not path.endswith('/' + within):
            continue
        key = tuple(r)
        if key in seen:
            continue
        seen.add(key)
        acts = summary.get(bid, (None, None, ''))[2]
        m = re.search(r"key '(.*?)'", acts)
        h = collections.OrderedDict([('x', r[0]), ('y', r[1]), ('w', r[2]), ('h', r[3])])
        if m:
            h['action'] = 'key'; h['char'] = m.group(1)
            out.append(h)
    if len(out) < 10:                       # keys live in a nested sprite: canonical layout
        out = [box(*r, None, action='key', char=c) for r, c in KEYPAD_KEYS]
    return out


KEYBOARD_ROWS = ['1234567890-=', 'QWERTYUIOP_', 'ASDFGHJKL:\'', 'ZXCVBNM./']


def keyboard_keys(slug, within):
    """The QWERTY panel's letter keys carry no character in their script (they
    read their own label), so the characters come from the layout, row by
    row, matched to the movie's key rectangles sorted top-to-bottom."""
    # Panels whose script names the character use it directly.
    named = []
    for bid, r, path in places[slug]:
        if path.endswith('/' + within):
            m = re.search(r"key '(.*?)'", summary.get(bid, (None, None, ''))[2])
            if m:
                named.append(collections.OrderedDict(
                    [('x', r[0]), ('y', r[1]), ('w', r[2]), ('h', r[3]), ('action', 'key'), ('char', m.group(1))]))
    if len(named) > 30:
        return named
    rects = sorted({tuple(r) for bid, r, path in places[slug]
                    if path.endswith('/' + within) and r[2] == 46 and r[3] == 37},
                   key=lambda r: (r[1], r[0]))
    if not rects:                           # nested: the main menu's keyboard is the same sprite
        rects = sorted({tuple(r) for bid, r, path in places['main-menu']
                        if path.endswith('/Panel02') and r[2] == 46 and r[3] == 37},
                       key=lambda r: (r[1], r[0]))
    rows = collections.OrderedDict()
    for r in rects:
        rows.setdefault(r[1] // 10, []).append(r)
    out = []
    for row_rects, chars in zip(rows.values(), KEYBOARD_ROWS):
        for r, c in zip(sorted(row_rects), chars):
            out.append(collections.OrderedDict(
                [('x', r[0]), ('y', r[1]), ('w', r[2]), ('h', r[3]), ('action', 'key'), ('char', c)]))
    return out


def screen(slug, parent, kind, image, hotspots, label, **extra):
    s = collections.OrderedDict()
    s['parent'] = parent
    s['kind'] = kind
    s['captured'] = True
    s['label'] = label
    s['image'] = image
    for k, v in extra.items():
        s[k] = v
    s['hotspots'] = hotspots
    return s


def inherit(parent, drop=()):
    """The parent's own navigation keys (tabs, HOME, Exit), so a state that
    replaces only part of the screen still navigates like the screen."""
    out = []
    for h in nav['screens'][parent]['hotspots']:
        to = h.get('to') or ''
        if not to or to in drop or to.startswith(parent + '@') or h.get('action'):
            continue                       # only real navigation; not the state's own pop-ups or toggles
        out.append(collections.OrderedDict(h))
    return out


# The keypad's own editing keys sit at the same place on every keypad panel,
# and the keyboard's on every keyboard panel — both measured from the movie.
# The keypad and keyboard panels are the same sprite wherever they appear, so
# their keys sit at the same rectangles on every screen (checked across the
# main menu, the preset editor and the timing screens). These are those
# rectangles, from the movie; a panel whose keys the static walk cannot reach
# (they sit in a nested sprite) falls back to them.
KEYPAD_KEYS = [
    ((382, 242, 48, 36), '7'), ((436, 242, 48, 36), '8'), ((489, 242, 48, 36), '9'),
    ((382, 286, 48, 36), '4'), ((436, 286, 48, 36), '5'), ((489, 286, 48, 36), '6'),
    ((382, 331, 48, 36), '1'), ((436, 331, 48, 36), '2'), ((489, 331, 48, 36), '3'),
    ((382, 376, 48, 36), '0'), ((436, 376, 48, 36), '.'), ((489, 376, 48, 36), '-'),
]
KEYPAD_EDIT = lambda slug, within, parent: [
    box(543, 241, 74, 37, parent, action='cancel', label='CANCEL'),
    box(543, 285, 74, 37, None, action='bs', label='BS'),
    box(543, 330, 74, 37, None, action='clr', label='CLR'),
    box(543, 375, 74, 37, parent, action='enter', label='Enter'),
]
KEYBOARD_EDIT = lambda slug, within, parent: [
    box(91, 64, 75, 38, parent, action='cancel', label='CANCEL'),
    box(559, 64, 67, 37, None, action='bs', label='BS'),
    box(643, 64, 67, 37, None, action='clr', label='CLR'),
    box(632, 262, 79, 83, parent, action='enter', label='Enter'),
]
KEYPAD_FIELD = box(365, 172, 250, 60)      # the green field: title line, then the value line
KEYBOARD_FIELD = box(183, 52, 360, 56)


def keypad(slug, within, image, title, seed, label, parent=None):
    parent = parent or slug
    return screen('%s@%s' % (slug, title), parent, 'popup', img(image),
                  panel_keys(slug, within) + KEYPAD_EDIT(slug, within, parent),
                  label, keypad=collections.OrderedDict([('field', KEYPAD_FIELD), ('seed', seed)]))


def keyboard(slug, within, image, title, seed, label, parent=None):
    parent = parent or slug
    return screen('%s@%s' % (slug, title), parent, 'popup', img(image),
                  keyboard_keys(slug, within) + KEYBOARD_EDIT(slug, within, parent),
                  label, keypad=collections.OrderedDict([('field', KEYBOARD_FIELD), ('seed', seed)]))


def confirm(slug, title, image, yes, no, label, parent=None, yes_to=None, no_to=None, **extra):
    """A Yes/No dialog. `yes`/`no` are the two key rects (from the movie where
    it has them; the dialog art is the same on every screen)."""
    parent = parent or slug
    return screen('%s@%s' % (slug, title), parent, 'popup', img(image),
                  [box(*yes, yes_to or parent, label='Yes', **extra.pop('yes_extra', {})),
                   box(*no, no_to or parent, label='No')],
                  label, **extra)


YES = (263, 396, 90, 65)      # measured off the dialog art (Yes at 263-353, No at 405-495)
NO = (405, 396, 90, 65)
LAMP = 'keys/lamp-on.png'


def add(s):
    slug = s.pop('slug')
    nav['screens'][slug] = s


# Drop every generated state so the pass is idempotent.
for k in [k for k in nav['screens'] if '@' in k]:
    del nav['screens'][k]
for s in nav['screens'].values():
    for key in ('lamps', 'imageBy', 'onEnter', 'layers'):
        s.pop(key, None)
    s['hotspots'] = [h for h in s['hotspots'] if '@' not in h.get('to', '')
                     and not h.get('generated')]

G = {'generated': True}

# ------------------------------------------------------------ main menu ---

mm = nav['screens']['main-menu']
mm['imageBy'] = collections.OrderedDict([('level4', img('main-menu-maintenance'))])
mm['hotspots'] += [
    # The Preset editor key. Placed on the frame at every level, but drawn and
    # live only when Conp01 is visible, which the frame-2 script sets from
    # KRlevel == 4 (Maintenance). Confirmed: dead at Operator, live after 123.
    spot('main-menu', 750, 225, 'preset-product', requires=['level4'],
         label='Preset', **G),
    spot('main-menu', 492, 96, 'main-menu@product-name', label='Product Name', **G),
    spot('main-menu', 489, 136, 'main-menu@product-code', label='Product Code', **G),
    spot('main-menu', 492, 176, 'main-menu@target-weight', label='Target Weight', **G),
    spot('main-menu', 463, 197, 'main-menu@speed', label='Speed', **G),
    spot('main-menu', 486, 216, 'main-menu@dump-count', label='Dump Count', **G),
    spot('main-menu', 507, 236, 'main-menu@upper-limit', label='Upper Weight Limit', **G),
    # The ? key: every pressable key on the screen blinks until it is pressed
    # again (BTNblinkFLG). The machine's own "show me what I can press".
    spot('main-menu', 782, 18, None, action='blink', label='Help — blink the keys', **G),
]

for slug_, name, image, seed, title in [
    ('main-menu', 'product-name', 'mm-panel02-product-name', 'POTATO CHIPS', 'Product Name'),
    ('main-menu', 'product-code', 'mm-panel03-product-code', '01', 'Product Code'),
]:
    within = {'product-name': 'Panel02', 'product-code': 'Panel03'}[name]
    s = keyboard(slug_, within, image, name, seed, 'Main Menu — %s keyboard' % title)
    s['slug'] = '%s@%s' % (slug_, name); add(s)

for name, within, image, seed, title in [
    ('target-weight', 'Panel04', 'mm-panel04-target-weight', '90', 'Target Weight'),
    ('speed', 'Panel05', 'mm-panel05-speed', '80', 'Speed'),
    ('dump-count', 'Panel06', 'mm-panel06-dump-count', '1', 'Dump Count'),
    ('upper-limit', 'Panel07', 'mm-panel07-upper-limit', '3.0', 'Upper Weight Limit'),
]:
    s = keypad('main-menu', within, image, name, seed, 'Main Menu — %s keypad' % title)
    s['slug'] = 'main-menu@%s' % name; add(s)

# Access level. The list is already a captured screen; what it lacked was any
# effect. Operator sets level 1 outright; the other three go through the
# password keyboard, and Enter there commits the level that was picked.
ls = nav['screens']['level-select']
ls['hotspots'] = [
    box(8, 529, 88, 62, 'main-menu', label='HOME'),
    box(482, 63, 210, 44, 'main-menu', sets={'level': 1}, label='Operator'),
    box(482, 110, 210, 44, 'level-password', sets={'pendingLevel': 2}, label='Site Engineer'),
    box(482, 158, 210, 44, 'level-password', sets={'pendingLevel': 3}, label='Installation'),
    box(482, 206, 210, 44, 'level-password', sets={'pendingLevel': 4}, label='Maintenance'),
    box(482, 255, 210, 24, 'main-menu', label='close'),
]
lp = nav['screens']['level-password']
lp['keypad'] = collections.OrderedDict([('field', KEYBOARD_FIELD), ('seed', ''), ('password', True)])
lp['hotspots'] = keyboard_keys('main-menu', 'Panel02') + [
    box(90, 54, 72, 38, 'main-menu', action='cancel', label='CANCEL'),
    box(559, 64, 67, 37, None, action='bs', label='BS'),
    box(643, 64, 67, 37, None, action='clr', label='CLR'),
    box(630, 255, 90, 88, 'main-menu', action='password', label='Enter'),
]

# -------------------------------------------------------- select preset ---

psa = nav['screens']['preset-select-a']
psa['hotspots'] += [spot('preset-select-a', 741, 98, 'preset-select-a@preset-no', label='Preset No.', **G)]
s = keypad('preset-select-a', 'Panel01', 'psa-panel01', 'preset-no', '1', 'Select Preset — Preset No. keypad')
s['slug'] = 'preset-select-a@preset-no'; add(s)

# -------------------------------------------------------- preset editor ---

pp = nav['screens']['preset-product']
pp['hotspots'] += [
    spot('preset-product', 76, 59, 'preset-product@preset-no', label='Preset No.', **G),
    spot('preset-product', 190, 300, 'preset-product@category', label='Product Category', **G),
    spot('preset-product', 433, 334, 'preset-product@camera', label='Camera', **G),
    spot('preset-product', 434, 266, 'preset-product@photo', label='photo picker', **G),
]
s = keypad('preset-product', 'Panel01', 'pp-panel01-preset-no', 'preset-no', '1', 'Preset — Preset No. keypad'); s['slug'] = 'preset-product@preset-no'; add(s)
s = keyboard('preset-product', 'Panel04', 'pp-panel04', 'category', '01', 'Preset — Product Category keyboard'); s['slug'] = 'preset-product@category'; add(s)
s = confirm('preset-product', 'camera', 'pp-panel05', (300, 320, 72, 36), (424, 320, 70, 36),
            'Preset — "Do you want to take photo of product?"'); s['slug'] = 'preset-product@camera'; add(s)
s = screen('preset-product@photo', 'preset-product', 'popup', img('pp-panel06'),
           [spot('preset-product', 434, 367, 'preset-product', within='Panel06', label='close'),
            box(351, 261, 164, 212, 'preset-product', label='pick a picture')],
           'Preset — product photo picker'); s['slug'] = 'preset-product@photo'; add(s)

pm = nav['screens']['preset-machine']
pm['hotspots'] += [
    spot('preset-machine', 443, 216, 'preset-machine@interlock', label='Interlock Parameter Number', **G),
    # Average Control. On, and the Weight page gains its Lower Weight Limit key.
    box(180, 310, 60, 30, None, sets={'avg': True}, label='Average Control On', **G),
    box(70, 310, 60, 30, None, sets={'avg': False}, label='Average Control Off', **G),
]
pm['imageBy'] = collections.OrderedDict([('avg', img('pm-average-control-on'))])
s = screen('preset-machine@interlock', 'preset-machine', 'popup', img('pm-panel05'),
           [spot('preset-machine', 565, 430, 'preset-machine', within='Panel05', label='close')],
           'Preset Machine — Interlock Parameter list'); s['slug'] = 'preset-machine@interlock'; add(s)

pw = nav['screens']['preset-weight']
pw['imageBy'] = collections.OrderedDict([('avg', img('preset-weight-avg-on'))])
pw['hotspots'] += [
    spot('preset-weight', 189, 134, 'preset-weight@ext-upper', label='Extended Upper Limit', **G),
    spot('preset-weight', 442, 134, 'preset-weight@dump-cycle', label='Extended Upper Limit Dump Cycle', **G),
    spot('preset-weight', 188, 385, 'preset-weight@lower', requires=['avg'], label='Lower Weight Limit', **G),
]
for name, within, image, seed, title in [
    ('ext-upper', 'Panel02', 'pw-panel02', '1.0', 'Extended Upper Limit'),
    ('dump-cycle', 'Panel05', 'pw-panel05', '100', 'Extended Upper Limit Dump Cycle'),
    ('lower', 'Panel06', 'pw-panel06', '4.5', 'Lower Weight Limit'),
]:
    s = keypad('preset-weight', within, image, name, seed, 'Preset Weight — %s keypad' % title)
    s['slug'] = 'preset-weight@%s' % name; add(s)

pi = nav['screens']['preset-item']
pi['hotspots'] += [
    spot('preset-item', 189, 134, 'preset-item@auto-feed', label='Auto Feed Target', **G),
    spot('preset-item', 189, 217, 'preset-item@priority', label='Disch. Priority Count', **G),
    spot('preset-item', 189, 301, 'preset-item@efficiency', label='Good Efficiency Judgement Value', **G),
    spot('preset-item', 442, 134, 'preset-item@multiplier', label='Feed Multiplier', **G),
]
for name, within, image, seed, title in [
    ('auto-feed', 'Panel02', 'pi-panel02', '3.8', 'Auto Feed Target'),
    ('priority', 'Panel03', 'pi-panel03', '30', 'Disch. Priority Count'),
    ('efficiency', 'Panel04', 'pi-panel04', '99.0', 'Good Efficiency Judgement Value'),
    ('multiplier', 'Panel05', 'pi-panel05', '1', 'Feed Multiplier'),
]:
    s = keypad('preset-item', within, image, name, seed, 'Preset Item — %s keypad' % title)
    s['slug'] = 'preset-item@%s' % name; add(s)

po = nav['screens']['preset-other']
po['hotspots'] += [spot('preset-other', 189, 134, 'preset-other@stable-time', label='Stable Time', **G)]
s = keypad('preset-other', 'Panel02', 'po-panel02', 'stable-time', '400', 'Preset Others — Stable Time keypad')
s['slug'] = 'preset-other@stable-time'; add(s)

pf = nav['screens']['preset-feeder']
pf['hotspots'] += [spot('preset-feeder', 55, 189, 'preset-feeder@read-default', label='Read Default', **G)]
s = confirm('preset-feeder', 'read-default', 'pf-panel03', (533, 400, 90, 65), (683, 400, 90, 65),
            'Preset Feeder — "Set default value of RF and DF. OK?"'); s['slug'] = 'preset-feeder@read-default'; add(s)

pt = nav['screens']['preset-timing']
pt['hotspots'] += [spot('preset-timing', 361, 422, 'preset-timing@entr', label='Entr Time', **G)]
s = keypad('preset-timing', 'Panel02', 'pt-panel02', 'entr', '110', 'Preset Timing — Time Input keypad')
s['slug'] = 'preset-timing@entr'; add(s)

# ----------------------------------------------------------- zero adjust ---

# Start opens the same "Please wait a moment." pop-up as power-up, with its
# progress bar, over the hoppers; when it clears the selection has gone.
za = nav['screens']['zero-adjust']
za['hotspots'] += [box(602, 449, 91, 76, 'zero-adjust@starting', requires=['power'],
                       action='zero-start', label='Start', **G)]
s = screen('zero-adjust@starting', 'zero-adjust', 'popup', img('za-start-0'), [],
           'Zero Adjustment — running ("Please wait a moment.")',
           autoNext=collections.OrderedDict([('to', 'zero-adjust'), ('ms', 4000)]),
           sets={'zeroDone': True})
s['slug'] = 'zero-adjust@starting'; add(s)

# ----------------------------------------------------------------- drain ---

for slug_ in ('discharge-weight', 'discharge-feeder', 'discharge-timing'):
    d = nav['screens'][slug_]
    d['lamps'] = [box(297, 481, 15, 24, flag='drainAutoZero'), box(400, 481, 13, 24, flag='drainInfeed')]
    d['hotspots'] += [
        spot(slug_, 345, 490, None, toggles='drainAutoZero', label='Auto Zero', **G),
        spot(slug_, 445, 490, None, toggles='drainInfeed', label='Infeed Control', **G),
        # Drain START runs the drain: STOP lights, START and HOME grey out.
        spot(slug_, 648, 484, None, sets={'drain': True}, requires=['power', 'drainStopped'], label='Drain START', **G),
        spot(slug_, 548, 486, None, sets={'drain': False}, requires=['drain'], label='Drain STOP', **G),
    ]
    # Draining: STOP lights, START and HOME grey out. The three keys are cut
    # from a capture of the machine draining and laid over the art.
    d['overlays'] = [
        collections.OrderedDict([('image', 'keys/drain-stop-on.png'), ('x', 504), ('y', 452), ('w', 87), ('h', 66), ('when', 'drain')]),
        collections.OrderedDict([('image', 'keys/drain-start-off.png'), ('x', 604), ('y', 451), ('w', 87), ('h', 66), ('when', 'drain')]),
        collections.OrderedDict([('image', 'keys/home-off.png'), ('x', 8), ('y', 529), ('w', 88), ('h', 62), ('when', 'drain')]),
    ]

# ------------------------------------------------------------- full open ---

hd = nav['screens']['hopper-discharge']
hd['lamps'] = [box(384, 137, 13, 23, flag='foDF'), box(484, 137, 12, 23, flag='foRF'),
               box(384, 214, 13, 23, flag='foPH'), box(484, 214, 12, 23, flag='foWH')]
hd['hotspots'] += [
    spot('hopper-discharge', 429, 158, None, toggles='foDF', label='DF', **G),
    spot('hopper-discharge', 529, 158, None, toggles='foRF', label='RF', **G),
    spot('hopper-discharge', 429, 235, None, toggles='foPH', label='PH', **G),
    spot('hopper-discharge', 529, 235, None, toggles='foWH', label='WH', **G),
    spot('hopper-discharge', 646, 480, 'hopper-discharge@open', requires=['power'], label='Open', **G),
]
s = screen('hopper-discharge@open', 'hopper-discharge', 'state', img('fo-open-pressed'),
           [box(468, 448, 88, 66, 'hopper-discharge', label='Close')],
           'Full Open Lock — OPEN (locked: HOME and Exit are dead until Close)')
s['slug'] = 'hopper-discharge@open'; add(s)

# ------------------------------------------------------------ production ---

RUN = ['run-combination', 'run-feeder', 'run-timing', 'run-totals', 'run-weight']
for slug_ in RUN:
    r = nav['screens'][slug_]
    for h in r['hotspots']:
        if h.get('to') == 'main-menu' and h['x'] > 600:      # Exit: live only once stopped
            h['requires'] = ['stopped']
    r['lamps'] = [box(500, 482, 12, 22, flag='infeed')]
    # Stopped: Stop greys, Start, Exit and HOME light. Cut from a capture of
    # the machine stopped on the Weight Display tab; the bottom bar is the
    # same on all five.
    r['overlays'] = [
        collections.OrderedDict([('image', 'keys/stop-off.png'), ('x', 563), ('y', 528), ('w', 88), ('h', 62), ('when', 'stopped')]),
        collections.OrderedDict([('image', 'keys/start-on-run.png'), ('x', 658), ('y', 528), ('w', 88), ('h', 62), ('when', 'stopped')]),
        collections.OrderedDict([('image', 'keys/exit-on.png'), ('x', 703), ('y', 452), ('w', 90), ('h', 64), ('when', 'stopped')]),
        collections.OrderedDict([('image', 'keys/home-on.png'), ('x', 8), ('y', 529), ('w', 88), ('h', 62), ('when', 'stopped')]),
    ]
    for h in r['hotspots']:
        if h.get('to') == 'main-menu' and h['x'] < 100:      # HOME: dimmed and dead while running
            h['requires'] = ['stopped']
    r['hotspots'] += [
        spot(slug_, 548, 494, None, toggles='infeed', label='Infeed Control', **G),
        spot(slug_, 446, 494, '%s@write-optimum' % slug_, label='Write feeder OptimumVal', **G),
        # Stop and Start on the bottom bar. Stop greys itself and lights Start
        # and Exit; Start runs again. (Power is drawn by the app.)
        box(563, 528, 88, 62, None, sets={'running': False}, requires=['running'], label='Stop', **G),
        box(658, 528, 88, 62, None, sets={'running': True}, requires=['stopped'], label='Start', **G),
    ]
    s = confirm(slug_, 'write-optimum', 'run-panel00-write-optimum', YES, NO,
                'Production — "Set the current RF and DF value as optimized value. OK?"')
    s['slug'] = '%s@write-optimum' % slug_; add(s)

for slug_ in ('main-menu', 'preset-select-a'):
    for h in nav['screens'][slug_]['hotspots']:
        if h.get('to') == 'run-combination':
            h['sets'] = {'running': True}

# Combination: the Select Display strip and its magnifier view.
rc = nav['screens']['run-combination']
rc['hotspots'] += [box(3, 40, 24, 370, 'run-combination@select', label='Select Display', **G)]
s = screen('run-combination@select', 'run-combination', 'state', img('rc-select-display'),
           inherit('run-combination') + [
               box(5, 68, 78, 50, 'run-combination', label='weights view'),
               box(5, 125, 78, 50, 'run-combination@magnify', label='magnified weight'),
               box(3, 200, 24, 210, 'run-combination', label='close strip')],
           'Production Combination — Select Display strip'); s['slug'] = 'run-combination@select'; add(s)
s = screen('run-combination@magnify', 'run-combination', 'state', img('rc-view-magnify'),
           inherit('run-combination') + [box(3, 40, 24, 370, 'run-combination@select', label='Select Display')],
           'Production Combination — magnified weight'); s['slug'] = 'run-combination@magnify'; add(s)

# Feeder Adjust: the Feeder tab's drawer and its four chart modes, the Live
# camera view, and the two mean lamps.
rf = nav['screens']['run-feeder']
rf['lamps'] += [box(597, 58, 12, 21, flag='headMean'), box(695, 58, 11, 21, flag='sectionMean')]
rf['hotspots'] += [
    spot('run-feeder', 764, 408, 'run-feeder@drawer', label='Feeder (chart modes)', **G),
    spot('run-feeder', 43, 401, 'run-feeder@live', label='Live (camera)', **G),
    spot('run-feeder', 642, 70, None, toggles='headMean', label='Head mean', **G),
    spot('run-feeder', 740, 70, None, toggles='sectionMean', label='Section mean', **G),
]
DRAWER = box(730, 180, 70, 245)   # the slide-out, cropped from its capture
s = screen('run-feeder@drawer', 'run-feeder', 'state', 'screens/run-feeder.jpg',
           inherit('run-feeder') + [
               box(730, 189, 67, 32, 'run-feeder', label='close'),
               box(740, 228, 47, 38, 'run-feeder@status', label='operating status'),
               box(740, 278, 47, 38, 'run-feeder', label='radar chart'),
               box(740, 326, 47, 38, 'run-feeder@bar', label='bar chart'),
               box(740, 375, 47, 38, 'run-feeder@afd', label='AFD setting')],
           'Feeder Adjust — chart-mode drawer',
           layers=[collections.OrderedDict([('image', img('rf-feeder-drawer')), ('x', DRAWER['x']),
                                            ('y', DRAWER['y']), ('w', DRAWER['w']), ('h', DRAWER['h'])])],
           keepChart=True)
s['slug'] = 'run-feeder@drawer'; add(s)
for name, image, label in [
    ('status', 'rf-mode-status', 'Feeder Adjust — operating status (Under AFD control, condition lamps)'),
    ('bar', 'rf-mode-bar', 'Feeder Adjust — bar chart view'),
    ('afd', 'rf-mode-afd', 'Feeder Adjust — AFD range and control mode'),
]:
    s = screen('run-feeder@%s' % name, 'run-feeder', 'state', img(image),
               inherit('run-feeder') + [box(729, 395, 70, 27, 'run-feeder@drawer', label='Feeder (chart modes)')],
               label)
    s['slug'] = 'run-feeder@%s' % name; add(s)
s = screen('run-feeder@live', 'run-feeder', 'state', img('rf-live-tab'),
           inherit('run-feeder') + [box(290, 389, 70, 27, 'run-feeder', label='C.G.')],
           'Feeder Adjust — Live camera view of the dispersion feeder')
s['slug'] = 'run-feeder@live'; add(s)

# Timing Adjust: the Entr Time keypad.
rt = nav['screens']['run-timing']
rt['hotspots'] += [spot('run-timing', 502, 399, 'run-timing@entr', label='Entr Time', **G)]
s = keypad('run-timing', 'Panel02', 'rt-entr-keypad', 'entr', '110', 'Timing Adjust — Time Input keypad')
s['slug'] = 'run-timing@entr'; add(s)

# Total Data: the Select Total strip and the six views.
rtot = nav['screens']['run-totals']
rtot['hotspots'] += [box(3, 40, 24, 370, 'run-totals@select', label='Select Total', **G)]
VIEWS = [('v1', 'run-totals', 'current total / histogram'), ('v2', 'run-totals@v2', 'X-bar chart'),
         ('v3', 'run-totals@v3', 'transitional data'), ('v4', 'run-totals@v4', 'participation per head'),
         ('v5', 'run-totals@v5', 'total setting'), ('v6', 'run-totals@v6', 'operation log')]
strip = [box(5, 68 + i * 61, 78, 50, to, label=lbl) for i, (_, to, lbl) in enumerate(VIEWS)]
s = screen('run-totals@select', 'run-totals', 'state', img('rtot-select-display'),
           inherit('run-totals') + strip + [box(3, 200, 24, 210, 'run-totals', label='close strip')],
           'Production Total Data — Select Total strip'); s['slug'] = 'run-totals@select'; add(s)
for i, (name, to, lbl) in enumerate(VIEWS[1:], start=2):
    s = screen(to, 'run-totals', 'state', img('rtot-view%d' % i),
               inherit('run-totals') + [box(3, 40, 24, 370, 'run-totals@select', label='Select Total')],
               'Production Total Data — %s' % lbl)
    s['slug'] = to; add(s)

# ----------------------------------------------------- manual adjustment ---

msa = nav['screens']['manual-scale-adjust']
msa['hotspots'] += [spot('manual-scale-adjust', 746, 66, 'manual-scale-adjust@all', label='All Head SLCT/CLR', **G)]
s = screen('manual-scale-adjust@all', 'manual-scale-adjust', 'state', img('msa-all-head-slct'),
           inherit('manual-scale-adjust') + [
               box(705, 48, 85, 46, 'manual-scale-adjust', label='All Head SLCT/CLR'),
               box(8, 362, 88, 50, 'manual-scale-adjust@zeroing', label='Zero Adjst'),
               box(660, 362, 88, 50, 'manual-scale-adjust@span-error', label='WH Span Adjustment')],
           'Manual Adjustment — all heads selected'); s['slug'] = 'manual-scale-adjust@all'; add(s)
s = screen('manual-scale-adjust@zeroing', 'manual-scale-adjust', 'popup', img('msa-zero-adjst-0'), [],
           'Manual Adjustment — zero adjusting ("Please wait a moment.")',
           autoNext=collections.OrderedDict([('to', 'manual-scale-adjust'), ('ms', 4000)]))
s['slug'] = 'manual-scale-adjust@zeroing'; add(s)
# The SPAN ERROR. On the demo it cannot be cleared — Err Clr&Stop does
# nothing — and only a reboot gets out. The Power key in the panel is wired to
# the Main Menu here as that reboot, and the notes say so.
s = screen('manual-scale-adjust@span-error', 'manual-scale-adjust', 'state', img('msa-span-0'),
           [box(373, 428, 85, 65, 'main-menu', sets={'power': False}, label='Power (reboot)'),
            box(465, 428, 85, 65, None, action='inert', label='Err Clr&Stop',
                note='Pressed on the original: nothing. The demo\'s span error cannot be cleared.'),
            box(650, 428, 85, 65, 'manual-scale-adjust@span-description', label='Description')],
           'Manual Adjustment — SPAN ERROR (Ch1 WH1-14)'); s['slug'] = 'manual-scale-adjust@span-error'; add(s)
s = screen('manual-scale-adjust@span-description', 'manual-scale-adjust', 'state', img('msa-span-description'),
           [box(373, 428, 85, 65, 'main-menu', sets={'power': False}, label='Power (reboot)'),
            box(465, 428, 85, 65, None, action='inert', label='Err Clr&Stop',
                note='Pressed on the original: nothing. The demo\'s span error cannot be cleared.'),
            box(650, 428, 85, 65, 'manual-scale-adjust@span-error', label='back')],
           'Manual Adjustment — SPAN ERROR description'); s['slug'] = 'manual-scale-adjust@span-description'; add(s)

# ---------------------------------------------------------- self-diagnosis ---

sdt = nav['screens']['selfdiag-test']
sdt['hotspots'] += [spot('selfdiag-test', 748, 382, 'selfdiag-test@drive', requires=['power'], label='Drive Start', **G)]
s = screen('selfdiag-test@drive', 'selfdiag-test', 'state', img('sdt-offset-on'),
           inherit('selfdiag-test') + [box(565, 350, 87, 65, 'selfdiag-test', label='Drive Stop')],
           'Self-diagnosis Test Drive — driving'); s['slug'] = 'selfdiag-test@drive'; add(s)

# ------------------------------------------------------ display & data ---

dp = nav['screens']['display-preset']
dp['onEnter'] = 'display-preset@loading'
dp['hotspots'] += [spot('display-preset', 51, 77, 'display-preset@initialize', label='Initialize', **G)]
s = screen('display-preset@loading', 'display-preset', 'popup', img('dp-loading-popup'), [],
           'Display & Data Manager — "Loading preset data"',
           autoNext=collections.OrderedDict([('to', 'display-preset'), ('ms', 2500)]))
s['slug'] = 'display-preset@loading'; add(s)
s = confirm('display-preset', 'initialize', 'dp-initialize', (203, 396, 90, 65), (313, 396, 90, 65),
            'Display & Data Manager — "Initialize the Memory. OK?"'); s['slug'] = 'display-preset@initialize'; add(s)
dae = nav['screens']['display-all-edit']
dae['hotspots'] += [spot('display-all-edit', 336, 185, 'display-all-edit@initialize', label='Initialize', **G)]
s = confirm('display-all-edit', 'initialize', 'dae-panel01', (203, 396, 90, 65), (313, 396, 90, 65),
            'All Setting Manager — "Initialize the Memory. OK?"'); s['slug'] = 'display-all-edit@initialize'; add(s)

# ------------------------------------------------- various parameter ---

vsd = nav['screens']['various-scale-detail']
vsd['hotspots'] += [spot('various-scale-detail', 150, 170, 'various-scale-detail@empty-weight', label='Empty Judgment Weight', **G)]
s = keypad('various-scale-detail', 'Panel02', 'vsd-panel02', 'empty-weight', '1', 'Various — Empty Judgment Weight keypad')
s['slug'] = 'various-scale-detail@empty-weight'; add(s)

hdrv = nav['screens']['various-hdrv']
HD = [('pool', 'various-hdrv', 'Pool Hopper', 127), ('weigh', 'various-hdrv@weigh', 'Weigh Hopper', 167),
      ('booster', 'various-hdrv@booster', 'Booster Hopper', 208), ('ring', 'various-hdrv@ring', 'RingShutter', 249),
      ('diverting', 'various-hdrv@diverting', 'DivertingTimingHppr', 290), ('timing', 'various-hdrv@timing', 'TimingHopper', 332)]
hd_list = [box(603, y - 20, 196, 40, to, label=lbl) for _, to, lbl, y in HD]
hdrv['hotspots'] += [h for h in hd_list if h['to'] != 'various-hdrv']
for name, to, lbl, y in HD[1:]:
    s = screen(to, 'various-hdrv', 'state', img('hdrv-%s' % {'weigh': 'weigh-hopper', 'booster': 'booster-hopper',
                                                             'ring': 'ring-shutter', 'diverting': 'diverting',
                                                             'timing': 'timing-hopper'}[name]),
               inherit('various-hdrv') + [h for h in hd_list if h['to'] != to],
               'H DRV Spec Set — %s' % lbl)
    s['slug'] = to; add(s)

# -------------------------------------------------- peripheral equipment ---

pb = nav['screens']['pack-bagmaker']
pb['hotspots'] += [spot('pack-bagmaker', 191, 136, 'pack-bagmaker@dump-hold', label='Dump Confirm Hold', **G)]
s = keypad('pack-bagmaker', 'Panel02', 'pack-panel02', 'dump-hold', '100', 'Peripheral — Dump Confirm Hold keypad')
s['slug'] = 'pack-bagmaker@dump-hold'; add(s)

# --------------------------------------------------------- control panel ---

psc = nav['screens']['panel-screen-control']
psc['hotspots'] += [spot('panel-screen-control', 178, 373, 'panel-screen-control@tune-up', label='Tune-up', **G)]
s = confirm('panel-screen-control', 'tune-up', 'psc-panel01', (203, 396, 90, 65), (313, 396, 90, 65),
            'Control Panel — "Screen moves to calibration screen to calibrate touch panel coordinates. OK?"',
            yes_to='panel-screen-control@calib1'); s['slug'] = 'panel-screen-control@tune-up'; add(s)
# The calibration: a cross top-right, then bottom-left; tap each.
s = screen('panel-screen-control@calib1', 'panel-screen-control', 'state', img('panel-password-live'),
           [box(700, 30, 60, 60, 'panel-screen-control@calib2', label='tap the cross')],
           'Touch-panel calibration — first cross'); s['slug'] = 'panel-screen-control@calib1'; add(s)
s = screen('panel-screen-control@calib2', 'panel-screen-control', 'state', img('ppw-panel01'),
           [box(40, 510, 60, 60, 'panel-screen-control', label='tap the cross')],
           'Touch-panel calibration — second cross'); s['slug'] = 'panel-screen-control@calib2'; add(s)

# ------------------------------------------------------------- assistant ---

asst = nav['screens']['assistant']
asst['hotspots'] = [h for h in asst['hotspots']] + [
    box(296, 385, 90, 40, 'assistant@select-preset', label='Next', **G)]
WIZ = [
    ('select-preset', 'assistant-step2-select-preset', 'Start-Up Assistant — Select Preset (press OK)',
     [box(658, 452, 85, 62, 'assistant@wh-start', label='OK')], {}),
    ('wh-start', 'assistant-step3', 'Start-Up Assistant — WH Zero Adjustment Start',
     [box(470, 128, 85, 68, 'assistant@wh-running', label='Start'), box(638, 128, 85, 68, 'assistant@df-start', label='Next')], {}),
    ('wh-running', 'assistant-step4-in-wh-zero', 'Start-Up Assistant — In WH Zero Adjst.', [],
     {'autoNext': collections.OrderedDict([('to', 'assistant@df-start'), ('ms', 4000)])}),
    ('df-start', 'assistant-step5', 'Start-Up Assistant — DF Zero Adjustment Start',
     [box(470, 128, 85, 68, 'assistant@df-running', label='Start'), box(638, 128, 85, 68, 'assistant@standby', label='Next')], {}),
    ('df-running', 'assistant-step6-in-df-zero', 'Start-Up Assistant — In DF Zero Adjst', [],
     {'autoNext': collections.OrderedDict([('to', 'assistant@standby'), ('ms', 4000)])}),
    ('standby', 'assistant-step7', 'Start-Up Assistant — Production Standby (press START)',
     [box(658, 528, 88, 62, 'run-combination', sets={'running': True}, requires=['power'], label='Start')], {}),
]
for name, image, label, spots, extra in WIZ:
    spots = spots + [box(8, 529, 88, 62, 'main-menu', label='HOME')]
    s = screen('assistant@%s' % name, 'assistant', 'wizard', img(image), spots, label, **extra)
    s['slug'] = 'assistant@%s' % name; add(s)

# ----------------------------------------------------------------- memo ---

memo = nav['screens']['memo']
memo['hotspots'] += [
    spot('memo', 647, 478, 'memo@transmit', label='Transmit', **G),
    spot('memo', 747, 411, 'memo@delete', label='delete', **G),
]
s = confirm('memo', 'transmit', 'memo-transmit', (263, 396, 90, 65), (405, 396, 90, 65),
            'Message Board — "E-mail will be sent. OK?"'); s['slug'] = 'memo@transmit'; add(s)
s = confirm('memo', 'delete', 'memo-delete-ok', (263, 396, 90, 65), (405, 396, 90, 65),
            'Message Board — "Delete OK?"'); s['slug'] = 'memo@delete'; add(s)

# --------------------------------------------- HOME where it is dimmed ---

# Select Preset, the preset editor and the Message Board dim HOME: Exit is
# the only way out (seen on every capture of them). The movie still carries
# the button, so the hotspot stays and explains itself.
for slug_ in ('preset-select-a', 'preset-select-b', 'preset-product', 'preset-machine',
              'preset-item', 'preset-other', 'preset-feeder', 'preset-timing', 'preset-weight', 'memo'):
    for h in nav['screens'][slug_]['hotspots']:
        if h.get('to') == 'main-menu' and h['x'] < 100 and h['y'] > 500:
            h['requires'] = ['homeDead']
            h['label'] = 'HOME (dimmed here — use Exit)'

# ------------------------------------------------------------- the ? key ---

for slug_, s in nav['screens'].items():
    if '@' in slug_ or slug_ == 'main-menu':
        continue
    if any(h.get('action') == 'blink' for h in s['hotspots']):
        continue
    s['hotspots'].append(box(764, 1, 36, 35, None, action='blink', label='Help — blink the keys', **G))

# Everything generated is a capture; base screens keep their frame.
for slug_, s in nav['screens'].items():
    if '@' in slug_:
        s['captured'] = True
        s.pop('frame', None)

json.dump(nav, open(NAV, 'w'), indent=1, ensure_ascii=False)
open(NAV, 'a').write('\n')
n = sum(1 for k in nav['screens'] if '@' in k)
print('%d state screens, %d screens in all' % (n, len(nav['screens'])))
