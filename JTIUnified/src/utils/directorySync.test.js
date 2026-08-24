// The check that decides whether to republish. Wrong in one direction it costs
// a few hundred writes on every page load; wrong in the other it leaves a job
// number the Timesheet and CCW cannot see, which is the bug it exists to fix.
import { describe, it, expect } from 'vitest';
import { openJobIndex, copyIsStale } from './directorySync.js';

const job = (sr, customer, over = {}) => ({ sr, customer, ...over });
const published = (pairs) => pairs.map(([id, fingerprint]) => ({ id, fingerprint }));

describe('what ought to be published', () => {
  it('is every open job, by number', () => {
    const want = openJobIndex([job('2026029', 'Trident Seafood'), job('2026030', 'National Frozen')]);
    expect([...want.keys()]).toEqual(['2026029', '2026030']);
  });

  it('leaves out closed numbers — they are spoken for, not offerable', () => {
    const want = openJobIndex([job('2026029', 'Trident Seafood'), job('2026001', 'Shearers', { closedAt: '2026-08-01' })]);
    expect([...want.keys()]).toEqual(['2026029']);
  });

  it('ignores a job with no number at all', () => {
    expect(openJobIndex([job('', 'Nobody'), job('   ', 'Nobody')]).size).toBe(0);
  });
});

describe('deciding whether to republish', () => {
  const want = openJobIndex([job('2026029', 'Trident Seafood'), job('2026030', 'National Frozen')]);

  it('does nothing when the copy already matches', () => {
    expect(copyIsStale(published([['2026029', 'Trident Seafood'], ['2026030', 'National Frozen']]), want)).toBe(false);
  });

  it('republishes when a number created in the Jobs app never arrived', () => {
    expect(copyIsStale(published([['2026029', 'Trident Seafood']]), want)).toBe(true);
  });

  it('republishes when a closed number is still sitting in the other app', () => {
    const stillThere = published([['2026029', 'Trident Seafood'], ['2026030', 'National Frozen'], ['2026001', 'Shearers']]);
    expect(copyIsStale(stillThere, want)).toBe(true);
  });

  it('republishes when a job was re-pointed at a different plant', () => {
    const wrongName = published([['2026029', 'Trident Seafoods'], ['2026030', 'National Frozen']]);
    expect(copyIsStale(wrongName, want)).toBe(true);
  });

  it('treats an empty copy as stale rather than as nothing to do', () => {
    expect(copyIsStale([], want)).toBe(true);
  });

  it('is content with two empty sides — a fresh install publishes nothing', () => {
    expect(copyIsStale([], new Map())).toBe(false);
  });
});

describe('a fingerprint wider than the customer', () => {
  // The timesheet's copy carries the quoted figure too. Connecting a quote to a
  // job changes nothing else about it, so a check that only compared names
  // would leave the timesheet budgeting against a stale number for good.
  const withQuote = (j) => `${j.customer}|${j.quoteTotal || 0}`;
  const started = [job('2026029', 'Trident Seafood', { quoteTotal: 7916 })];
  const want = openJobIndex(started, withQuote);

  it('is content when the published figure matches', () => {
    expect(copyIsStale(published([['2026029', 'Trident Seafood|7916']]), want)).toBe(false);
  });

  it('republishes when a quote has just been connected', () => {
    expect(copyIsStale(published([['2026029', 'Trident Seafood|0']]), want)).toBe(true);
  });

  it('republishes when the quote was revised', () => {
    expect(copyIsStale(published([['2026029', 'Trident Seafood|6200']]), want)).toBe(true);
  });
});
