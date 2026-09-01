"""The rules that are easy to get wrong when reading an RCU export."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_export import parse


def test_plain_label_value():
    got = parse('----\n  AD PARAMETER\n----\nSTABLE CNT   :   6\n')
    assert got['title'] == 'AD PARAMETER'
    assert got['values']['STABLE CNT'] == '6'


def test_value_printed_above_its_label():
    # The RCU draws value-above-label and prints the same way. Read naively,
    # EMPTY JUDG WT comes out blank and the 1.0 g is lost.
    got = parse('----\nX\n----\nRANGE   : 400 g\n        1.0 g\nEMPTY JUDG WT   :\n')
    assert got['values']['RANGE'] == '400 g'
    assert got['values']['EMPTY JUDG WT'] == '1.0 g'


def test_a_bare_line_is_not_reused_by_a_later_label():
    got = parse('----\nX\n----\n   SLIT\nDRIVE STOP PARM:\nBRAKE TIME   :  50 ms\n')
    assert got['values']['DRIVE STOP PARM'] == 'SLIT'
    assert got['values']['BRAKE TIME'] == '50 ms'


def test_sub_blocks_do_not_collide():
    # PH and WH both have STOP DELAY PLS with different values; flattened, one
    # would overwrite the other and the centerline would print the wrong figure.
    text = ('----\nHOPPER DRIVE\n----\n     == PH ==\nSTOP DELAY PLS :   5\n'
            '     == WH ==\nSTOP DELAY PLS :   4\n')
    got = parse(text)
    assert got['groups']['PH']['STOP DELAY PLS'] == '5'
    assert got['groups']['WH']['STOP DELAY PLS'] == '4'


def test_numeric_rows_are_data_not_a_wrapped_value():
    text = ('----\nX\n----\n --- DRIVE PATTERN ---\n 1  90 195   0   3   0\n'
            ' 2 100 140   0   0   5\nBRAKE TIME   :   50 ms\n')
    got = parse(text)
    group = got['groups']['- DRIVE PATTERN -']
    assert len(group['_rows']) == 2
    assert group['_rows'][0] == ['1', '90', '195', '0', '3', '0']
    assert group['BRAKE TIME'] == '50 ms'
