import { describe, it, expect } from 'vitest';
import navmap from '../data/navmap.json';
import {
  initialFeeder, toggleHead, toggleParam, selectFeeder, adjust, shownValues, formatValue,
} from './feeder';

const spec = navmap.feederAdjust;
const start = () => initialFeeder(spec);

describe('the map', () => {
  it('has all fourteen heads, evenly spaced and inside the canvas', () => {
    expect(spec.heads).toHaveLength(14);
    expect(spec.heads.map((h) => h.no)).toEqual([...Array(14)].map((_, i) => i + 1));
    const gaps = spec.heads.slice(1).map((h, i) => h.x - spec.heads[i].x);
    expect(new Set(gaps).size).toBe(1);
    for (const h of spec.heads) {
      expect(h.x + h.w).toBeLessThanOrEqual(navmap.canvas.w);
      expect(h.y + h.h).toBeLessThanOrEqual(navmap.canvas.h);
    }
  });
});

describe('selection', () => {
  it('starts on RF with head 1 and the Time lamp lit', () => {
    const s = start();
    expect(s.feeder).toBe('rf');
    expect(s.heads).toEqual([1]);
    expect(s.params.time).toBe(true);
  });

  it('selects more than one head, which the manual allows', () => {
    let s = start();
    s = toggleHead(s, 5);
    s = toggleHead(s, 3);
    expect(s.heads).toEqual([1, 3, 5]);
  });

  it('deselects a head that is pressed again', () => {
    let s = toggleHead(start(), 5);
    s = toggleHead(s, 5);
    expect(s.heads).toEqual([1]);
  });

  it('lights Time and AMP together', () => {
    const s = toggleParam(start(), 'amp');
    expect(s.params).toEqual({ time: true, amp: true });
  });
});

describe('adjust', () => {
  it('moves only the lit parameter, by the 1.0 counted on the original', () => {
    const s = start();                       // Time lit, AMP dark
    const { state, changed } = adjust(s, spec, +1);
    expect(changed).toEqual(['time']);
    expect(state.rf[1].time).toBe(26);
    expect(state.rf[1].amp).toBe(50);        // untouched
  });

  it('moves every selected head, and no others', () => {
    let s = toggleHead(start(), 7);          // heads 1 and 7
    const { state } = adjust(s, spec, +1);
    expect(state.rf[1].time).toBe(26);
    expect(state.rf[7].time).toBe(26);
    expect(state.rf[2].time).toBe(25);
  });

  it('decreases, and never below zero', () => {
    let s = start();
    for (let i = 0; i < 200; i += 1) s = adjust(s, spec, -1).state;
    expect(s.rf[1].time).toBe(0);
  });

  it('does nothing with no lamp lit — lighting one is step 2 of the procedure', () => {
    const s = toggleParam(start(), 'time');  // both dark now
    const { changed, reason } = adjust(s, spec, +1);
    expect(changed).toEqual([]);
    expect(reason).toBe('no-param');
  });

  it('does nothing on RF with no head selected', () => {
    const s = toggleHead(start(), 1);        // clears the only selection
    const { changed, reason } = adjust(s, spec, +1);
    expect(changed).toEqual([]);
    expect(reason).toBe('no-head');
  });

  it('adjusts DF without needing a head — there is only one dispersion feeder', () => {
    const s = selectFeeder(toggleHead(start(), 1), 'df');   // no heads selected
    const { state, reason } = adjust(s, spec, +1);
    expect(reason).toBeNull();
    expect(state.df.time).toBe(26);
    expect(state.rf[1].time).toBe(25);       // RF untouched
  });

  it('keeps one decimal place, so the readout cannot drift', () => {
    let s = start();
    for (let i = 0; i < 3; i += 1) s = adjust(s, spec, +1).state;
    expect(s.rf[1].time).toBe(28);
  });
});

describe('shownValues', () => {
  it('reads the selected head', () => {
    const { state } = adjust(start(), spec, +1);
    expect(shownValues(state).time).toBe(26);
  });

  it('averages a mixed selection, as the original does', () => {
    // Counted on the running original: head 1 at 26.0 and head 2 at 25.0, both
    // selected, reads 25.5.
    let s = adjust(start(), spec, +1).state;
    s = toggleHead(s, 2);
    expect(shownValues(s).time).toBe(25.5);
  });

  it('shows nothing for a parameter whose lamp is off', () => {
    const s = start();                       // AMP dark
    expect(shownValues(s).amp).toBeNull();
    expect(formatValue(shownValues(s).amp)).toBe('');
  });

  it('gives the value straight back when the lamp is lit again', () => {
    let s = adjust(toggleParam(start(), 'amp'), spec, +1).state;   // both lit
    expect(shownValues(s).amp).toBe(51);
    s = toggleParam(s, 'amp');               // off: blank
    expect(shownValues(s).amp).toBeNull();
    s = toggleParam(s, 'amp');               // on again: 51.0, not lost
    expect(shownValues(s).amp).toBe(51);
  });

  it('shows DF values when DF is the selected feeder', () => {
    const s = toggleParam(selectFeeder(start(), 'df'), 'amp');
    expect(shownValues(s)).toEqual({ time: 25, amp: 50 });
  });
});

describe('the radar chart', () => {
  const chart = spec.screens['run-feeder'].chart;

  it('is mapped, so the ring and the trace can be drawn', () => {
    expect(chart.segments).toBe(14);
    expect(chart.centre).toHaveLength(2);
    expect(chart.rFull).toBeGreaterThan(0);
  });

  it('puts the default amplitude where the capture had its trace', () => {
    // Every head reads 50.0 out of the box and the capture's magenta trace sat
    // at r=61. If the scale ever drifts, the drawn trace stops matching the
    // artwork it is drawn over.
    const r = (spec.defaults.amp / 100) * chart.rFull;
    expect(Math.round(r)).toBe(60);
  });

  it('lays segment 1 where the artwork prints its "1"', () => {
    // Not at the bottom, as it looks: measured off the segment that was filled
    // blue in the capture.
    expect(chart.seg1Centre).toBeCloseTo(77.1, 1);
  });
});

describe('Read Default', () => {
  it('puts every head and the dispersion feeder back to the defaults', async () => {
    const { readDefault } = await import('./feeder');
    let s = { ...start(), heads: [1, 2], params: { time: true, amp: true } };
    s = adjust(s, spec, +1).state;
    s = adjust(s, spec, +1).state;
    s = adjust(selectFeeder(s, 'df'), spec, -1).state;
    expect(s.rf[1].time).not.toBe(spec.defaults.time);
    expect(s.df.amp).not.toBe(spec.defaults.amp);

    const d = readDefault(s, spec);
    for (const h of spec.heads) expect(d.rf[h.no]).toEqual(spec.defaults);
    expect(d.df).toEqual(spec.defaults);
    // Selection and lamps are not values: they stay.
    expect(d.heads).toEqual([1, 2]);
    expect(d.params).toEqual({ time: true, amp: true });
    expect(d.feeder).toBe('df');
  });
});
