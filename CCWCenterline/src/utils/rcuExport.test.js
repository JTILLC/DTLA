// The rules that are easy to get wrong when reading an RCU export, and that
// put a wrong figure on a customer's document when you do.
import { describe, it, expect } from 'vitest';
import { parseExport, exportName, parseExportSet, flattenExports } from './rcuExport';

const doc = (body) => `--------------------\n  A BLOCK\n--------------------\n${body}`;

describe('parseExport', () => {
  it('reads the block title and a plain label/value', () => {
    const got = parseExport(doc('STABLE CNT   :   6\n'));
    expect(got.title).toBe('A BLOCK');
    expect(got.values['STABLE CNT']).toBe('6');
  });

  it('takes a value printed ABOVE its label', () => {
    // The whole reason this parser exists. Read top-down and EMPTY JUDG WT is
    // blank while its 1.0 g is silently dropped.
    const got = parseExport(doc('RANGE   : 400 g\n            1.0 g\nEMPTY JUDG WT   :\n'));
    expect(got.values.RANGE).toBe('400 g');
    expect(got.values['EMPTY JUDG WT']).toBe('1.0 g');
  });

  it('does not let a bare line reach a later label', () => {
    const got = parseExport(doc('   SLIT\nDRIVE STOP PARM:\nBRAKE TIME   :  50 ms\n'));
    expect(got.values['DRIVE STOP PARM']).toBe('SLIT');
    expect(got.values['BRAKE TIME']).toBe('50 ms');
  });

  it('keeps sub-blocks apart when they reuse a key', () => {
    // PH and WH both have STOP DELAY PLS. Flattened, one overwrites the other.
    const got = parseExport(doc(
      '     == PH ==\nSTOP DELAY PLS :   5\n     == WH ==\nSTOP DELAY PLS :   4\n'
    ));
    expect(got.groups.PH['STOP DELAY PLS']).toBe('5');
    expect(got.groups.WH['STOP DELAY PLS']).toBe('4');
  });

  it('treats a row of numbers as data, not as a wrapped value', () => {
    const got = parseExport(doc(
      ' --- DRIVE PATTERN ---\n 1  90 195   0   3   0\n 2 100 140   0   0   5\n'
      + 'BRAKE TIME   :   50 ms\n'
    ));
    const group = got.groups['- DRIVE PATTERN -'];
    expect(group._rows).toHaveLength(2);
    expect(group._rows[0]).toEqual(['1', '90', '195', '0', '3', '0']);
    expect(group['BRAKE TIME']).toBe('50 ms');
  });

  it('survives a file with no title rules at all', () => {
    const got = parseExport('TARGET : 90.0 g\n');
    expect(got.title).toBeNull();
    expect(got.values.TARGET).toBe('90.0 g');
  });
});

describe('exportName', () => {
  it('handles both filename shapes the RCU writes', () => {
    // Splitting on '_' works for the first and fails silently on the second.
    expect(exportName('Afv____240730142241.csv')).toBe('Afv');
    expect(exportName('Section240730142308.csv')).toBe('Section');
    expect(exportName('/some/path/Hopper_240730142316.csv')).toBe('Hopper');
  });
});

describe('parseExportSet and flattenExports', () => {
  const set = parseExportSet([
    { name: 'Scale__240730142302.csv', text: doc('AUTO ZERO TOL : 4.00 g\n') },
    { name: 'Hopper_240730142316.csv',
      text: doc('  == PH ==\nSTOP DELAY PLS : 5\n  == WH ==\nSTOP DELAY PLS : 4\n') },
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
});
