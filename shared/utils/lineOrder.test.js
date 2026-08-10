// The reorder screen writes the whole lines array back over the saved one, so
// the thing worth testing is not "does it move" but "does anything get lost".
// A dropped line takes its heads, issues, photos and span weights with it and
// still looks like a successful save.
import { describe, it, expect } from 'vitest';
import {
  moveLine, moveLineUp, moveLineDown, moveLineById,
  isSameLineSet, orderChanged, sortLinesNaturally,
} from './lineOrder.js';

const L = (id, title = `Line ${id}`) => ({ id, title, heads: [{ id: 1 }] });
const four = () => [L(1), L(2), L(3), L(4)];
const ids = (arr) => arr.map((l) => l.id);

describe('moveLine', () => {
  it('moves a line down and shifts the rest up', () => {
    expect(ids(moveLine(four(), 0, 2))).toEqual([2, 3, 1, 4]);
  });

  it('moves a line up', () => {
    expect(ids(moveLine(four(), 3, 1))).toEqual([1, 4, 2, 3]);
  });

  it('never loses or duplicates a line, wherever it goes', () => {
    const start = four();
    for (let from = 0; from < 4; from += 1) {
      for (let to = -2; to <= 6; to += 1) {
        const out = moveLine(start, from, to);
        expect(out).toHaveLength(4);
        expect(isSameLineSet(start, out)).toBe(true);
      }
    }
  });

  it('carries the whole line object, not just its name', () => {
    const rich = [{ id: 1, title: 'A', heads: [{ id: 1, issues: [{ type: 'Load cell' }] }] }, L(2)];
    const out = moveLine(rich, 0, 1);
    expect(out[1].heads[0].issues[0].type).toBe('Load cell');
  });

  it('clamps past either end rather than dropping the line', () => {
    expect(ids(moveLine(four(), 0, -5))).toEqual([1, 2, 3, 4]);
    expect(ids(moveLine(four(), 1, 99))).toEqual([1, 3, 4, 2]);
  });

  it('returns the same array when nothing moves, so no save is triggered', () => {
    const start = four();
    expect(moveLine(start, 2, 2)).toBe(start);
    expect(moveLine(start, 0, -1)).toBe(start);          // already first
    expect(moveLine(start, 3, 9)).toBe(start);           // already last
    expect(moveLine(start, 9, 0)).toBe(start);           // no such line
  });

  it('survives rubbish input', () => {
    expect(moveLine(null, 0, 1)).toEqual([]);
    expect(moveLine([], 0, 1)).toEqual([]);
  });
});

describe('moveLineUp / moveLineDown', () => {
  it('step one place', () => {
    expect(ids(moveLineUp(four(), 2))).toEqual([1, 3, 2, 4]);
    expect(ids(moveLineDown(four(), 0))).toEqual([2, 1, 3, 4]);
  });

  it('do nothing at the ends', () => {
    const start = four();
    expect(moveLineUp(start, 0)).toBe(start);
    expect(moveLineDown(start, 3)).toBe(start);
  });
});

describe('moveLineById', () => {
  it('moves the line with that id', () => {
    expect(ids(moveLineById(four(), 3, -1))).toEqual([1, 3, 2, 4]);
  });

  it('ignores an id that is not there', () => {
    const start = four();
    expect(moveLineById(start, 99, 1)).toBe(start);
  });
});

describe('isSameLineSet', () => {
  it('accepts a reordering', () => {
    expect(isSameLineSet(four(), [L(3), L(1), L(4), L(2)])).toBe(true);
  });

  it('rejects a line that went missing', () => {
    expect(isSameLineSet(four(), [L(1), L(2), L(3)])).toBe(false);
  });

  it('rejects a duplicated line', () => {
    expect(isSameLineSet(four(), [L(1), L(1), L(3), L(4)])).toBe(false);
  });

  it('rejects a line that was never there', () => {
    expect(isSameLineSet(four(), [L(1), L(2), L(3), L(9)])).toBe(false);
  });
});

describe('orderChanged', () => {
  it('is false for the same sequence and true for a different one', () => {
    expect(orderChanged(four(), four())).toBe(false);
    expect(orderChanged(four(), [L(2), L(1), L(3), L(4)])).toBe(true);
  });
});

describe('sortLinesNaturally', () => {
  it('puts Line 2 before Line 10, which a plain sort does not', () => {
    const out = sortLinesNaturally([L(1, 'Line 10'), L(2, 'Line 2'), L(3, 'Line 1')]);
    expect(out.map((l) => l.title)).toEqual(['Line 1', 'Line 2', 'Line 10']);
  });

  it('handles the real naming on the floor', () => {
    const out = sortLinesNaturally([L(1, 'PPI-12'), L(2, 'PPI-3'), L(3, 'Can Line'), L(4, 'H-2')]);
    expect(out.map((l) => l.title)).toEqual(['Can Line', 'H-2', 'PPI-3', 'PPI-12']);
  });

  it('does not mutate what it was given', () => {
    const start = [L(1, 'B'), L(2, 'A')];
    sortLinesNaturally(start);
    expect(start.map((l) => l.title)).toEqual(['B', 'A']);
  });
});
