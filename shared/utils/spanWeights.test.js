import { describe, it, expect } from 'vitest';
import { spanDiff, headRecord, hasAfterReadings, testWeightOf } from './spanWeights.js';

describe('spanDiff', () => {
  it('is what the span moved, after minus before', () => {
    expect(spanDiff(199.8, 200)).toBe(0.2);
    expect(spanDiff(200.1, 200)).toBe(-0.1);
    expect(spanDiff(200, 200)).toBe(0);
  });

  it('has no answer until both readings exist', () => {
    // 0.0 would claim the span moved nothing, which is not the same as "not read".
    expect(spanDiff(199.8, '')).toBeNull();
    expect(spanDiff('', 200)).toBeNull();
    expect(spanDiff(null, undefined)).toBeNull();
    expect(spanDiff(199.8, 'abc')).toBeNull();
  });

  it('treats a zero reading as a reading', () => {
    expect(spanDiff(0, 200)).toBe(200);
    expect(spanDiff(199.8, 0)).toBe(-199.8);
  });

  it('rounds to the resolution the screen reports', () => {
    expect(spanDiff(199.84, 200.01)).toBe(0.2);
  });
});

describe('headRecord', () => {
  it('keeps the old fields meaning exactly what they meant', () => {
    // Every entry already in the log is read with these names.
    const r = headRecord({ head: 3, currentWeight: 199.8, spanWeight: 200 });
    expect(r).toEqual({ head: 3, currentWeight: 199.8, spanWeight: 200, difference: 0.2 });
  });

  it('adds the after reading and what it moved', () => {
    const r = headRecord({ head: 1, currentWeight: 200.1, afterWeight: 200, spanWeight: 200 });
    expect(r.afterWeight).toBe(200);
    expect(r.afterDifference).toBe(-0.1);
    expect(r.difference).toBe(-0.1); // unchanged meaning: target - before
  });

  it('omits the after fields entirely when nobody took the second reading', () => {
    // Their absence is how an old entry is told from a new one.
    const r = headRecord({ head: 1, currentWeight: 199.8, afterWeight: '', spanWeight: 200 });
    expect('afterWeight' in r).toBe(false);
    expect('afterDifference' in r).toBe(false);
  });
});

describe('hasAfterReadings', () => {
  it('is false for everything written before this change', () => {
    expect(hasAfterReadings([{ head: 1, currentWeight: 199.8, spanWeight: 200, difference: 0.2 }])).toBe(false);
    expect(hasAfterReadings([])).toBe(false);
    expect(hasAfterReadings()).toBe(false);
  });

  it('is true as soon as one head was read after', () => {
    expect(hasAfterReadings([
      { head: 1, currentWeight: 199.8 },
      { head: 2, currentWeight: 200.1, afterWeight: 200 },
    ])).toBe(true);
  });

  it('counts a genuine zero', () => {
    expect(hasAfterReadings([{ head: 1, afterWeight: 0 }])).toBe(true);
  });
});

describe('testWeightOf', () => {
  it('reads the weight off whichever head carries it', () => {
    expect(testWeightOf([{ head: 1 }, { head: 2, spanWeight: 200 }])).toBe(200);
  });
  it('is null when no head was given one', () => {
    expect(testWeightOf([{ head: 1 }])).toBeNull();
    expect(testWeightOf([])).toBeNull();
  });
});
