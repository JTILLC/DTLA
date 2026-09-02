import { describe, it, expect } from 'vitest';
import {
  initialPans, togglePan, toggleTable, selectAllHeads, selectTable,
  litLabels, describe as describeSel, nothingSelected, PAN_COUNT,
} from './panSelect';

describe('opening state', () => {
  it('opens with all 14 hoppers selected and the pan not', () => {
    const s = initialPans();
    expect(s.heads).toHaveLength(PAN_COUNT);
    expect(s.table).toBe(false);
  });
});

describe('individual pans', () => {
  it('deselects one hopper, leaving the rest', () => {
    const s = togglePan(initialPans(), 7);
    expect(s.heads).toHaveLength(13);
    expect(s.heads).not.toContain(7);
  });

  it('selects a single hopper from nothing', () => {
    let s = { heads: [], table: false };
    s = togglePan(s, 9);
    expect(s.heads).toEqual([9]);
  });

  it('keeps hopper numbers in order however they were tapped', () => {
    let s = { heads: [], table: false };
    s = togglePan(s, 11); s = togglePan(s, 2); s = togglePan(s, 7);
    expect(s.heads).toEqual([2, 7, 11]);
  });
});

describe('the pan and the hoppers are never both selected', () => {
  it('tapping the dispersion pan clears every hopper', () => {
    const s = toggleTable(initialPans());
    expect(s.table).toBe(true);
    expect(s.heads).toEqual([]);
  });

  it('tapping a hopper clears the dispersion pan', () => {
    const s = togglePan({ heads: [], table: true }, 4);
    expect(s.table).toBe(false);
    expect(s.heads).toEqual([4]);
  });

  it('Slct All WH clears the pan', () => {
    const s = selectAllHeads({ heads: [], table: true });
    expect(s.table).toBe(false);
    expect(s.heads).toHaveLength(PAN_COUNT);
  });

  it('Slct All DF clears the hoppers', () => {
    const s = selectTable(initialPans());
    expect(s.table).toBe(true);
    expect(s.heads).toEqual([]);
  });
});

describe('Slct All WH pressed twice', () => {
  it('clears the ring when everything was already selected', () => {
    const s = selectAllHeads(initialPans());
    expect(s.heads).toEqual([]);
  });

  it('selects the whole ring from a partial selection', () => {
    const s = selectAllHeads({ heads: [3, 4], table: false });
    expect(s.heads).toHaveLength(PAN_COUNT);
  });
});

describe('litLabels', () => {
  it('lights the selected hoppers', () => {
    expect(litLabels({ heads: [2, 5], table: false }, 15)).toEqual([2, 5]);
  });

  it('lights only the table label when the pan is selected', () => {
    expect(litLabels({ heads: [], table: true }, 15)).toEqual([15]);
  });
});

describe('describe', () => {
  it('names what Start would act on', () => {
    expect(describeSel(initialPans())).toBe('all 14 weigh hoppers');
    expect(describeSel({ heads: [6], table: false })).toBe('weigh hopper 6');
    expect(describeSel({ heads: [1, 2], table: false })).toBe('weigh hoppers 1, 2');
    expect(describeSel({ heads: [], table: true })).toBe('the dispersion table');
    expect(describeSel({ heads: [], table: false })).toBe('nothing');
  });

  it('knows when nothing is selected', () => {
    expect(nothingSelected({ heads: [], table: false })).toBe(true);
    expect(nothingSelected({ heads: [1], table: false })).toBe(false);
    expect(nothingSelected({ heads: [], table: true })).toBe(false);
  });
});
