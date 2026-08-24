// Ordering a customer's work. The number is the year and the job's place in it,
// so it is the only field that reliably says which came last.
import { describe, it, expect } from 'vitest';
import { srKey, byNewestSr } from './srOrder.js';

describe('reading an SR number as a position in time', () => {
  it('reads year and sequence', () => {
    expect(srKey('2026029')).toBe(2026029);
    expect(srKey('2024008')).toBe(2024008);
  });

  it('does not care how it was written', () => {
    expect(srKey('2026-029')).toBe(2026029);
    expect(srKey(' sr2026029 ')).toBe(2026029);
    expect(srKey(2026029)).toBe(2026029);
  });

  it('sorts by the number, not the text', () => {
    // '2026009' vs '202610' as strings puts them the wrong way round.
    expect(srKey('2026009')).toBeLessThan(srKey('2026010'));
  });

  it('refuses things that are not job numbers', () => {
    expect(srKey('000-052-3359-08')).toBeNull();
    expect(srKey('Line 2')).toBeNull();
    expect(srKey('')).toBeNull();
    expect(srKey(null)).toBeNull();
    // Seven digits, but not a year anybody worked in.
    expect(srKey('1234567')).toBeNull();
  });
});

describe('newest first', () => {
  const sr = (x) => x.sr;
  const date = (x) => x.date;
  const sorted = (list) => [...list].sort(byNewestSr(sr, date)).map((x) => x.sr || x.date);

  it('puts the highest number first, across years', () => {
    expect(sorted([{ sr: '2024008' }, { sr: '2026029' }, { sr: '2026002' }, { sr: '2024034' }]))
      .toEqual(['2026029', '2026002', '2024034', '2024008']);
  });

  it('falls back to the date when neither has a number', () => {
    expect(sorted([{ date: '2024-02-20' }, { date: '2026-05-11' }]))
      .toEqual(['2026-05-11', '2024-02-20']);
  });

  it('keeps an unnumbered record in date order among the numbered ones', () => {
    // A job created this morning has no number on it yet and is the newest
    // thing there is — dropping it to the bottom is how it gets forgotten.
    const out = [...[
      { sr: '2024008', date: '2024-02-20' },
      { date: '2026-08-22' },
      { sr: '2026002', date: '2026-01-09' },
    ]].sort(byNewestSr(sr, date));
    expect(out[0].date).toBe('2026-08-22');
  });

  it('handles a Firestore timestamp', () => {
    const ts = { toDate: () => new Date('2026-05-11') };
    const out = [{ date: '2024-01-01' }, { date: ts }].sort(byNewestSr(sr, date));
    expect(out[0].date).toBe(ts);
  });

  it('is stable enough not to throw on junk', () => {
    expect(() => [{ }, { sr: null }, { date: 'nonsense' }].sort(byNewestSr(sr, date))).not.toThrow();
  });
});
