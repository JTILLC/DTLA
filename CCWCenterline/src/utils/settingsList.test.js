import { describe, it, expect } from 'vitest';
import { listRows, toCsv, toText, listFileName } from './settingsList';

const cl = {
  customer: "Shearer's", plant: 'Phoenix, AZ', machine: 'CCW-R-214',
  product: 'KETTLE CHIPS 8oz', presetNo: 'C1', engineer: 'Josh Lemmons',
  date: '2026-09-02',
};
const rows = [
  { section: 'Preset - Weight Setting', label: 'Target Weight', value: '227.0g', source: 'typed' },
  { section: 'Preset - Weight Setting', label: 'Upper Weight Limit', value: '6.0g', source: 'typed' },
  { section: 'Various Parameter Setting', label: 'Range', value: '800g', source: 'photo' },
];

describe('listRows', () => {
  it('is the setting and its value, in document order', () => {
    expect(listRows(rows).map((r) => [r.setting, r.value])).toEqual([
      ['Target Weight', '227.0g'], ['Upper Weight Limit', '6.0g'], ['Range', '800g'],
    ]);
  });

  it('survives being handed nothing', () => {
    expect(listRows(undefined)).toEqual([]);
  });
});

describe('toCsv', () => {
  const csv = toCsv(cl, rows);

  it('names the machine, so a detached file still says which one it is', () => {
    expect(csv).toMatch(/Machine,CCW-R-214/);
    expect(csv).toMatch(/Product,KETTLE CHIPS 8oz/);
  });

  it('says it is a target rather than a reading', () => {
    expect(csv).toMatch(/not a record of running values/i);
  });

  it('has a header row and one row per setting', () => {
    expect(csv).toMatch(/Screen,Setting,Value,Source/);
    expect(csv).toMatch(/Preset - Weight Setting,Target Weight,227\.0g,typed/);
  });

  it('quotes a field containing a comma', () => {
    // "Phoenix, AZ" unquoted would shift every column after it.
    expect(toCsv({ ...cl }, [])).toMatch(/Plant,"Phoenix, AZ"/);
  });

  it('escapes an embedded quote by doubling it', () => {
    const out = toCsv(cl, [
      { section: 'S', label: 'Name', value: '12" pack', source: '' },
    ]);
    expect(out).toMatch(/S,Name,"12"" pack",/);
  });

  it('handles a value containing a newline without breaking the row', () => {
    const out = toCsv(cl, [{ section: 'S', label: 'Note', value: 'a\nb', source: '' }]);
    expect(out).toMatch(/"a\nb"/);
  });

  it('uses CRLF, which is what Excel expects', () => {
    expect(csv).toContain('\r\n');
  });

  it('still produces a usable file with no settings at all', () => {
    const out = toCsv(cl, []);
    expect(out).toMatch(/Screen,Setting,Value,Source/);
    expect(out).toMatch(/Customer,Shearer's/);
  });
});

describe('toText', () => {
  const text = toText(cl, rows);

  it('lines the values up under each other', () => {
    // Read down a phone or pasted into an email, a ragged right edge is the
    // difference between checkable and not.
    const target = text.split('\n').find((l) => l.includes('Target Weight'));
    const upper = text.split('\n').find((l) => l.includes('Upper Weight Limit'));
    expect(target.indexOf('227.0g')).toBe(upper.indexOf('6.0g'));
  });

  it('groups by screen', () => {
    expect(text).toContain('Preset - Weight Setting');
    expect(text).toContain('Various Parameter Setting');
  });

  it('leads with what it is and which machine', () => {
    expect(text.startsWith('CENTERLINE — TARGET SETTINGS')).toBe(true);
    expect(text).toContain('CCW-R-214');
  });
});

describe('listFileName', () => {
  it('names the file after the machine and product', () => {
    expect(listFileName(cl, 'csv')).toBe('Settings_Shearers_KETTLECHIPS8oz_2026-09-02.csv');
  });

  it('still produces a name with nothing filled in', () => {
    expect(listFileName({ date: '2026-09-02' }, 'csv')).toBe('Settings_Machine_2026-09-02.csv');
  });
});
