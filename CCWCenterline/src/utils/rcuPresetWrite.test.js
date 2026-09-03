import { describe, it, expect } from 'vitest';
import { parsePresets, parseRecord, presetBlocks, RECORD, PRESET_FILE_SIZE } from './rcuPreset';
import { blockToSection } from './rcuExport';
import { headMask, num, presetFromSections, writePreset, emptySlots, keptFields } from './rcuPresetWrite';

/** A file with one real preset in slot 2, built the way the decoder test does. */
function file() {
  const buf = new ArrayBuffer(PRESET_FILE_SIZE);
  const dv = new DataView(buf);
  const b = new Uint8Array(buf);
  const base = RECORD;
  const put = (o, s) => { for (let i = 0; i < s.length; i += 1) b[base + o + i] = s.charCodeAt(i); };
  dv.setUint32(base, 1); dv.setUint32(base + 4, 2);
  put(0x08, 'UNSALTED'); put(0x21, '096619885718');
  dv.setUint32(base + 0xa4, 0x0000f800); b.set([20, 13, 6, 10, 0, 0, 36, 39, 33], base + 0xa4 + 4);
  dv.setUint32(base + 0xa4 + 16, 0x000007e0); b.set([20, 13, 6, 14, 0, 0, 40, 44, 33], base + 0xa4 + 20);
  for (let k = 2; k < 8; k += 1) dv.setUint32(base + 0xa4 + 16 * k, 0xffff);
  const F = base + 0x13c;
  for (let k = 0; k < 8; k += 1) b.set([99, 0, 99, 0], F + 4 + 12 * k + 8);
  for (let h = 0; h < 32; h += 1) b.set([60 + h, 30], F + 4 + 96 + 2 * h);
  b.set([65, 32, 65, 70], F + 4 + 96 + 64);
  const inf = F + 4 + 96 + 64 + 16 + 32;
  dv.setUint16(inf, 2500); b[inf + 2] = 50; b[inf + 3] = 40; dv.setUint16(inf + 4, 500); b[inf + 8] = 50;
  dv.setUint32(base + 0x320, 0xffffffff);
  for (const [k, t] of [[0, 1139], [1, 2727]]) {
    const o = base + 0x510 + 136 * k;
    dv.setUint16(o + 0x0a, t); dv.setUint16(o + 0x0c, 50);
    b[o + 0x1a] = 38; b[o + 0x24] = 30; b[o + 0x25] = 1; dv.setUint16(o + 0x64, 990);
  }
  dv.setUint16(base + 0x950 + 0x0a, 3866); dv.setUint16(base + 0x950 + 0x0c, 50);
  dv.setUint16(base + 0x950 + 0x18, 40); b[base + 0x950 + 0x1a] = 1;
  put(0x978, 'PISTACHIO(DR)'); put(0x978 + 25, '100000086707');
  put(0x978 + 48, 'CASHEW(OR)'); put(0x978 + 48 + 25, '100000086675');
  b.set([24, 7, 29, 1, 0, 12, 9, 38], base + 0xb18);
  return buf;
}

const sectionsOf = (preset) => Object.entries(presetBlocks(preset)).map(([k, blk]) => blockToSection(blk, k));

describe('headMask and num', () => {
  it('invert the decoder', () => {
    expect(headMask('12-16')).toBe(0x0000f800);
    expect(headMask('28-32')).toBe(0xf8000000);
    expect(headMask('2,4')).toBe(0b1010);
    expect(headMask('')).toBe(0xffff);
    expect(() => headMask('0-3')).toThrow();
    expect(num('113.9 g')).toBe(113.9);
    expect(num('+50%')).toBe(50);
    expect(num('-40%')).toBe(40);
    expect(num('')).toBeNull();
  });
});

describe('writePreset', () => {
  it('round-trips a preset through the document untouched', () => {
    const original = file();
    const preset = parsePresets(original)[0];
    const p = presetFromSections(sectionsOf(preset));
    const written = writePreset(original, 2, p, new Date(2024, 6, 29, 12, 9, 38));
    // byte for byte: every confirmed field lands where it came from
    expect(new Uint8Array(written)).toEqual(new Uint8Array(original));
  });

  it('leaves every other slot and every unproven field alone', () => {
    const original = file();
    const preset = parsePresets(original)[0];
    const sections = sectionsOf(preset);
    const target = sections[0].fields.find((f) => f.label === 'Target Weight');
    target.value = '400.0 g';
    const upper = sections[0].fields.find((f) => f.label === 'Upper Weight Limit');
    upper.value = '9.9 g';           // not confirmed: must NOT be written
    const written = writePreset(original, 2, presetFromSections(sections), new Date(2026, 8, 3, 9, 0, 0));
    const r = parseRecord(new DataView(written), RECORD, 1);
    expect(r.total.target).toBe(400);
    expect(r.total.upper).toBe(5);
    expect(r.modified).toBe('2026-09-03 09:00:00');
    const before = new Uint8Array(original);
    const after = new Uint8Array(written);
    expect(after.subarray(0, RECORD)).toEqual(before.subarray(0, RECORD));
    expect(after.subarray(2 * RECORD)).toEqual(before.subarray(2 * RECORD));
  });

  it('writes a hand-filled preset into an empty slot', () => {
    const sections = [{
      kind: 'photo', title: 'Preset · Product', fields: [
        { label: 'Product Name', value: 'TRAIL MIX' }, { label: 'Product Code', value: '12345' },
        { label: 'Target Weight', value: '250 g' }, { label: 'Auto Feed Target', value: '4.2' },
      ],
    }, {
      kind: 'photo', title: 'Preset · Timing', fields: [{ label: 'WH-PH', value: '190 ms' }, { label: 'WH on', value: '360 ms' }],
    }, {
      kind: 'photo', title: 'Preset · Feeder', fields: [
        { label: 'RF › RF 1 amplitude', value: '55' }, { label: 'RF › RF 1 time', value: '45' },
        { label: 'DF › DF 1 amplitude', value: '50' }, { label: 'DF 1 infeed › Infeed weight', value: '600 g' },
      ],
    }];
    const written = writePreset(file(), 6, presetFromSections(sections));
    const r = parseRecord(new DataView(written), 5 * RECORD, 5);
    expect([r.no, r.name, r.code, r.total.target]).toEqual([6, 'TRAIL MIX', '12345', 250]);
    expect(r.sections[0].timing['WH-PH']).toBe(190);
    expect(r.sections[0].autoFeedTarget).toBe(4.2);
    expect(r.feeder.rf[0]).toEqual({ amp: 55, time: 45 });
    expect(r.feeder.df[0].amp).toBe(50);
    expect(r.feeder.dfInfeed[0].infeedWt).toBe(600);
    expect(parsePresets(written).map((p) => p.no)).toEqual([2, 6]);
  });

  it('copies a decoded preset to a new number with its unproven fields intact', () => {
    const original = file();
    const sections = sectionsOf(parsePresets(original)[0]);
    sections[0].fields.find((f) => f.label === 'Product Name').value = 'UNSALTED TRIAL';
    const p = presetFromSections(sections);
    expect(p.from).toBe(2);
    const written = writePreset(original, 6, p);
    const r = parseRecord(new DataView(written), 5 * RECORD, 5);
    expect([r.no, r.name]).toEqual([6, 'UNSALTED TRIAL']);
    expect(r.total.upper).toBe(5);       // came along from preset 2, not slot 6's zero
    expect(r.total.speed).toBe(40);
    expect(keptFields(r)[0]).toEqual(['Upper Weight Limit', '5.0 g']);
    // and preset 2 itself is untouched
    expect(parseRecord(new DataView(written), RECORD, 1).name).toBe('UNSALTED');
  });

  it('refuses what it cannot represent', () => {
    const p = presetFromSections([{ kind: 'photo', title: 'Preset · Product', fields: [{ label: 'Target Weight', value: '9999 g' }] }]);
    expect(() => writePreset(file(), 3, p)).toThrow(/does not fit/);
    expect(() => writePreset(new ArrayBuffer(4), 3, p)).toThrow(/Preset\.prm/);
    expect(() => writePreset(file(), 201, p)).toThrow(/1-200/);
  });

  it('lists the empty slots', () => {
    expect(emptySlots(parsePresets(file())).slice(0, 3)).toEqual([1, 3, 4]);
  });
});
