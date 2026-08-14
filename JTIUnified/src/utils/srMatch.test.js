// Joining a job to its service report number across four systems that each
// write the number slightly differently.
import { describe, it, expect } from 'vitest';
import { normalizeSr, findJobsForSr } from './srMatch.js';

describe('normalizeSr', () => {
  it('ignores the formatting differences between systems', () => {
    ['2026028', '2026-028', ' 2026028 ', '2026 028'].forEach((v) => {
      expect(normalizeSr(v)).toBe('2026028');
    });
  });

  it('upper-cases suffixed follow-up visits', () => {
    expect(normalizeSr('2026014lf1')).toBe('2026014LF1');
  });

  it('says nothing about nothing', () => {
    expect(normalizeSr('')).toBe('');
    expect(normalizeSr(null)).toBe('');
  });
});

describe('findJobsForSr', () => {
  const jobs = [
    { sr: '2026028', customer: 'SunTree' },
    { sr: '2026-018', customer: 'Flagstone' },
    { sr: '', invoiceNumber: '2026024', customer: 'Oasis Date' },
    { sr: '2026028', customer: 'SunTree', invoiceDate: '2026-08-02' },
    { customer: 'no number at all' },
  ];

  it('matches across formatting', () => {
    expect(findJobsForSr(jobs, '2026 018').map((j) => j.customer)).toEqual(['Flagstone']);
  });

  it('falls back to the invoice number, which is the same number here', () => {
    expect(findJobsForSr(jobs, '2026024').map((j) => j.customer)).toEqual(['Oasis Date']);
  });

  it('returns BOTH when a number legitimately appears twice', () => {
    // A job split across two invoices. Showing only the first would hide money.
    expect(findJobsForSr(jobs, '2026028')).toHaveLength(2);
  });

  it('matches nothing rather than everything for an empty number', () => {
    // The dangerous failure: '' normalising to '' and matching the job with no
    // number, so every report with no match shows somebody else's job.
    expect(findJobsForSr(jobs, '')).toEqual([]);
    expect(findJobsForSr(jobs, null)).toEqual([]);
  });

  it('survives junk in the list', () => {
    expect(() => findJobsForSr([null, undefined, {}], '2026028')).not.toThrow();
    expect(findJobsForSr(undefined, '2026028')).toEqual([]);
  });
});
