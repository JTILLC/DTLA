// The comparison that decides whether a visit changed. Getting it wrong in the
// loose direction means announcing edits nobody made, mid-audit, on a phone.
import { describe, it, expect } from 'vitest';
import { stableStringify } from './stableJson.js';

describe('comparing two copies of the same thing', () => {
  it('ignores the order the keys were written in', () => {
    // A local object keeps insertion order; the copy that has been to Firestore
    // and back does not.
    expect(stableStringify({ title: 'Line 1', heads: [1, 2] }))
      .toBe(stableStringify({ heads: [1, 2], title: 'Line 1' }));
  });

  it('sorts keys inside arrays and nested objects too', () => {
    const a = { lines: [{ id: 1, notes: 'x', heads: [{ status: 'offline', id: 3 }] }] };
    const b = { lines: [{ notes: 'x', heads: [{ id: 3, status: 'offline' }], id: 1 }] };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('still sees a real difference', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify({ heads: [1, 2] })).not.toBe(stableStringify({ heads: [2, 1] }));
    // Order in an ARRAY is content — lines and heads are ordered.
  });

  it('does not confuse a missing key with an empty one', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 1, b: '' }));
  });

  it('handles the plain values a visit is made of', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify([])).toBe('[]');
    expect(stableStringify({ n: 0, s: '', b: false })).toBe('{"b":false,"n":0,"s":""}');
  });
});
