#!/usr/bin/env python3
"""
Everything the movie can DO, not just where its buttons jump.

extract_swf.py's nav pass keeps a button only if it jumps to a labelled frame,
which is the right rule for building a screen map and the wrong one for finding
out what the map is missing. Drawers, pop-ups, keypads, the password keyboard
and the chart-view switch all live inside sprites and are driven by script —
setting a sprite's _visible, telling it to gotoAndStop, calling a function —
so to that pass they look like buttons that do nothing.

This walks the same movie and writes, per labelled frame:

- every button reachable through the display list, with its hit rectangle,
  its goto targets, the STRINGS its script pushes (sprite names, property
  names, function names) and the opcodes it uses;
- every named sprite instance on the frame, with the sprite's own frame
  labels and the buttons inside each of its frames — a pop-up's pages;
- the frame's own script, if it has one.

    python3 tools/swf_structure.py IshidaVR.exe out.json
"""
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_swf import (Bits, read_swf, tags, read_matrix, mat_mul,   # noqa: E402
                         collect_dictionary, button_hits, parse_actions)

OPS = {
    0x04: 'NextFrame', 0x05: 'PrevFrame', 0x06: 'Play', 0x07: 'Stop',
    0x0A: 'Add', 0x0B: 'Subtract', 0x0E: 'Equals', 0x12: 'Not',
    0x17: 'Pop', 0x1C: 'GetVariable', 0x1D: 'SetVariable',
    0x20: 'SetTarget2', 0x21: 'StringAdd', 0x22: 'GetProperty',
    0x23: 'SetProperty', 0x24: 'CloneSprite', 0x25: 'RemoveSprite',
    0x26: 'Trace', 0x27: 'StartDrag', 0x28: 'EndDrag',
    0x30: 'RandomNumber', 0x34: 'GetTime', 0x3A: 'Delete', 0x3C: 'DefineLocal',
    0x3D: 'CallFunction', 0x3E: 'Return', 0x40: 'NewObject', 0x42: 'InitArray',
    0x43: 'InitObject', 0x44: 'TypeOf', 0x47: 'Add2', 0x48: 'Less2',
    0x49: 'Equals2', 0x4C: 'PushDuplicate', 0x4E: 'GetMember', 0x4F: 'SetMember',
    0x50: 'Increment', 0x51: 'Decrement', 0x52: 'CallMethod', 0x66: 'StrictEquals',
    0x67: 'Greater', 0x81: 'GotoFrame', 0x83: 'GetURL', 0x87: 'StoreRegister',
    0x88: 'ConstantPool', 0x8A: 'WaitForFrame', 0x8B: 'SetTarget',
    0x8C: 'GotoLabel', 0x8E: 'DefineFunction2', 0x94: 'With', 0x96: 'Push',
    0x99: 'Jump', 0x9A: 'GetURL2', 0x9B: 'DefineFunction', 0x9D: 'If',
    0x9E: 'Call', 0x9F: 'GotoFrame2',
}
IDENTITY = (1.0, 1.0, 0.0, 0.0, 0, 0)


def pushed_strings(body):
    """Every string the block pushes, in order — including constant-pool
    entries, which is where AS2 keeps most identifiers."""
    out, pool = [], []
    p = 0
    while p < len(body):
        op = body[p]; p += 1
        if op == 0:
            break
        data = b''
        if op >= 0x80:
            length, = struct.unpack('<H', body[p:p + 2]); p += 2
            data = body[p:p + length]; p += length
        if op == 0x88:                                   # ConstantPool
            n, = struct.unpack('<H', data[:2])
            pool = [s.decode('utf-8', 'replace') for s in data[2:].split(b'\x00')[:n]]
            out += pool
        elif op == 0x96:                                 # Push
            q = 0
            while q < len(data):
                t = data[q]; q += 1
                if t == 0:
                    end = data.index(b'\x00', q)
                    out.append(data[q:end].decode('utf-8', 'replace')); q = end + 1
                elif t == 1:
                    out.append(struct.unpack('<f', data[q:q + 4])[0]); q += 4
                elif t in (4, 5): q += 1
                elif t == 6:
                    out.append(struct.unpack('<d', data[q:q + 8])[0]); q += 8
                elif t == 7:
                    out.append(struct.unpack('<i', data[q:q + 4])[0]); q += 4
                elif t == 8:
                    if q < len(data) and data[q] < len(pool): out.append(pool[data[q]])
                    q += 1
                elif t == 9:
                    i, = struct.unpack('<H', data[q:q + 2]); q += 2
                    if i < len(pool): out.append(pool[i])
                else:
                    break
    return out


def opcode_names(body):
    names, p = [], 0
    while p < len(body):
        op = body[p]; p += 1
        if op == 0:
            break
        if op >= 0x80:
            length, = struct.unpack('<H', body[p:p + 2]); p += 2 + length
        names.append(OPS.get(op, '%02x' % op))
    return names


def walk_tags(body):
    """(code, body) for every tag in a sprite or the main timeline body."""
    p = 0
    while p < len(body) - 1:
        header, = struct.unpack('<H', body[p:p + 2]); p += 2
        code, length = header >> 6, header & 0x3F
        if length == 0x3F:
            length, = struct.unpack('<I', body[p:p + 4]); p += 4
        yield code, body[p:p + length]
        p += length
        if code == 0:
            return


def place_info(tag):
    """(depth, char_id or None, matrix or None, name or None) of a PlaceObject2."""
    flags = tag[0]
    depth, = struct.unpack('<H', tag[1:3])
    q = 3
    cid = matrix = name = None
    if flags & 0x02:
        cid, = struct.unpack('<H', tag[q:q + 2]); q += 2
    if flags & 0x04:
        bits = Bits(tag, q)
        matrix = read_matrix(bits); bits.align(); q = bits.byte
    if flags & 0x08:                                     # colour transform
        bits = Bits(tag, q)
        has_add, has_mult = bits.read(1), bits.read(1)
        n = bits.read(4)
        for _ in range((4 if has_mult else 0) + (4 if has_add else 0)):
            bits.read(n)
        bits.align(); q = bits.byte
    if flags & 0x10:
        q += 2                                           # ratio
    if flags & 0x20:
        end = tag.index(b'\x00', q)
        name = tag[q:end].decode('utf-8', 'replace'); q = end + 1
    return depth, cid, matrix, name


def timeline(body):
    """Per-frame snapshots of a timeline body: list of
    {frame, label, script, placed: {depth: (cid, matrix, name)}}."""
    frames, display, label, scripts = [], {}, None, []
    n = 1
    for code, tag in walk_tags(body):
        if code == 43:
            label = tag.split(b'\x00')[0].decode('utf-8', 'replace')
        elif code == 12:                                 # DoAction
            scripts.append(tag)
        elif code == 26:
            depth, cid, matrix, name = place_info(tag)
            if cid is not None:
                display[depth] = (cid, matrix or IDENTITY, name)
            elif depth in display:
                old = display[depth]
                display[depth] = (old[0], matrix or old[1], name or old[2])
        elif code == 4:
            cid, depth = struct.unpack('<HH', tag[0:4])
            display[depth] = (cid, read_matrix(Bits(tag, 4)), None)
        elif code in (5, 28):
            depth, = struct.unpack('<H', tag[-2:] if code == 28 else tag[2:4])
            display.pop(depth, None)
        elif code == 1:
            frames.append({'frame': n, 'label': label, 'scripts': scripts,
                           'placed': dict(display)})
            n += 1; label = None; scripts = []
    return frames


def main(exe_path, out_path):
    swf = read_swf(exe_path)
    shape_bounds, buttons, sprite_tags = collect_dictionary(swf)
    sprite_frames = {cid: timeline(body) for cid, body in sprite_tags.items()}

    def describe_button(bid, m):
        rects, gf, gl, _ = button_hits(buttons[bid], shape_bounds, m)
        strings, ops = [], []
        for cond, action in buttons[bid][1]:
            strings += pushed_strings(action)
            ops += opcode_names(action)
        return {
            'button': bid,
            'rects': [[round(v) for v in r] for r in rects],
            'gotoFrames': sorted({f + 1 for f in gf}),
            'gotoLabels': gl,
            'strings': strings,
            'ops': sorted(set(ops)),
        }

    def buttons_in(placed, base, depth=0):
        """Buttons on this display list, recursing into sprites' FIRST frame
        (what is visible when the sprite is placed)."""
        found = []
        if depth > 3:
            return found
        for cid, matrix, name in placed.values():
            m = mat_mul(base, matrix)
            if cid in buttons:
                found.append(describe_button(cid, m))
            elif cid in sprite_frames and sprite_frames[cid]:
                found += buttons_in(sprite_frames[cid][0]['placed'], m, depth + 1)
        return found

    def describe_sprite(cid, base, depth=0):
        """A named sprite: its own frame labels and what each frame holds."""
        pages = []
        for f in sprite_frames.get(cid, []):
            page = {'frame': f['frame'], 'label': f['label'],
                    'buttons': buttons_in(f['placed'], base, depth + 1)}
            nested = [(c, m, n) for c, m, n in f['placed'].values() if n]
            if nested and depth < 2:
                page['sprites'] = {n: describe_sprite(c, mat_mul(base, m), depth + 1)
                                   for c, m, n in nested}
            if f['scripts']:
                page['script'] = sorted({str(s) for sc in f['scripts'] for s in pushed_strings(sc)})
            pages.append(page)
        # Collapse pages that are identical to the one before: most sprites
        # hold a still image for many frames.
        collapsed = []
        for p in pages:
            key = (p['label'], json.dumps(p.get('buttons')), json.dumps(p.get('sprites'), sort_keys=True))
            if collapsed and collapsed[-1][0] == key and not p.get('script'):
                collapsed[-1][1]['through'] = p['frame']
                continue
            collapsed.append((key, p))
        return [p for _, p in collapsed]

    out = []
    for f in timeline(swf[8 + (5 + (swf[8] >> 3) * 4 + 7) // 8 + 4:]):
        if not f['label']:
            continue
        entry = {'frame': f['frame'], 'label': f['label'],
                 'buttons': buttons_in(f['placed'], IDENTITY),
                 'sprites': {}}
        for cid, matrix, name in f['placed'].values():
            if name and cid in sprite_frames:
                entry['sprites'][name] = {
                    'char': cid,
                    'at': [round(matrix[4] / 20), round(matrix[5] / 20)],
                    'pages': describe_sprite(cid, matrix),
                }
        if f['scripts']:
            entry['script'] = sorted({str(s) for sc in f['scripts'] for s in pushed_strings(sc)})
        out.append(entry)

    json.dump(out, open(out_path, 'w'), indent=1, ensure_ascii=False)
    nb = sum(len(e['buttons']) for e in out)
    ns = sum(len(e['sprites']) for e in out)
    print('%d labelled frames, %d buttons, %d named sprite instances' % (len(out), nb, ns))




def disassemble(body):
    """Readable AVM1: one line per action, pushes shown with their values.

    Enough to read what a button does — which sprite it shows, which page it
    turns to, what it sets — without a real decompiler.
    """
    lines, pool, p = [], [], 0
    while p < len(body):
        op = body[p]; p += 1
        if op == 0:
            break
        data = b''
        if op >= 0x80:
            length, = struct.unpack('<H', body[p:p + 2]); p += 2
            data = body[p:p + length]; p += length
        name = OPS.get(op, '%02x' % op)
        if op == 0x88:
            n, = struct.unpack('<H', data[:2])
            pool = [s.decode('utf-8', 'replace') for s in data[2:].split(b'\x00')[:n]]
            continue
        if op == 0x96:
            vals, q = [], 0
            while q < len(data):
                t = data[q]; q += 1
                if t == 0:
                    end = data.index(b'\x00', q); vals.append(repr(data[q:end].decode('utf-8', 'replace'))); q = end + 1
                elif t == 1: vals.append('%g' % struct.unpack('<f', data[q:q + 4])[0]); q += 4
                elif t == 2: vals.append('null')
                elif t == 3: vals.append('undefined')
                elif t == 4: vals.append('reg%d' % data[q]); q += 1
                elif t == 5: vals.append('true' if data[q] else 'false'); q += 1
                elif t == 6: vals.append('%g' % struct.unpack('<d', data[q:q + 8])[0]); q += 8
                elif t == 7: vals.append('%d' % struct.unpack('<i', data[q:q + 4])[0]); q += 4
                elif t == 8: vals.append(repr(pool[data[q]]) if data[q] < len(pool) else '?'); q += 1
                elif t == 9:
                    i, = struct.unpack('<H', data[q:q + 2]); q += 2
                    vals.append(repr(pool[i]) if i < len(pool) else '?')
                else: break
            lines.append('push ' + ', '.join(vals))
        elif op == 0x8C:
            lines.append('gotoLabel %r' % data.split(b'\x00')[0].decode('utf-8', 'replace'))
        elif op == 0x81:
            lines.append('gotoFrame %d' % (struct.unpack('<H', data[:2])[0] + 1))
        elif op in (0x99, 0x9D):
            lines.append('%s %+d' % (name, struct.unpack('<h', data[:2])[0]))
        elif op == 0x8B:
            lines.append('setTarget %r' % data.split(b'\x00')[0].decode('utf-8', 'replace'))
        elif op == 0x9F:
            lines.append('gotoFrame2 (%s)' % ('play' if data[0] & 1 else 'stop'))
        else:
            lines.append(name)
    return lines


def dump_button(exe_path, label, x, y):
    """Print the disassembly of the button nearest (x, y) on the labelled frame."""
    swf = read_swf(exe_path)
    shape_bounds, buttons, sprite_tags = collect_dictionary(swf)
    sprite_frames = {cid: timeline(body) for cid, body in sprite_tags.items()}
    frames = timeline(swf[8 + (5 + (swf[8] >> 3) * 4 + 7) // 8 + 4:])
    frame = next(f for f in frames if f['label'] == label)

    def walk(placed, base, depth=0):
        if depth > 3:
            return
        for cid, matrix, name in placed.values():
            m = mat_mul(base, matrix)
            if cid in buttons:
                rects, *_ = button_hits(buttons[cid], shape_bounds, m)
                for r in rects:
                    if r[0] <= x <= r[0] + r[2] and r[1] <= y <= r[1] + r[3]:
                        yield cid, r
            elif cid in sprite_frames and sprite_frames[cid]:
                yield from walk(sprite_frames[cid][0]['placed'], m, depth + 1)

    for cid, r in walk(frame['placed'], IDENTITY):
        print('button %d at %s' % (cid, [round(v) for v in r]))
        for cond, action in buttons[cid][1]:
            print('  on 0x%04x:' % cond)
            for line in disassemble(action):
                print('     ' + line)


if __name__ == '__main__' and len(sys.argv) == 5:
    dump_button(sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]))
    sys.exit(0)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
