// The preset record layout, checked on a record built by hand - the same
// case as tools/test_parse_preset.py.
import { describe, it, expect } from 'vitest';
import {
  parseRecord, parsePresets, headsOf, presetBlocks, blankPresetBlocks, RECORD, PRESET_FILE_SIZE,
} from './rcuPreset';
import { blockToSection } from './rcuExport';

function build() {
  const buf = new ArrayBuffer(PRESET_FILE_SIZE);
  const dv = new DataView(buf);
  const b = new Uint8Array(buf);
  const base = RECORD; // record 1 = preset 2
  const put = (o, s) => { for (let i = 0; i < s.length; i += 1) b[base + o + i] = s.charCodeAt(i); };
  dv.setUint32(base, 1); dv.setUint32(base + 4, 2);
  put(0x08, 'MIX 2.5L'); put(0x21, '096619885718');
  dv.setUint32(base + 0xa4, 0x0000f800);
  b.set([20, 13, 6, 10, 0, 0, 36, 39, 33], base + 0xa4 + 4);
  dv.setUint32(base + 0xa4 + 16, 0x0000ffff);
  b.set([92, 33], base + 0x13c + 4 + 96);
  b.set([65, 32], base + 0x13c + 4 + 96 + 64);
  const p = base + 0x13c + 4 + 96 + 64 + 16 + 32;
  dv.setUint16(p, 2500); b[p + 2] = 50; b[p + 3] = 40; dv.setUint16(p + 4, 500); b[p + 8] = 50;
  dv.setUint32(base + 0x320, 0xffffffff);
  let o = base + 0x510;
  dv.setUint16(o + 0x0a, 1139); dv.setUint16(o + 0x0c, 50);
  b[o + 0x1a] = 38; b[o + 0x24] = 30; b[o + 0x25] = 1; dv.setUint16(o + 0x64, 990);
  o = base + 0x950;
  dv.setUint16(o + 0x0a, 11366); dv.setUint16(o + 0x0c, 50); dv.setUint16(o + 0x18, 40); b[o + 0x1a] = 1;
  put(0x978, 'PISTACHIO(DR)'); put(0x978 + 25, '100000086707');
  b.set([24, 7, 29, 1, 0, 12, 9, 38], base + 0xb18);
  return buf;
}

describe('headsOf', () => {
  it('prints masks the way the RCU does', () => {
    expect(headsOf(0x0000001f)).toBe('1-5');
    expect(headsOf(0x0000f800)).toBe('12-16');
    expect(headsOf(0xf8000000)).toBe('28-32');
    expect(headsOf(0x0000ffff)).toBe('');
    expect(headsOf(0b1010)).toBe('2,4');
  });
});

describe('parseRecord', () => {
  const r = parseRecord(new DataView(build()), RECORD, 1);

  it('reads the header, names and timestamp', () => {
    expect([r.no, r.name, r.code, r.modified]).toEqual([2, 'MIX 2.5L', '096619885718', '2024-07-29 12:09:38']);
    expect(r.sections[0].prodName).toBe('PISTACHIO(DR)');
    expect(r.sections[0].prodCode).toBe('100000086707');
  });

  it('reads heads, timing and weights', () => {
    const s = r.sections[0];
    expect(s.heads).toBe('12-16');
    expect(s.timing['WH-PH']).toBe(200);
    expect(s.timing['PH-RF']).toBe(130);
    expect([s.target, s.upper, s.autoFeedTarget, s.priority, s.goodEfficiency]).toEqual([113.9, 5, 3.8, 30, 99]);
    expect(r.sections[1].heads).toBe('');
    expect(r.total.target).toBe(1136.6);
    expect(r.total.speed).toBe(40);
  });

  it('reads the feeder sets', () => {
    expect(r.feeder.rf[0]).toEqual({ amp: 92, time: 33 });
    expect(r.feeder.df[0]).toEqual({ amp: 65, time: 32 });
    expect(r.feeder.dfInfeed[0].infeedWt).toBe(2500);
    expect(r.feeder.dfInfeed[0].afdStopLowerWt).toBe(50);
    expect(r.feederOptimum.written).toBe(false);
  });
});

describe('parsePresets', () => {
  it('returns only the named presets and refuses the wrong size', () => {
    const list = parsePresets(build());
    expect(list.map((p) => p.no)).toEqual([2]);
    expect(() => parsePresets(new ArrayBuffer(10))).toThrow(/expected/);
  });
});

describe('presetBlocks', () => {
  const blocks = presetBlocks(parsePresets(build())[0]);

  it('uses the mapped screens\' wording so values can be placed on them', () => {
    const product = blocks['Preset 2 Product'];
    expect(product.values['Target Weight']).toBe('1136.6 g');
    expect(product.values['Upper Weight Limit']).toBe('5.0 g');
    // one live section: its item settings sit at the top level
    expect(product.values['Auto Feed Target']).toBe('3.8');
    expect(product.values['Disch. Priority Count']).toBe('30');
    expect(blocks['Preset 2 Sections']).toBeUndefined();
    expect(blocks['Preset 2 Timing'].values['WH-PH']).toBe('200 ms');
    expect(blocks['Preset 2 Feeder'].groups.RF['RF 1 amplitude']).toBe('92');
    expect(blocks['Preset 2 Feeder optimum']).toBeUndefined();
  });

  it('marks the unproven readings so they show as check on the document', () => {
    const section = blockToSection(blocks['Preset 2 Product'], 'Preset 2 Product');
    const byLabel = Object.fromEntries(section.fields.map((f) => [f.label, f.confident]));
    expect(byLabel['Target Weight']).toBe(true);
    expect(byLabel['Speed?']).toBe(false);
    expect(byLabel['Extended Upper Limit?']).toBe(false);
  });
});

describe('blankPresetBlocks', () => {
  it('names every setting and leaves every value empty', () => {
    const blocks = blankPresetBlocks(14, 1);
    expect(Object.keys(blocks)).toEqual(['Preset Product', 'Preset Timing', 'Preset Feeder']);
    expect(blocks['Preset Product'].values['Target Weight']).toBe('');
    expect(Object.keys(blocks['Preset Feeder'].groups.RF)).toHaveLength(28);
  });

  it('adds a section block and per-section timing for a mix', () => {
    const blocks = blankPresetBlocks(32, 6);
    expect(Object.keys(blocks['Preset Sections'].groups)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    expect(blocks['Preset Timing'].groups.S6['WH-PH']).toBe('');
    expect(Object.keys(blocks['Preset Feeder'].groups.DF)).toHaveLength(12);
  });
});
