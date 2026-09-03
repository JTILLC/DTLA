// The rules that are easy to get wrong when reading an RCU export. Same cases
// as tools/test_parse_export.py; the fixtures are excerpts of a real output
// folder (32-head machine, RCU W0530G), trimmed to the lines that matter.
import { describe, it, expect } from 'vitest';
import {
  parseExport, exportName, parseExportSet, flattenExports, blockToSection,
} from './rcuExport';

const doc = (body) => `--------------------\n  A BLOCK\n--------------------\n${body}`;

describe('parseExport', () => {
  it('reads the block title and a plain label/value', () => {
    const got = parseExport(doc('STABLE CNT   :   6\n'));
    expect(got.title).toBe('A BLOCK');
    expect(got.values['STABLE CNT']).toBe('6');
  });

  it('attaches a wrapped value to the label ABOVE it', () => {
    // AD PARAMETER as the machine prints it. Read naively EMPTY JUDG WT is
    // blank; attached to the label after it, AUTO ZERO TOL is lost.
    const got = parseExport(doc(
      'RANGE           : 400 g\nEMPTY JUDG WT   :\n               1.0 g\nAUTO ZERO TOL   : 4.00 g\n',
    ));
    expect(got.values).toEqual({ RANGE: '400 g', 'EMPTY JUDG WT': '1.0 g', 'AUTO ZERO TOL': '4.00 g' });
  });

  it('keeps consecutive wrapped values with their own labels', () => {
    // The old above-the-label rule read ACTUATOR TYPE as SLIT and DRIVE POWER
    // as STEPPING MOTOR - each individually plausible.
    const got = parseExport(doc(
      'DRIVE STOP PARM:\n              SLIT\nACTUATOR TYPE :\n    STEPPING MOTOR\n'
      + 'DRIVE POWER   :\n              HALF\nERR DETECT PLS:   10\n',
    ));
    expect(got.values).toEqual({
      'DRIVE STOP PARM': 'SLIT', 'ACTUATOR TYPE': 'STEPPING MOTOR',
      'DRIVE POWER': 'HALF', 'ERR DETECT PLS': '10',
    });
  });

  it('falls back to a bare line above when nothing follows', () => {
    const got = parseExport(doc('RANGE   : 400 g\n        1.0 g\nEMPTY JUDG WT   :\nIIR : 160\n'));
    expect(got.values['EMPTY JUDG WT']).toBe('1.0 g');
    expect(got.values.IIR).toBe('160');
  });

  it('does not let a bare line reach a later label', () => {
    const got = parseExport(doc('   SLIT\nDRIVE STOP PARM:\nBRAKE TIME   :  50 ms\n'));
    expect(got.values['DRIVE STOP PARM']).toBe('SLIT');
    expect(got.values['BRAKE TIME']).toBe('50 ms');
  });

  it('keeps sub-blocks apart when they reuse a key', () => {
    const got = parseExport(doc(
      '     == PH ==\nSTOP DELAY PLS :   5\n     == WH ==\nSTOP DELAY PLS :   4\n',
    ));
    expect(got.groups.PH['STOP DELAY PLS']).toBe('5');
    expect(got.groups.WH['STOP DELAY PLS']).toBe('4');
  });

  it('gives each hopper its own drive pattern', () => {
    const got = parseExport(doc(
      '     == PH ==\nBRAKE TIME    :   50 ms\n\n --- DRIVE PATTERN ---\n\n'
      + ' 1  90 195   0   3   0\n 2 100 140   0   0   5\n\n'
      + '     == WH ==\nBRAKE TIME    :   50 ms\n\n --- DRIVE PATTERN ---\n\n'
      + ' 1  16 160   0   3   0\n',
    ));
    expect(Object.keys(got.groups)).toEqual(['PH', 'PH › DRIVE PATTERN', 'WH', 'WH › DRIVE PATTERN']);
    expect(got.groups['PH › DRIVE PATTERN']._rows).toEqual([
      ['1', '90', '195', '0', '3', '0'], ['2', '100', '140', '0', '0', '5'],
    ]);
    expect(got.groups['WH › DRIVE PATTERN']._rows).toEqual([['1', '16', '160', '0', '3', '0']]);
  });

  it('treats a row of numbers as data, not as a wrapped value', () => {
    const got = parseExport(doc(
      ' --- DRIVE PATTERN ---\n 1  90 195   0   3   0\n 2 100 140   0   0   5\nBRAKE TIME   :   50 ms\n',
    ));
    const group = got.groups['DRIVE PATTERN'];
    expect(group._rows).toHaveLength(2);
    expect(group['BRAKE TIME']).toBe('50 ms');
  });

  it('reads three-column rows with negatives as rows', () => {
    const got = parseExport(doc(' --- DRIVE PATTERN ---\n      1    -1    -1\n      2    -1   -100\n'));
    expect(got.groups['DRIVE PATTERN']._rows).toEqual([['1', '-1', '-1'], ['2', '-1', '-100']]);
  });

  it('nests repeated parameter sets and skips the repeated title', () => {
    const one = (n, port) => '--------------------\nINTERLOCK PARAMETER\n--------------------\n'
      + ` -- INTLK PARM NO.  ${n} --\nINTERFACE:  STK ON DMD\nMULTI DMP INIT:\n`
      + `                  SELF\n===== DTH1 =====\nEXC PORT No.  :J41${port}\n`;
    const got = parseExport(one(1, 3) + one(2, 4));
    expect(got.title).toBe('INTERLOCK PARAMETER');
    expect(got.values).toEqual({});
    expect(got.groups['INTLK PARM NO. 1']['MULTI DMP INIT']).toBe('SELF');
    expect(got.groups['INTLK PARM NO. 1 › DTH1']['EXC PORT No.']).toBe('J413');
    expect(got.groups['INTLK PARM NO. 2 › DTH1']['EXC PORT No.']).toBe('J414');
  });

  it('turns two value columns into two settings', () => {
    const got = parseExport(doc('        NTRL     DRV\n RF 1: 51.0Hz  49.6Hz\n DF 1: 40.0Hz  40.5Hz\n'));
    expect(got.values).toEqual({
      'RF 1 NTRL': '51.0Hz', 'RF 1 DRV': '49.6Hz', 'DF 1 NTRL': '40.0Hz', 'DF 1 DRV': '40.5Hz',
    });
  });

  it('reads the board table, which names the RCU', () => {
    const got = parseExport(doc(
      'FDC SWITCH      :  4\n  \nNAME   NODE ID\n            REVISION\n'
      + ' PACK  0-7f P8659 \n            1.1\n  RCU  0- 0 W0530G\n            8.1\n',
    ));
    expect(got.values['FDC SWITCH']).toBe('4');
    expect(got.groups.BOARDS.RCU).toBe('W0530G rev 8.1 (node 0-0)');
    expect(got.groups.BOARDS.PACK).toBe('P8659 rev 1.1 (node 0-7f)');
  });

  it('squashes the spacing inside a value', () => {
    const got = parseExport(doc('  --PARAMETER 1--\n  S1 :  1 -  5\n  S2 :  6 - 11\n'));
    expect(got.groups['PARAMETER 1']).toEqual({ S1: '1 - 5', S2: '6 - 11' });
  });

  it('survives a file with no title rules at all', () => {
    const got = parseExport('STABLE CNT : 6\n');
    expect(got.title).toBeNull();
    expect(got.values['STABLE CNT']).toBe('6');
  });
});

describe('exportName', () => {
  it('handles both filename shapes the RCU writes', () => {
    expect(exportName('Afv____240730142241.csv')).toBe('Afv');
    expect(exportName('Section240730142308.csv')).toBe('Section');
    expect(exportName('/some/path/Hopper_240730142316.csv')).toBe('Hopper');
  });
});

describe('parseExportSet, flattenExports and blockToSection', () => {
  const set = parseExportSet([
    { name: 'Scale__240730142302.csv', text: doc('AUTO ZERO TOL : 4.00 g\n') },
    { name: 'Hopper_240730142316.csv',
      text: doc('  == PH ==\nSTOP DELAY PLS : 5\n --- DRIVE PATTERN ---\n 1  90 195   0   3   0\n'
        + '  == WH ==\nSTOP DELAY PLS : 4\n') },
    { name: 'notes.txt', text: 'ignored' },
  ]);

  it('keys each file by its block name and ignores non-exports', () => {
    expect(Object.keys(set).sort()).toEqual(['Hopper', 'Scale']);
  });

  it('gives repeated labels a path that tells them apart', () => {
    const flat = flattenExports(set);
    const delays = flat.filter((f) => f.label === 'STOP DELAY PLS');
    expect(delays).toHaveLength(2);
    expect(delays.map((d) => d.path).sort()).toEqual([
      'Hopper › PH › STOP DELAY PLS',
      'Hopper › WH › STOP DELAY PLS',
    ]);
    expect(delays.map((d) => d.value).sort()).toEqual(['4', '5']);
  });

  it('shows drive pattern rows as settings, one per row', () => {
    const row = flattenExports(set).find((f) => f.group === 'PH › DRIVE PATTERN');
    expect(row).toMatchObject({ label: '1', value: '90 195 0 3 0', path: 'Hopper › PH › DRIVE PATTERN › 1' });
  });

  it('makes a whole block a section with the sub-block in each label', () => {
    const section = blockToSection(set.Hopper, 'Hopper');
    expect(section).toMatchObject({ kind: 'photo', title: 'A BLOCK', image: '', source: 'imported' });
    expect(section.fields).toEqual([
      { label: 'PH › STOP DELAY PLS', value: '5', confident: true },
      { label: 'PH › DRIVE PATTERN › 1', value: '90 195 0 3 0', confident: true },
      { label: 'WH › STOP DELAY PLS', value: '4', confident: true },
    ]);
  });
});
