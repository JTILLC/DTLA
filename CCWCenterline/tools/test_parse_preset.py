"""The layout of a preset record, checked on a record built by hand."""
import os, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_preset import parse_record, heads_of, RECORD


def test_head_masks_print_like_the_rcu():
    assert heads_of(0x0000001f) == '1-5'
    assert heads_of(0x0000f800) == '12-16'
    assert heads_of(0xf8000000) == '28-32'
    assert heads_of(0x0000ffff) == ''       # the file's "no heads" marker
    assert heads_of(0b1010) == '2,4'


def build():
    b = bytearray(RECORD)
    struct.pack_into('>II', b, 0, 1, 2)
    b[0x08:0x08 + 8] = b'MIX 2.5L'
    b[0x21:0x21 + 12] = b'096619885718'
    # section 1 on heads 12-16 with WH-PH 200 ms, PH-RF 130 ms
    struct.pack_into('>I', b, 0xa4, 0x0000f800)
    b[0xa4 + 4:0xa4 + 13] = bytes([20, 13, 6, 10, 0, 0, 36, 39, 33])
    struct.pack_into('>I', b, 0xa4 + 16, 0x0000ffff)
    # feeder: RF 1 amp 92 time 33; DF 1 65/32; DF 1 infeed 2500 g +50 -40, stop 50
    b[0x13c + 4 + 96:0x13c + 4 + 98] = bytes([92, 33])
    b[0x13c + 4 + 96 + 64:0x13c + 4 + 96 + 66] = bytes([65, 32])
    p = 0x13c + 4 + 96 + 64 + 16 + 32
    b[p:p + 10] = struct.pack('>HBBHHBB', 2500, 50, 40, 500, 0, 50, 0)
    struct.pack_into('>I', b, 0x320, 0xffffffff)    # optimum never written
    # section 1 block: target 113.9 g, upper 5.0 g, auto feed 3.8, priority 30, x1, 99.0 %
    o = 0x510
    struct.pack_into('>HH', b, o + 0x0a, 1139, 50)
    b[o + 0x1a] = 38; b[o + 0x24] = 30; b[o + 0x25] = 1
    struct.pack_into('>H', b, o + 0x64, 990)
    # total block: 1136.6 g, speed 40, dump count 1
    o = 0x950
    struct.pack_into('>HH', b, o + 0x0a, 11366, 50)
    struct.pack_into('>H', b, o + 0x18, 40); b[o + 0x1a] = 1
    b[0x978:0x978 + 13] = b'PISTACHIO(DR)'
    b[0x978 + 25:0x978 + 25 + 12] = b'100000086707'
    b[0xb18:0xb20] = bytes([24, 7, 29, 1, 0, 12, 9, 38])
    return bytes(b)


def test_record_layout():
    r = parse_record(build(), 1)
    assert (r['no'], r['name'], r['code']) == (2, 'MIX 2.5L', '096619885718')
    assert r['modified'] == '2024-07-29 12:09:38'
    s1 = r['sections'][0]
    assert s1['heads'] == '12-16'
    assert s1['timing_ms']['WH-PH'] == 200 and s1['timing_ms']['PH-RF'] == 130
    assert s1['prod_name'] == 'PISTACHIO(DR)' and s1['prod_code'] == '100000086707'
    assert s1['target_g'] == 113.9 and s1['upper_wt_g'] == 5.0
    assert s1['auto_fd_target'] == 3.8 and s1['priority_partic'] == 30
    assert s1['good_effcncy_lmt_pct'] == 99.0
    assert r['sections'][1]['heads'] == ''
    assert r['total']['target_g'] == 1136.6 and r['total']['speed_bpm?'] == 40
    f = r['feeder']
    assert f['rf'][0] == {'amp': 92, 'time': 33}
    assert f['df'][0] == {'amp': 65, 'time': 32}
    assert f['df_infeed'][0]['infeed_wt_g'] == 2500
    assert f['df_infeed'][0]['afd_stop_df_lower_wt_g'] == 50
    assert r['feeder_optimum']['written'] is False
