#!/usr/bin/env python3
"""Decode Preset.prm, the RCU's binary preset store.

The RCU keeps its presets in a fixed-size binary file, not in the text
exports the Output button writes - and the text export of the preset is the
one file customers never seem to have. This reads the binary directly.

Worked out against one real file (OFI Line 1-1, a 32-head six-section mix
weigher on RCU W0530G, backed up 2024-07-29) and the preset printout example
in the CCW-R-2** instruction manual (Fig. 6-83), whose default values match
the bytes of this file's unused sections exactly. Everything is big-endian.

    200 records x 2892 bytes.  Record i is preset number i+1.

What is CONFIRMED (a default in the manual, or an arithmetic identity, or a
string) is labelled plainly. What is only a well-supported reading is marked
with a `?`. Anything unmarked in the raw hex is not decoded at all.

Usage: python3 tools/parse_preset.py <Preset.prm> [--json] [--all]
       --all prints empty presets too; by default only named ones.
"""
import json, struct, sys

RECORD = 2892
COUNT = 200
HEADS = 32
SECTIONS = 8          # slots; this machine uses 6
FEEDER_SET = 292      # one full set of feeder values


def u8(b, o): return b[o]
def u16(b, o): return struct.unpack_from('>H', b, o)[0]
def s16(b, o): return struct.unpack_from('>h', b, o)[0]
def u32(b, o): return struct.unpack_from('>I', b, o)[0]
def text(b, o, n): return b[o:o + n].split(b'\0', 1)[0].decode('latin-1').strip()


def heads_of(mask):
    """A 32-bit head mask as the RCU prints it: '12-16'. 0xffff means none."""
    if mask in (0, 0xffff, 0xffffffff):
        return ''
    heads = [h + 1 for h in range(HEADS) if mask >> h & 1]
    runs, start, prev = [], heads[0], heads[0]
    for h in heads[1:] + [None]:
        if h != prev + 1:
            runs.append('%d-%d' % (start, prev) if start != prev else str(start))
            start = h
        prev = h
    return ','.join(runs)


def feeder_set(b, o):
    """One set of feeder values: AFD ranges, RF and DF amp/time, DF infeed.

    The layout is the manual's printout in order: per-section AFD auto
    amp/time min-max, `RF n AMP TIME`, `DF n AMP TIME`, then per DF the
    INFEED WT, UPPER %, LOWER %, AFD DF UPPER/LOWER WT, AFD STOP DF LOWER WT.
    The defaults of an unused section (500 g, 20 %, 20 %, 500, 0, 50; RF and
    DF 50/25) are the manual's defaults byte for byte.
    """
    out = {'written': u32(b, o) != 0xffffffff, 'afd': [], 'rf': [], 'df': [], 'df_range?': [], 'df_infeed': []}
    p = o + 4
    for _ in range(SECTIONS):
        out['afd'].append({
            'mode?': u32(b, p), 'x?': u32(b, p + 4),
            'auto_amp_max': u8(b, p + 8), 'auto_amp_min': u8(b, p + 9),
            'auto_time_max': u8(b, p + 10), 'auto_time_min': u8(b, p + 11),
        })
        p += 12
    for _ in range(HEADS):
        out['rf'].append({'amp': u8(b, p), 'time': u8(b, p + 1)})
        p += 2
    for _ in range(SECTIONS):
        out['df'].append({'amp': u8(b, p), 'time': u8(b, p + 1)})
        p += 2
    for _ in range(SECTIONS):
        out['df_range?'].append([u8(b, p), u8(b, p + 1), u8(b, p + 2), u8(b, p + 3)])
        p += 4
    for _ in range(SECTIONS):
        out['df_infeed'].append({
            'infeed_wt_g': u16(b, p), 'upper_pct': u8(b, p + 2), 'lower_pct': u8(b, p + 3),
            'afd_df_upper_wt_g': u16(b, p + 4), 'afd_df_lower_wt_g': u16(b, p + 6),
            'afd_stop_df_lower_wt_g': u8(b, p + 8),
        })
        p += 10
    assert p == o + FEEDER_SET
    return out


def weight_block(b, o):
    """TARGET / UPPER / TOL NEG ERR / EX.UPPER, in 0.1 g, in the manual's order.

    Target is confirmed: the section targets sum to the total in every preset
    of the reference file. The three limits follow in the printout's order,
    but which of the next three u16s is which is not proven - the reference
    file only ever sets one of them.
    """
    return {
        'target_g': u16(b, o + 0x0a) / 10,
        'upper_wt_g': u16(b, o + 0x0c) / 10,
        'tol_neg_err_g?': u16(b, o + 0x0e) / 10,
        'ex_upper_wt_g?': u16(b, o + 0x10) / 10,
    }


def parse_record(b, index):
    r = {'no': index + 1, 'valid': u32(b, 0), 'stored_no': u32(b, 4)}
    r['name'] = text(b, 0x08, 24)
    r['code'] = text(b, 0x21, 23)
    r['u16_0x38?'] = u16(b, 0x38)

    # Timing, per section, in 10 ms units. The defaults of an unused section
    # (WH-PH 190/200, PH-RF 130, WH-BH 60, BH-WH 100) are the manual's.
    r['sections'] = []
    for k in range(SECTIONS):
        o = 0xa4 + 16 * k
        r['sections'].append({
            'heads': heads_of(u32(b, o)),
            'timing_ms': {
                'WH-PH': u8(b, o + 4) * 10, 'PH-RF': u8(b, o + 5) * 10,
                'WH-BH': u8(b, o + 6) * 10, 'BH-WH': u8(b, o + 7) * 10,
                'WH DELAY?': u8(b, o + 8) * 10, 'STAGGER?': u8(b, o + 9) * 10,
                'WH ON?': u8(b, o + 10) * 10, 'PH ON?': u8(b, o + 11) * 10,
                'BH ON?': u8(b, o + 12) * 10,
            },
        })

    r['feeder'] = feeder_set(b, 0x13c)
    r['feeder_optimum'] = feeder_set(b, 0x320)

    # Per-section weights and item settings: 136-byte blocks.
    for k in range(SECTIONS):
        o = 0x510 + 136 * k
        s = r['sections'][k]
        s.update(weight_block(b, o))
        s.update({
            'auto_fd_target': u8(b, o + 0x1a) / 10,
            'priority_partic': u8(b, o + 0x24),
            'feeder_multiply': u8(b, o + 0x25),
            'good_effcncy_lmt_pct': u16(b, o + 0x64) / 10,
            'u8_0x7e?': u8(b, o + 0x7e),
        })

    # The whole preset's block, then the section product names.
    o = 0x950
    r['total'] = weight_block(b, o)
    r['total'].update({
        'speed_bpm?': u16(b, o + 0x18),
        'dump_count?': u8(b, o + 0x1a),
        'av_control?': u8(b, o + 0x21),
        'sect_set?': u8(b, o + 0x27),
    })
    for k in range(SECTIONS):
        p = 0x978 + 48 * k
        r['sections'][k]['prod_name'] = text(b, p, 25)
        r['sections'][k]['prod_code'] = text(b, p + 25, 23)

    yy, mm, dd, wd, _, hh, mi, ss = b[0xb18:0xb20]
    r['modified'] = '20%02d-%02d-%02d %02d:%02d:%02d' % (yy, mm, dd, hh, mi, ss) if mm else ''
    return r


def parse_file(path):
    data = open(path, 'rb').read()
    if len(data) != RECORD * COUNT:
        raise SystemExit('%s is %d bytes; expected %d (200 x 2892)' % (path, len(data), RECORD * COUNT))
    return [parse_record(data[i * RECORD:(i + 1) * RECORD], i) for i in range(COUNT)]


def show(r):
    print('=' * 64)
    print('PRESET NO.%d  %s   code %s   modified %s' % (r['no'], r['name'], r['code'], r['modified']))
    t = r['total']
    print('  TARGET WT %.1f g   UPPER WT %.1f g   TOL NEG ERR? %.1f g   EX.UPPER? %.1f g' % (
        t['target_g'], t['upper_wt_g'], t['tol_neg_err_g?'], t['ex_upper_wt_g?']))
    print('  SPEED? %d bpm   DUMP COUNT? %d   AV.CONTROL? %d   SECT.SET? %d' % (
        t['speed_bpm?'], t['dump_count?'], t['av_control?'], t['sect_set?']))
    live = [s for s in r['sections'] if s['heads']]
    mixed = len(live) > 1
    for k, s in enumerate(r['sections']):
        if not s['heads'] and not s['prod_name'] and not s['target_g']:
            continue
        print('  -- SECTION %d --  heads %s  %s  %s' % (k + 1, s['heads'] or '-', s['prod_name'], s['prod_code']))
        print('     TARGET WT %.1f g  UPPER WT %.1f g  TOL NEG ERR? %.1f g  EX.UPPER? %.1f g' % (
            s['target_g'], s['upper_wt_g'], s['tol_neg_err_g?'], s['ex_upper_wt_g?']))
        tm = s['timing_ms']
        print('     ' + '  '.join('%s %d' % (k2, v) for k2, v in tm.items()))
        print('     AUTO FD TARGET %.1f  PRIORITY PARTIC %d  FEEDER MULTIPLY %d  GOOD EFFCNCY LMT %.1f %%' % (
            s['auto_fd_target'], s['priority_partic'], s['feeder_multiply'], s['good_effcncy_lmt_pct']))
    if mixed:
        total = sum(s['target_g'] for s in live)
        print('  section targets sum to %.1f g (total %.1f g)%s' % (
            total, t['target_g'], '' if abs(total - t['target_g']) < 0.05 else '  <-- DO NOT AGREE'))
    for label, f in (('FEEDER', r['feeder']), ('OPTIMUM VALUE', r['feeder_optimum'])):
        if label == 'OPTIMUM VALUE' and not f['written']:
            print('  --- OPTIMUM VALUE --- never written')
            continue
        print('  --- %s ---   (AMP/TIME)' % label)
        rf = f['rf']
        for row in range(0, HEADS, 8):
            print('     ' + '  '.join('RF%2d %2d/%2d' % (i + 1, rf[i]['amp'], rf[i]['time']) for i in range(row, row + 8)))
        print('     ' + '  '.join('DF%d %2d/%2d' % (i + 1, d['amp'], d['time']) for i, d in enumerate(f['df'][:6])))
        for i, (a, d) in enumerate(zip(f['afd'], f['df_infeed'])):
            if i >= max(len(live), 1):
                break
            print('     S%d AFD auto amp %d-%d time %d-%d   DF infeed %d g +%d%% -%d%%  AFD DF %d/%d g stop %d g' % (
                i + 1, a['auto_amp_min'], a['auto_amp_max'], a['auto_time_min'], a['auto_time_max'],
                d['infeed_wt_g'], d['upper_pct'], d['lower_pct'],
                d['afd_df_upper_wt_g'], d['afd_df_lower_wt_g'], d['afd_stop_df_lower_wt_g']))


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        raise SystemExit(__doc__)
    presets = parse_file(args[0])
    if '--all' not in sys.argv:
        presets = [p for p in presets if p['name']]
    if '--json' in sys.argv:
        print(json.dumps(presets, indent=1))
    else:
        for p in presets:
            show(p)
