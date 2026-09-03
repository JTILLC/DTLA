import { describe, it, expect } from 'vitest';
import navmap from '../data/navmap.json';
import {
  initialTiming, migrateTiming, selectRow, setSection, setDthPick, ensureVisible,
  visibleRows, hasSections, valueKey, rowLabel, rowOf, current, step, enter, bar,
} from './timing';

const spec = navmap.timingAdjust;
const layout = spec.screens['preset-timing'].bar;
const plain = { bh: false, th: false, dth: false };
const full = { bh: true, th: true, dth: true };

describe('timing adjustment', () => {
  it('opens on IS-DS with the values read off the running machine', () => {
    const t = initialTiming(spec);
    expect(t.sel).toBe('is_ds');
    expect(t.section).toBe(1);
    expect(t.values).toMatchObject({
      is_ds: 0, is_wh: 100, wh_ph: 350, ph_rf: 180, stagger: 0, wh_bh: 300, bh_wh: 200,
      wh_on: 450, bh_on: 450, ph_on: 500, is_th1: 0, is_th2: 0, is_dth1: 820, is_dth4: 820,
    });
  });

  it('a plain machine shows the seven rows the program has; the options add theirs', () => {
    expect(visibleRows(spec, plain).map((r) => r.label))
      .toEqual(['IS-DS', 'IS-WH', 'WH-PH', 'PH-RF', 'STAGGER', 'WH ON', 'PH ON']);
    expect(visibleRows(spec, full).map((r) => r.label)).toEqual([
      'IS-DS', 'IS-TH{n}', 'IS-DTH{n}', 'IS-WH', 'WH-PH', 'PH-RF', 'STAGGER', 'WH-BH', 'BH-WH', 'WH ON', 'BH ON', 'PH ON',
    ]);
    expect(hasSections(plain)).toBe(false);
    expect(hasSections({ ...plain, th: true })).toBe(true);
    expect(hasSections({ ...plain, dth: true })).toBe(true);
  });

  it('C1 adjusts TH1 and owns DTH1 and DTH2; C2 adjusts TH2 and owns DTH3 and DTH4', () => {
    let t = selectRow(initialTiming(spec), 'is_th');
    const th = rowOf(spec, 'is_th');
    const dth = rowOf(spec, 'is_dth');
    expect(rowLabel(th, t)).toBe('IS-TH1');
    expect(valueKey(th, t)).toBe('is_th1');
    t = setSection(t, 2);
    expect(rowLabel(th, t)).toBe('IS-TH2');
    expect(rowLabel(dth, t)).toBe('IS-DTH3');
    t = setDthPick(t, 1);
    expect(rowLabel(dth, t)).toBe('IS-DTH4');
    t = setSection(t, 1);
    expect(rowLabel(dth, t)).toBe('IS-DTH2');
    // and the numbers stay separate
    t = selectRow(t, 'is_dth');
    t = step(t, spec, +100).state;
    expect(t.values.is_dth2).toBe(920);
    expect(t.values.is_dth1).toBe(820);
    expect(t.values.is_dth4).toBe(820);
  });

  it('single arrows move 10, double arrows 100, on the selected row only', () => {
    let t = selectRow(initialTiming(spec), 'ph_rf');
    t = step(t, spec, +10).state;
    expect(t.values.ph_rf).toBe(190);
    t = step(t, spec, +100).state;
    expect(t.values.ph_rf).toBe(290);
    expect(t.values.is_wh).toBe(100);
  });

  it('a row at 0 stays at 0, and nothing passes 2550', () => {
    let t = selectRow(initialTiming(spec), 'stagger');
    const r = step(t, spec, -10);
    expect(r.state.values.stagger).toBe(0);
    expect(r.changed).toBe(0);
    t = selectRow(t, 'wh_on');
    for (let i = 0; i < 30; i += 1) t = step(t, spec, +100).state;
    expect(t.values.wh_on).toBe(2550);
  });

  it('the Entr keypad writes into the selected row, held to 1..2550', () => {
    const t = initialTiming(spec);
    expect(enter(t, spec, '1105').state.values.is_ds).toBe(1105);
    expect(enter(t, spec, '0')).toMatchObject({ reason: 'clamped', state: { values: { is_ds: 1 } } });
    expect(enter(t, spec, '')).toMatchObject({ reason: 'empty' });
    expect(current(enter(t, spec, '1105').state, spec)).toBe(1105);
  });

  it('bars are a timeline of delays, as on the running machine', () => {
    const t = initialTiming(spec);
    const at = (key) => bar(t, spec, layout, rowOf(spec, key)).x - layout.x;
    expect(at('is_wh')).toBe(0);
    expect(at('wh_ph')).toBeCloseTo(100 * layout.pxPerMs);          // starts when IS-WH ends
    expect(at('ph_rf')).toBeCloseTo(450 * layout.pxPerMs);          // when WH-PH ends
    expect(at('wh_bh')).toBeCloseTo(100 * layout.pxPerMs);
    expect(at('bh_wh')).toBeCloseTo(400 * layout.pxPerMs);          // when WH-BH ends
    expect(at('bh_on')).toBeCloseTo(400 * layout.pxPerMs);
    expect(at('ph_on')).toBeCloseTo(450 * layout.pxPerMs);
    expect(at('is_ds')).toBe(0);
    // Raising IS-WH slides every later bar right.
    const later = { ...t, values: { ...t.values, is_wh: 300 } };
    expect(bar(later, spec, layout, rowOf(spec, 'ph_on')).x - layout.x).toBeCloseTo(650 * layout.pxPerMs);
    // Nothing leaves the column.
    let big = t;
    for (const k of Object.keys(t.values)) big = { ...big, values: { ...big.values, [k]: 2550 } };
    const b = bar(big, spec, layout, rowOf(spec, 'ph_on'));
    expect(b.x + b.w).toBeLessThanOrEqual(layout.max);
  });

  it('a row the machine no longer has cannot stay selected, and an old save comes back whole', () => {
    const t = selectRow(initialTiming(spec), 'bh_on');
    expect(ensureVisible(t, spec, full).sel).toBe('bh_on');
    expect(ensureVisible(t, spec, plain).sel).toBe('is_ds');
    const m = migrateTiming({ sel: 'wh_ds', section: 2, values: { wh_ds: 110, is_wh: 250 } }, spec);
    expect(m.sel).toBe('is_ds');
    expect(m.section).toBe(2);
    expect(m.values.is_wh).toBe(250);
    expect(m.values.ph_on).toBe(500);
  });
});
