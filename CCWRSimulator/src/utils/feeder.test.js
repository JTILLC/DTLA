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
  it('moves only the lit parameter', () => {
    const s = start();                       // Time lit, AMP dark
    const { state, changed } = adjust(s, spec, +1);
    expect(changed).toEqual(['time']);
    expect(state.rf[1].time).toBe(25.5);
    expect(state.rf[1].amp).toBe(50);        // untouched
  });

  it('moves every selected head, and no others', () => {
    let s = toggleHead(start(), 7);          // heads 1 and 7
    const { state } = adjust(s, spec, +1);
    expect(state.rf[1].time).toBe(25.5);
    expect(state.rf[7].time).toBe(25.5);
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
    expect(state.df.time).toBe(25.5);
    expect(state.rf[1].time).toBe(25);       // RF untouched
  });

  it('keeps one decimal place, so the readout cannot drift', () => {
    let s = start();
    for (let i = 0; i < 3; i += 1) s = adjust(s, spec, +1).state;
    expect(s.rf[1].time).toBe(26.5);
  });
});

describe('shownValues', () => {
  it('reads the selected head', () => {
    const { state } = adjust(start(), spec, +1);
    expect(shownValues(state).time).toBe(25.5);
  });

  it('refuses to show one head\'s number for a mixed selection', () => {
    // Move head 1 only, then select head 2 as well: the two now disagree, and
    // showing 25.5 would claim both are at it.
    let s = adjust(start(), spec, +1).state;
    s = toggleHead(s, 2);
    expect(shownValues(s).time).toBeNull();
    expect(formatValue(shownValues(s).time)).toBe('– –');
  });

  it('shows DF values when DF is the selected feeder', () => {
    const s = selectFeeder(start(), 'df');
    expect(shownValues(s)).toEqual({ time: 25, amp: 50 });
  });
});
