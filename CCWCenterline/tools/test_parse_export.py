"""The rules that are easy to get wrong when reading an RCU export.

The fixtures are excerpts of a real output folder (32-head machine, RCU
W0530G), trimmed to the lines that exercise each rule.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_export import parse

HEAD = '--------------------\n  X\n--------------------\n'


def test_plain_label_value():
    got = parse('----\n  AD PARAMETER\n----\nSTABLE CNT   :   6\n')
    assert got['title'] == 'AD PARAMETER'
    assert got['values']['STABLE CNT'] == '6'


def test_value_wraps_onto_the_line_below_its_label():
    # AD PARAMETER, as the machine prints it. Read naively EMPTY JUDG WT is
    # blank; attached to the label after it, AUTO ZERO TOL would be lost.
    got = parse(HEAD + 'RANGE           : 400 g\nEMPTY JUDG WT   :\n'
                '               1.0 g\nAUTO ZERO TOL   : 4.00 g\n')
    assert got['values']['RANGE'] == '400 g'
    assert got['values']['EMPTY JUDG WT'] == '1.0 g'
    assert got['values']['AUTO ZERO TOL'] == '4.00 g'


def test_consecutive_wrapped_values_each_stay_with_their_own_label():
    # HOPPER DRIVE: three wrapped fields in a row. The old above-the-label
    # rule read ACTUATOR TYPE as SLIT and DRIVE POWER as STEPPING MOTOR.
    got = parse(HEAD + 'DRIVE STOP PARM:\n              SLIT\nACTUATOR TYPE :\n'
                '    STEPPING MOTOR\nDRIVE POWER   :\n              HALF\n'
                'ERR DETECT PLS:   10\n')
    v = got['values']
    assert v['DRIVE STOP PARM'] == 'SLIT'
    assert v['ACTUATOR TYPE'] == 'STEPPING MOTOR'
    assert v['DRIVE POWER'] == 'HALF'
    assert v['ERR DETECT PLS'] == '10'


def test_value_printed_above_its_label_is_the_fallback():
    got = parse(HEAD + 'RANGE   : 400 g\n        1.0 g\nEMPTY JUDG WT   :\nIIR : 160\n')
    assert got['values']['EMPTY JUDG WT'] == '1.0 g'
    assert got['values']['IIR'] == '160'


def test_a_bare_line_is_not_reused_by_a_later_label():
    got = parse(HEAD + '   SLIT\nDRIVE STOP PARM:\nBRAKE TIME   :  50 ms\n')
    assert got['values']['DRIVE STOP PARM'] == 'SLIT'
    assert got['values']['BRAKE TIME'] == '50 ms'


def test_sub_blocks_do_not_collide():
    text = ('----\nHOPPER DRIVE\n----\n     == PH ==\nSTOP DELAY PLS :   5\n'
            '     == WH ==\nSTOP DELAY PLS :   4\n')
    got = parse(text)
    assert got['groups']['PH']['STOP DELAY PLS'] == '5'
    assert got['groups']['WH']['STOP DELAY PLS'] == '4'


def test_each_hopper_keeps_its_own_drive_pattern():
    text = (HEAD + '     == PH ==\nBRAKE TIME    :   50 ms\n\n --- DRIVE PATTERN ---\n\n'
            ' 1  90 195   0   3   0\n 2 100 140   0   0   5\n\n'
            '     == WH ==\nBRAKE TIME    :   50 ms\n\n --- DRIVE PATTERN ---\n\n'
            ' 1  16 160   0   3   0\n')
    got = parse(text)
    assert list(got['groups']) == ['PH', 'PH › DRIVE PATTERN', 'WH', 'WH › DRIVE PATTERN']
    assert got['groups']['PH › DRIVE PATTERN']['_rows'] == [
        ['1', '90', '195', '0', '3', '0'], ['2', '100', '140', '0', '0', '5']]
    assert got['groups']['WH › DRIVE PATTERN']['_rows'] == [['1', '16', '160', '0', '3', '0']]


def test_numeric_rows_are_data_not_a_wrapped_value():
    text = (HEAD + ' --- DRIVE PATTERN ---\n 1  90 195   0   3   0\n'
            ' 2 100 140   0   0   5\nBRAKE TIME   :   50 ms\n')
    got = parse(text)
    group = got['groups']['DRIVE PATTERN']
    assert len(group['_rows']) == 2
    assert group['BRAKE TIME'] == '50 ms'


def test_three_column_rows_with_negatives_are_still_rows():
    got = parse(HEAD + ' --- DRIVE PATTERN ---\n      1    -1    -1\n      2    -1   -100\n')
    assert got['groups']['DRIVE PATTERN']['_rows'] == [['1', '-1', '-1'], ['2', '-1', '-100']]


def test_repeated_parameter_sets_nest_and_the_repeated_title_is_skipped():
    # INTERLOCK PARAMETER prints its title again before every parameter set,
    # and every set carries the same DTH1 / DTH2 sub-blocks.
    one = ('--------------------\nINTERLOCK PARAMETER\n--------------------\n'
           ' -- INTLK PARM NO.  %d --\nINTERFACE:  STK ON DMD\nMULTI DMP INIT:\n'
           '                  SELF\n===== DTH1 =====\nEXC PORT No.  :J41%d\n')
    got = parse(one % (1, 3) + one % (2, 4))
    assert got['title'] == 'INTERLOCK PARAMETER'
    assert got['values'] == {}
    assert got['groups']['INTLK PARM NO. 1']['MULTI DMP INIT'] == 'SELF'
    assert got['groups']['INTLK PARM NO. 1 › DTH1']['EXC PORT No.'] == 'J413'
    assert got['groups']['INTLK PARM NO. 2 › DTH1']['EXC PORT No.'] == 'J414'


def test_two_value_columns_become_two_settings():
    got = parse(HEAD + '        NTRL     DRV\n RF 1: 51.0Hz  49.6Hz\n DF 1: 40.0Hz  40.5Hz\n')
    assert got['values'] == {
        'RF 1 NTRL': '51.0Hz', 'RF 1 DRV': '49.6Hz',
        'DF 1 NTRL': '40.0Hz', 'DF 1 DRV': '40.5Hz'}


def test_board_table_names_the_rcu():
    got = parse(HEAD + 'FDC SWITCH      :  4\n  \nNAME   NODE ID\n            REVISION\n'
                ' PACK  0-7f P8659 \n            1.1\n  RCU  0- 0 W0530G\n            8.1\n')
    assert got['values']['FDC SWITCH'] == '4'
    assert got['groups']['BOARDS']['RCU'] == 'W0530G rev 8.1 (node 0-0)'
    assert got['groups']['BOARDS']['PACK'] == 'P8659 rev 1.1 (node 0-7f)'


def test_section_ranges_are_squashed():
    got = parse(HEAD + '  --PARAMETER 1--\n  S1 :  1 -  5\n  S2 :  6 - 11\n')
    assert got['groups']['PARAMETER 1'] == {'S1': '1 - 5', 'S2': '6 - 11'}
