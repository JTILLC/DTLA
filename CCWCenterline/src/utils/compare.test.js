import { describe, it, expect } from 'vitest';
import {
  compareSettings, normalizeValue, comparisonCsv, centerlineLabel,
  CHANGED, ONLY_A, ONLY_B, SAME,
} from './compare';

const row = (section, label, value) => ({ section, label, value });

describe('normalizeValue', () => {
  it('ignores case and spacing, which are not drift', () => {
    expect(normalizeValue('0.30 g')).toBe(normalizeValue('0.30g'));
    expect(normalizeValue('Off')).toBe(normalizeValue('off'));
    expect(normalizeValue('  6 ')).toBe(normalizeValue('6'));
  });

  it('does NOT decide that 90 and 90.0 are the same reading', () => {
    // The panel's display format is fixed, so a reading of "90" where "90.0"
    // was recorded means the two readings really did differ. Deciding they
    // match would hide exactly the drift this exists to find.
    expect(normalizeValue('90')).not.toBe(normalizeValue('90.0'));
  });
});

describe('compareSettings', () => {
  const before = [
    row('Preset - Weight Setting', 'Target Weight', '227.0g'),
    row('Preset - Weight Setting', 'Upper Weight Limit', '6.0g'),
    row('Preset - Machine', 'Speed', '65wpm'),
  ];

  it('finds a value that moved', () => {
    const after = [
      row('Preset - Weight Setting', 'Target Weight', '230.0g'),
      row('Preset - Weight Setting', 'Upper Weight Limit', '6.0g'),
      row('Preset - Machine', 'Speed', '65wpm'),
    ];
    const result = compareSettings(before, after);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]).toMatchObject({
      label: 'Target Weight', a: '227.0g', b: '230.0g', status: CHANGED,
    });
    expect(result.same).toHaveLength(2);
    expect(result.differences).toBe(1);
    expect(result.identical).toBe(false);
  });

  it('says so plainly when nothing moved', () => {
    const result = compareSettings(before, before);
    expect(result.identical).toBe(true);
    expect(result.differences).toBe(0);
    expect(result.same).toHaveLength(3);
  });

  it('is not fooled by a difference in spacing or case', () => {
    const result = compareSettings(
      [row('S', 'Photo SW', 'Off')],
      [row('S', 'Photo SW', 'off ')],
    );
    expect(result.changed).toHaveLength(0);
    expect(result.same[0].status).toBe(SAME);
  });

  it('separates what each side has that the other does not', () => {
    const result = compareSettings(
      [row('S', 'Kept', '1'), row('S', 'Dropped', '2')],
      [row('S', 'Kept', '1'), row('S', 'Added', '3')],
    );
    expect(result.onlyA.map((r) => r.label)).toEqual(['Dropped']);
    expect(result.onlyB.map((r) => r.label)).toEqual(['Added']);
    expect(result.onlyA[0]).toMatchObject({ a: '2', b: null, status: ONLY_A });
    expect(result.onlyB[0]).toMatchObject({ a: null, b: '3', status: ONLY_B });
    expect(result.differences).toBe(2);
  });

  it('does not confuse the same setting name on two different screens', () => {
    // PH and WH both carry STOP DELAY PLS at different values; matched on name
    // alone, one would look like drift in the other.
    const result = compareSettings(
      [row('Hopper PH', 'Stop Delay Pls', '5'), row('Hopper WH', 'Stop Delay Pls', '4')],
      [row('Hopper PH', 'Stop Delay Pls', '5'), row('Hopper WH', 'Stop Delay Pls', '4')],
    );
    expect(result.identical).toBe(true);
    expect(result.same).toHaveLength(2);
  });

  it('matches a setting across the spellings the RCU uses', () => {
    const result = compareSettings(
      [row('Scale', 'Auto Zero Tolerance', '4.00 g')],
      [row('Scale', 'AUTO ZERO TOLERANCE', '12.00 g')],
    );
    expect(result.changed).toHaveLength(1);
    expect(result.onlyA).toHaveLength(0);
    expect(result.onlyB).toHaveLength(0);
  });

  it('handles either side being empty', () => {
    expect(compareSettings([], []).identical).toBe(true);
    expect(compareSettings(before, []).onlyA).toHaveLength(3);
    expect(compareSettings([], before).onlyB).toHaveLength(3);
    expect(compareSettings(undefined, undefined).identical).toBe(true);
  });

  it('keeps changed settings first, where they will be seen', () => {
    const result = compareSettings(
      [row('S', 'A', '1'), row('S', 'B', '2'), row('S', 'C', '3')],
      [row('S', 'A', '1'), row('S', 'B', '9'), row('S', 'C', '3')],
    );
    expect(result.changed[0].label).toBe('B');
  });
});

describe('comparisonCsv', () => {
  const left = { customer: "Shearer's", product: 'KETTLE CHIPS', date: '2026-08-01' };
  const right = { customer: "Shearer's", product: 'KETTLE CHIPS', date: '2026-09-02' };
  const result = compareSettings(
    [row('S', 'Target Weight', '227.0g')],
    [row('S', 'Target Weight', '230.0g')],
  );

  it('names both sides, so the columns can be checked', () => {
    const csv = comparisonCsv(left, right, result);
    expect(csv).toMatch(/A,Shearer's · KETTLE CHIPS · 2026-08-01/);
    expect(csv).toMatch(/B,Shearer's · KETTLE CHIPS · 2026-09-02/);
  });

  it('carries the status and both values on each row', () => {
    expect(comparisonCsv(left, right, result))
      .toMatch(/Changed,S,Target Weight,227\.0g,230\.0g/);
  });

  it('still says what it is', () => {
    expect(comparisonCsv(left, right, result)).toMatch(/not a record of running values/i);
  });
});

describe('centerlineLabel', () => {
  it('names a centerline by who, what and when', () => {
    expect(centerlineLabel({ customer: "Shearer's", product: 'CHIPS', date: '2026-09-02' }))
      .toBe("Shearer's · CHIPS · 2026-09-02");
  });

  it('never comes back blank', () => {
    expect(centerlineLabel({})).toBe('Untitled centerline');
    expect(centerlineLabel(null)).toBe('Untitled centerline');
  });
});
