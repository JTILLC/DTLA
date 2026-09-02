#!/usr/bin/env python3
"""
Pull the RCU screens out of IshidaVR.exe.

The exe is a Flash Player 7 projector: a Windows stub with the movie appended,
and a footer of magic 0xFA123456 + the movie's byte length. The movie itself is
zlib-compressed (CWS). Inside it, each RCU screen is a DefineBitsJPEG2 tag and
each menu page is a labelled frame, so the label tells you what the screen you
just pulled out actually is.

Usage:  python3 tools/extract_swf.py /path/to/IshidaVR.exe outdir
"""
import sys, os, re, json, struct, zlib

IMAGE_TAGS = {6, 21, 35}


def read_swf(exe_path):
    """The movie, decompressed, from the projector's appended payload."""
    data = open(exe_path, 'rb').read()
    if data[-8:-4] != b'\x56\x34\x12\xfa':
        raise SystemExit('not a Flash projector: footer magic missing')
    size, = struct.unpack('<I', data[-4:])
    swf = data[len(data) - 8 - size:len(data) - 8]
    if swf[:3] == b'CWS':
        swf = swf[:8] + zlib.decompress(swf[8:])
    elif swf[:3] != b'FWS':
        raise SystemExit('unexpected movie signature %r' % swf[:3])
    return swf


def tags(swf):
    """Every tag in the movie, in order, as (code, body)."""
    p = 8
    nbits = swf[p] >> 3               # movie bounds, a RECT of four nbits fields
    p += (5 + nbits * 4 + 7) // 8
    p += 4                            # frame rate + frame count
    while p < len(swf) - 1:
        header, = struct.unpack('<H', swf[p:p + 2]); p += 2
        code, length = header >> 6, header & 0x3F
        if length == 0x3F:            # long form
            length, = struct.unpack('<I', swf[p:p + 4]); p += 4
        yield code, swf[p:p + length]
        p += length
        if code == 0:
            return


def jpeg_size(data):
    """(height, width) off the JPEG's start-of-frame marker."""
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            return struct.unpack('>HH', data[i + 5:i + 9])
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        i += 2 + struct.unpack('>H', data[i + 2:i + 4])[0]
    return None


def shape_bitmap(body, version):
    """The first bitmap a shape fills itself with, if it fills itself with one.

    Screens are not placed as bitmaps; they are placed as a shape whose fill is
    the bitmap. So the frame gives you a shape id and this is what turns that
    back into a picture.
    """
    p = 2                                     # character id
    nbits = body[p] >> 3                      # shape bounds
    p += (5 + nbits * 4 + 7) // 8
    count = body[p]; p += 1
    if count == 0xFF:
        count, = struct.unpack('<H', body[p:p + 2]); p += 2
    for _ in range(count):
        style = body[p]; p += 1
        if style == 0x00:                     # solid
            p += 4 if version >= 3 else 3
        elif 0x40 <= style <= 0x43:           # bitmap
            bitmap_id, = struct.unpack('<H', body[p:p + 2])
            return bitmap_id
        else:                                 # gradient, or anything else
            return None
    return None


class Bits:
    """MSB-first bit reader over a bytes object, for RECTs and MATRIXes."""
    def __init__(self, data, pos=0):
        self.data, self.byte, self.bit = data, pos, 0

    def read(self, n, signed=False):
        v = 0
        for _ in range(n):
            v = (v << 1) | ((self.data[self.byte] >> (7 - self.bit)) & 1)
            self.bit += 1
            if self.bit == 8:
                self.bit, self.byte = 0, self.byte + 1
        if signed and n and v & (1 << (n - 1)):
            v -= 1 << n
        return v

    def align(self):
        if self.bit:
            self.bit, self.byte = 0, self.byte + 1


def read_rect(bits):
    n = bits.read(5)
    return tuple(bits.read(n, signed=True) for _ in range(4))  # xmin,xmax,ymin,ymax


def read_matrix(bits):
    """(sx, sy, r0, r1, tx, ty) with scale as floats and translate in twips."""
    sx = sy = 1.0
    r0 = r1 = 0.0
    if bits.read(1):
        n = bits.read(5)
        sx = bits.read(n, signed=True) / 65536.0
        sy = bits.read(n, signed=True) / 65536.0
    if bits.read(1):
        n = bits.read(5)
        r0 = bits.read(n, signed=True) / 65536.0
        r1 = bits.read(n, signed=True) / 65536.0
    n = bits.read(5)
    tx = bits.read(n, signed=True)
    ty = bits.read(n, signed=True)
    return (sx, sy, r0, r1, tx, ty)


def mat_apply(m, x, y):
    sx, sy, r0, r1, tx, ty = m
    return (sx * x + r1 * y + tx, r0 * x + sy * y + ty)


def mat_mul(outer, inner):
    """outer ∘ inner as a single matrix."""
    a, d, b, c, tx, ty = outer[0], outer[1], outer[2], outer[3], outer[4], outer[5]
    a2, d2, b2, c2, tx2, ty2 = inner[0], inner[1], inner[2], inner[3], inner[4], inner[5]
    # matrix form: [a c tx; b d ty] with SWF naming (r0=b skew, r1=c skew)
    na = a * a2 + c * b2
    nc = a * c2 + c * d2
    nb = b * a2 + d * b2
    nd = b * c2 + d * d2
    ntx = a * tx2 + c * ty2 + tx
    nty = b * tx2 + d * ty2 + ty
    return (na, nd, nb, nc, ntx, nty)


def parse_actions(body):
    """Frame targets and opcode names out of an AVM1 action block.

    Returns (goto_frames, goto_labels, opcodes). goto_frames are 0-based as
    stored; the caller converts to the 1-based frame numbers labels use.
    """
    frames, labels_out, ops = [], [], []
    p, pushed = 0, []
    while p < len(body):
        op = body[p]; p += 1
        if op == 0:
            break
        data = b''
        if op >= 0x80:
            length, = struct.unpack('<H', body[p:p + 2]); p += 2
            data = body[p:p + length]; p += length
        if op == 0x81:                        # ActionGotoFrame
            frames.append(struct.unpack('<H', data[:2])[0])
        elif op == 0x8C:                      # ActionGoToLabel
            labels_out.append(data.split(b'\x00')[0].decode('utf-8', 'replace'))
        elif op == 0x96:                      # ActionPush (strings / floats only matter here)
            q = 0
            while q < len(data):
                t = data[q]; q += 1
                if t == 0:
                    s = data[q:data.index(b'\x00', q)]
                    pushed.append(s.decode('utf-8', 'replace')); q += len(s) + 1
                elif t == 1:
                    pushed.append(struct.unpack('<f', data[q:q + 4])[0]); q += 4
                elif t == 7:
                    pushed.append(struct.unpack('<i', data[q:q + 4])[0]); q += 4
                elif t in (4, 5):
                    q += 1
                elif t == 6:
                    pushed.append(struct.unpack('<d', data[q:q + 8])[0]); q += 8
                elif t in (8,):
                    q += 1
                elif t in (9,):
                    q += 2
                else:
                    break
        elif op == 0x9F:                      # ActionGotoFrame2
            if pushed:
                v = pushed[-1]
                if isinstance(v, (int, float)):
                    frames.append(int(v) - 1)  # scripted gotos are 1-based
                else:
                    labels_out.append(v)
        ops.append(op)
    return frames, labels_out, ops


def parse_button2(body):
    """(records, condactions) from a DefineButton2 body.

    records: list of (state_flags, char_id, matrix). condactions: list of
    (cond_flags, action_bytes).
    """
    action_offset, = struct.unpack('<H', body[3:5])
    p, records = 5, []
    while body[p] != 0:
        flags = body[p]; p += 1
        cid, depth = struct.unpack('<HH', body[p:p + 4]); p += 4
        bits = Bits(body, p)
        matrix = read_matrix(bits)
        bits.align(); p = bits.byte
        # CXFORM with alpha follows in DefineButton2
        bits = Bits(body, p)
        has_add, has_mult = bits.read(1), bits.read(1)
        n = bits.read(4)
        for _ in range((4 if has_mult else 0) + (4 if has_add else 0)):
            bits.read(n)
        bits.align(); p = bits.byte
        records.append((flags, cid, matrix))
    p += 1
    condactions = []
    # ActionOffset is measured from the start of its own field, which sits at
    # byte 3 of the body; 0 means the button has no actions.
    if action_offset:
        p = 3 + action_offset
        while p < len(body) - 3:
            size, = struct.unpack('<H', body[p:p + 2])
            cond, = struct.unpack('<H', body[p + 2:p + 4])
            end = p + size if size else len(body)
            condactions.append((cond, body[p + 4:end]))
            if size == 0:
                break
            p = end
    return records, condactions


def collect_dictionary(swf):
    """Per-character info the nav pass needs: shape bounds, buttons, sprites."""
    shape_bounds, buttons, sprite_tags = {}, {}, {}
    for code, body in tags(swf):
        if code in (2, 22, 32, 83):
            cid, = struct.unpack('<H', body[:2])
            shape_bounds[cid] = read_rect(Bits(body, 2))
        elif code == 34:
            cid, = struct.unpack('<H', body[:2])
            buttons[cid] = parse_button2(body)
        elif code == 7:                        # DefineButton (v1)
            cid, = struct.unpack('<H', body[:2])
            # records then actions to end of tag
            p, records = 2, []
            while body[p] != 0:
                flags = body[p]; p += 1
                rcid, depth = struct.unpack('<HH', body[p:p + 4]); p += 4
                bits = Bits(body, p)
                matrix = read_matrix(bits); bits.align(); p = bits.byte
                records.append((flags, rcid, matrix))
            p += 1
            buttons[cid] = (records, [(0x0008, body[p:])])  # treat as press
        elif code == 39:                       # DefineSprite
            cid, = struct.unpack('<H', body[:2])
            sprite_tags[cid] = body[4:]
    return shape_bounds, buttons, sprite_tags


def sprite_frame1(body):
    """Display list of a sprite's first frame: [(char_id, matrix)]."""
    placed = {}
    p = 0
    while p < len(body) - 1:
        header, = struct.unpack('<H', body[p:p + 2]); p += 2
        code, length = header >> 6, header & 0x3F
        if length == 0x3F:
            length, = struct.unpack('<I', body[p:p + 4]); p += 4
        tag = body[p:p + length]; p += length
        if code == 1 or code == 0:
            break
        if code == 26:
            flags = tag[0]
            depth, = struct.unpack('<H', tag[1:3])
            q = 3
            cid = None
            if flags & 0x02:
                cid, = struct.unpack('<H', tag[q:q + 2]); q += 2
            matrix = (1.0, 1.0, 0.0, 0.0, 0, 0)
            if flags & 0x04:
                bits = Bits(tag, q)
                matrix = read_matrix(bits)
            if cid is not None:
                placed[depth] = (cid, matrix)
        elif code == 4:                        # PlaceObject
            cid, depth = struct.unpack('<HH', tag[0:4])
            bits = Bits(tag, 4)
            placed[depth] = (cid, read_matrix(bits))
    return list(placed.values())


def button_hits(button, shape_bounds, place_matrix):
    """Pixel-space hit rectangles and press targets for one placed button."""
    records, condactions = button
    rects = []
    for flags, cid, matrix in records:
        if not flags & 0x08:                   # not part of the hit state
            continue
        b = shape_bounds.get(cid)
        if b is None:
            continue
        m = mat_mul(place_matrix, matrix)
        xs, ys = [], []
        for x, y in ((b[0], b[2]), (b[1], b[2]), (b[0], b[3]), (b[1], b[3])):
            px, py = mat_apply(m, x, y)
            xs.append(px); ys.append(py)
        rects.append((min(xs) / 20.0, min(ys) / 20.0,
                      (max(xs) - min(xs)) / 20.0, (max(ys) - min(ys)) / 20.0))
    frames, labels_out, ops = [], [], []
    for cond, action in condactions:
        f, l, o = parse_actions(action)
        frames += f; labels_out += l; ops += o
    return rects, frames, labels_out, ops


def extract_nav(exe_path, out_path):
    """Walk the main timeline, snapshot the display list at every frame, and
    write every button's hit rectangle and goto target as JSON."""
    swf = read_swf(exe_path)
    shape_bounds, buttons, sprite_tags = collect_dictionary(swf)

    labels, display, snapshots = [], {}, {}
    frame = 1
    for code, body in tags(swf):
        if code == 43:
            raw = body.split(b'\x00')[0]
            try:
                label = raw.decode('utf-8')
            except UnicodeDecodeError:
                label = raw.decode('shift_jis', 'replace')
            labels.append((frame, label))
        elif code == 26:
            flags = body[0]
            depth, = struct.unpack('<H', body[1:3])
            q = 3
            cid = None
            if flags & 0x02:
                cid, = struct.unpack('<H', body[q:q + 2]); q += 2
            matrix = None
            if flags & 0x04:
                matrix = read_matrix(Bits(body, q))
            if cid is not None:
                display[depth] = (cid, matrix or (1.0, 1.0, 0.0, 0.0, 0, 0))
            elif matrix is not None and depth in display:
                display[depth] = (display[depth][0], matrix)
        elif code == 4:
            cid, depth = struct.unpack('<HH', body[0:4])
            display[depth] = (cid, read_matrix(Bits(body, 4)))
        elif code in (5, 28):                  # RemoveObject / RemoveObject2
            depth, = struct.unpack('<H', body[-2:] if code == 28 else body[2:4])
            display.pop(depth, None)
        elif code == 1:
            snapshots[frame] = list(display.values())
            frame += 1

    def buttons_in(placed, base_matrix, depth=0):
        found = []
        if depth > 3:
            return found
        for cid, matrix in placed:
            m = mat_mul(base_matrix, matrix)
            if cid in buttons:
                found.append((cid, m))
            elif cid in sprite_tags:
                found += buttons_in(sprite_frame1(sprite_tags[cid]), m, depth + 1)
        return found

    identity = (1.0, 1.0, 0.0, 0.0, 0, 0)
    out = []
    for frame_no, label in labels:
        entries = []
        for bid, m in buttons_in(snapshots.get(frame_no, []), identity):
            rects, target_frames, target_labels, ops = button_hits(
                buttons[bid], shape_bounds, m)
            entries.append({
                'button': bid,
                'rects': [[round(v, 1) for v in r] for r in rects],
                'gotoFrames': sorted({f + 1 for f in target_frames}),
                'gotoLabels': target_labels,
                'ops': sorted({'%02x' % o for o in ops}),
            })
        out.append({'frame': frame_no, 'label': label, 'buttons': entries})
    json.dump(out, open(out_path, 'w'), indent=1, ensure_ascii=False)
    total = sum(len(f['buttons']) for f in out)
    print('%d labelled frames, %d placed buttons' % (len(out), total))


def main(exe_path, outdir):
    swf = read_swf(exe_path)
    images, sprites = os.path.join(outdir, 'screens'), os.path.join(outdir, 'sprites')
    for d in (images, sprites):
        os.makedirs(d, exist_ok=True)

    jpeg_tables = b''
    bitmaps, shapes, placements, labels = {}, {}, {}, []
    frame = 0

    for code, body in tags(swf):
        if code == 1:
            frame += 1
        elif code == 8:
            jpeg_tables = body[:-2] if body.endswith(b'\xff\xd9') else body
        elif code in IMAGE_TAGS:
            cid, = struct.unpack('<H', body[:2])
            if code == 6:
                data = jpeg_tables + body[2:]
            elif code == 21:
                data = body[2:]
            else:
                alpha_len, = struct.unpack('<I', body[2:6])
                data = body[6:6 + alpha_len]
            # Flash writes an end-then-start marker pair between the tables and
            # the image; a decoder that hasn't seen it reads the file as empty.
            data = data.replace(b'\xff\xd9\xff\xd8', b'', 1)
            if data[:2] == b'\xff\xd8':
                bitmaps[cid] = data
        elif code in (2, 22, 32):
            sid, = struct.unpack('<H', body[:2])
            bid = shape_bitmap(body, {2: 1, 22: 2, 32: 3}[code])
            if bid is not None:
                shapes[sid] = bid
        elif code == 26:                       # PlaceObject2
            flags, = body[0], 
            if body[0] & 0x02:                 # has a character
                cid, = struct.unpack('<H', body[3:5])
                placements.setdefault(frame + 1, []).append(cid)
        elif code == 43:                       # FrameLabel
            raw = body.split(b'\x00')[0]
            try:
                label = raw.decode('utf-8')
            except UnicodeDecodeError:
                label = raw.decode('shift_jis', 'replace')
            labels.append((frame + 1, label))

    manifest, used = [], set()
    for frame_no, label in labels:
        background = None
        for cid in placements.get(frame_no, []):
            bid = shapes.get(cid)
            if bid in bitmaps and jpeg_size(bitmaps[bid]) == (600, 800):
                background, used = bid, used | {bid}
                break
        manifest.append({'frame': frame_no, 'label': label, 'bitmap': background})
        if background is not None:
            open(os.path.join(images, '%04d.jpg' % background), 'wb').write(bitmaps[background])

    for bid, data in bitmaps.items():
        if bid not in used:
            open(os.path.join(sprites, '%04d.jpg' % bid), 'wb').write(data)

    json.dump(manifest, open(os.path.join(outdir, 'frames.json'), 'w'),
              indent=1, ensure_ascii=False)
    print('%d screens, %d sprites, %d labelled frames'
          % (len(used), len(bitmaps) - len(used), len(labels)))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'nav':
        extract_nav(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3:
        main(sys.argv[1], sys.argv[2])
    else:
        raise SystemExit(__doc__ + '\n        python3 tools/extract_swf.py nav '
                         '<exe> <nav.json>   # button hit areas + goto targets')
