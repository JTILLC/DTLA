// Reserving a number pushes it into three other apps and it can never be
// quietly reused, so the record has to be coherent before it goes out.
import { describe, it, expect } from 'vitest';
import { normalizeDraft, draftProblems, describeRange } from './jobDraft.js';

const ok = { sr: '2026029', customer: 'Flagstone Foods', dateStart: '2026-08-17' };

describe('normalizeDraft', () => {
  it('trims everything and upper-cases what is a code', () => {
    const d = normalizeDraft({ sr: ' 2026029 ', customer: '  Flagstone Foods ', state: 'az', city: ' Robersonville ' });
    expect(d.sr).toBe('2026029');
    expect(d.customer).toBe('Flagstone Foods');
    expect(d.state).toBe('AZ');
    expect(d.city).toBe('Robersonville');
  });

  it('keeps `date` in step with the start date', () => {
    // The timesheet app, CCW and the packet page all read `date` already; a
    // field that quietly changed meaning would break them silently.
    expect(normalizeDraft({ ...ok }).date).toBe('2026-08-17');
  });

  it('drops an end date equal to the start — that is a one-day job', () => {
    expect(normalizeDraft({ ...ok, dateEnd: '2026-08-17' }).dateEnd).toBe('');
  });

  it('keeps a real range', () => {
    expect(normalizeDraft({ ...ok, dateEnd: '2026-08-19' }).dateEnd).toBe('2026-08-19');
  });

  it('survives an empty draft', () => {
    expect(() => normalizeDraft()).not.toThrow();
    expect(normalizeDraft().customer).toBe('');
  });
});

describe('draftProblems', () => {
  it('passes a good draft', () => {
    expect(draftProblems(ok)).toEqual([]);
  });

  it('insists on a customer — the number is useless without one', () => {
    expect(draftProblems({ ...ok, customer: '   ' })).toContain('Which customer is this for?');
  });

  it('rejects an end date before the start', () => {
    const p = draftProblems({ ...ok, dateStart: '2026-08-17', dateEnd: '2026-08-12' });
    expect(p).toContain('The end date is before the start date.');
  });

  it('accepts a range that ends the same day', () => {
    expect(draftProblems({ ...ok, dateEnd: '2026-08-17' })).toEqual([]);
  });

  it('rejects a number that is not a service report number', () => {
    expect(draftProblems({ ...ok, sr: 'ABC' })[0]).toMatch(/not a service report number/);
  });

  it('rejects a state that is not two letters', () => {
    expect(draftProblems({ ...ok, state: 'Arizona' })).toContain('State should be two letters, like AZ.');
    expect(draftProblems({ ...ok, state: 'AZ' })).toEqual([]);
  });

  it('reports every problem at once, not one at a time', () => {
    const p = draftProblems({ sr: '', customer: '', dateStart: '2026-08-17', dateEnd: '2026-08-01' });
    expect(p.length).toBeGreaterThanOrEqual(3);
  });

  it('does not complain about a blank address — that is normal', () => {
    expect(draftProblems({ ...ok, address: '', city: '', state: '' })).toEqual([]);
  });
});

describe('describeRange', () => {
  it('reads as a range or a single day', () => {
    expect(describeRange({ ...ok, dateEnd: '2026-08-19' })).toBe('2026-08-17 → 2026-08-19');
    expect(describeRange(ok)).toBe('2026-08-17');
    expect(describeRange({})).toBe('');
  });
});
