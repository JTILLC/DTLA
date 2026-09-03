import { describe, it, expect } from 'vitest';
import navmap from '../data/navmap.json';
import { initialTiming, migrateTiming, selectRow, step, enter, bar } from './timing';

const spec = navmap.timingAdjust;
const layout = spec.screens['preset-timing'].bar;

describe('timing adjustment', () => {
  it('opens on WH-DS with the captured values', () => {
    const t = initialTiming(spec);
    expect(t.sel).toBe('wh_ds');
    expect(t.values).toEqual({ wh_ds: 110, is_wh: 0, wh_ph: 200, ph_rf: 150, stagger: 0, wh_on: 450, ph_on: 400 });
  });

  it('single arrows move 10, double arrows 100, on the selected row only', () => {
    let t = selectRow(initialTiming(spec), 'ph_rf');
    t = step(t, spec, +10).state;
    expect(t.values.ph_rf).toBe(160);
    t = step(t, spec, +100).state;
    expect(t.values.ph_rf).toBe(260);      // seen: 150 -> 160 -> 260
    expect(t.values.wh_ds).toBe(110);
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
    expect(enter(t, spec, '1105').state.values.wh_ds).toBe(1105);   // seen on the program
    expect(enter(t, spec, '0')).toMatchObject({ reason: 'clamped', state: { values: { wh_ds: 1 } } });
    expect(enter(t, spec, '')).toMatchObject({ reason: 'empty' });
  });

  it('bars are a timeline: the PH rows start where WH-PH ends, and none leaves the column', () => {
    const t = initialTiming(spec);
    expect(bar(t, spec, layout, 'wh_ds').x).toBe(layout.x);
    expect(bar(t, spec, layout, 'ph_rf').x).toBeCloseTo(layout.x + 200 * layout.pxPerMs);
    let big = t;
    for (const k of Object.keys(t.values)) big = { ...big, values: { ...big.values, [k]: 2550 } };
    const b = bar(big, spec, layout, 'ph_on');
    expect(b.x + b.w).toBeLessThanOrEqual(layout.max);
  });

  it('an old save comes back whole', () => {
    const m = migrateTiming({ sel: 'nope', values: { wh_ds: 300 } }, spec);
    expect(m.sel).toBe('wh_ds');
    expect(m.values.wh_ds).toBe(300);
    expect(m.values.ph_on).toBe(400);
  });
});
