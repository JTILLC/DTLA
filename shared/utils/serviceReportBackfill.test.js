// Tests for the backfill's decisions.
//
// Two of these guard against writing wrong data into the record rather than
// against a crash: filing a visit under a duplicate plant because a name was
// spelled differently, and creating a second visit for a number that already
// has one. Both are silent when they go wrong.
import { describe, it, expect } from 'vitest';
import {
  normalizeSr, customerKey, resolveCustomer, findMissingVisits,
  toCandidate, buildVisitFromCandidate,
} from './serviceReportBackfill.js';

const ts = (number, over = {}) => ({
  id: `t-${number}`,
  customer: 'SunTree',
  invoiceInfo: { invoiceNumber: number },
  customerInfo: { purpose: 'Combination Weigher Services' },
  entries: [{ date: '2026-03-26' }],
  serviceReportData: { '2026-03-26': 'Repaired 4 drive units.' },
  ...over,
});

const visit = (sr, over = {}) => ({ id: `v-${sr}`, globalData: { serviceReportNumber: sr }, ...over });

describe('normalizeSr', () => {
  it('makes the two systems agree on a number', () => {
    expect(normalizeSr('2025-016')).toBe('2025016');
    expect(normalizeSr(' 2025 016 ')).toBe('2025016');
    expect(normalizeSr('2026014lf1')).toBe('2026014LF1');
    expect(normalizeSr(null)).toBe('');
  });
});

describe('resolveCustomer', () => {
  const ccw = [
    { id: 'oasis_date', name: 'Oasis Date' },
    { id: 'seneca_foods', name: 'Seneca Foods' },
    { id: 'suntree', name: 'SunTree' },
  ];
  // The three confirmed by Josh. `DatePac` is the one that proves names alone
  // can't do this: it is not a typo, it is what the plant used to be called.
  const aliases = { 'DatePac': 'Oasis Date', 'Oasis Dates': 'Oasis Date', 'B&G Foods': 'Seneca Foods' };

  it('matches on the name when it just matches', () => {
    expect(resolveCustomer('SunTree', ccw, aliases)).toMatchObject({ via: 'name' });
  });

  it('is not thrown by case or punctuation', () => {
    expect(resolveCustomer('suntree', ccw, aliases).customer.id).toBe('suntree');
    expect(resolveCustomer('Sun Tree', ccw, aliases).customer.id).toBe('suntree');
  });

  it('follows a rename to the plant that already exists', () => {
    expect(resolveCustomer('DatePac', ccw, aliases)).toMatchObject({ via: 'alias' });
    expect(resolveCustomer('DatePac', ccw, aliases).customer.id).toBe('oasis_date');
    expect(resolveCustomer('B&G Foods', ccw, aliases).customer.id).toBe('seneca_foods');
  });

  it('treats a plural as the same plant', () => {
    expect(resolveCustomer('Oasis Dates', ccw, aliases).customer.id).toBe('oasis_date');
  });

  it('returns nothing rather than guessing at an unknown plant', () => {
    expect(resolveCustomer('La Canasta', ccw, aliases)).toBeNull();
    expect(resolveCustomer('', ccw, aliases)).toBeNull();
  });

  it('does not need an alias list to work', () => {
    expect(resolveCustomer('SunTree', ccw).customer.id).toBe('suntree');
  });

  it('reads an alias list written in plain names, however it is punctuated', () => {
    expect(resolveCustomer('date pac', ccw, { 'DatePac': 'Oasis Date' }).customer.id).toBe('oasis_date');
    expect(resolveCustomer('B & G Foods', ccw, { 'B&G Foods': 'Seneca Foods' }).customer.id).toBe('seneca_foods');
  });
});

describe('findMissingVisits', () => {
  it('offers only numbers no visit has', () => {
    const out = findMissingVisits([ts('2026011'), ts('2026012')], [visit('2026011')]);
    expect(out.map((c) => c.number)).toEqual(['2026012']);
  });

  it('matches across formatting, so running it twice adds nothing', () => {
    expect(findMissingVisits([ts('2025-016')], [visit('2025016')])).toEqual([]);
  });

  it('ignores a deleted visit — that number IS missing again', () => {
    const out = findMissingVisits([ts('2026011')], [visit('2026011', { deleted: true })]);
    expect(out).toHaveLength(1);
  });

  it('skips timesheets with no service report number', () => {
    expect(findMissingVisits([ts('', { invoiceInfo: {} })], [])).toEqual([]);
  });

  it('collapses two timesheets sharing one number into one candidate', () => {
    const out = findMissingVisits([ts('2026011'), ts('2026011', { id: 'other' })], []);
    expect(out).toHaveLength(1);
  });

  it('puts the newest first', () => {
    const out = findMissingVisits([
      ts('a', { entries: [{ date: '2024-01-01' }] }),
      ts('c', { entries: [{ date: '2026-01-01' }] }),
      ts('b', { entries: [{ date: '2025-01-01' }] }),
    ], []);
    expect(out.map((c) => c.number)).toEqual(['c', 'b', 'a']);
  });

  it('survives empty input', () => {
    expect(findMissingVisits()).toEqual([]);
    expect(findMissingVisits([], [])).toEqual([]);
  });
});

describe('toCandidate', () => {
  it('pulls the write-up out day by day', () => {
    const c = toCandidate(ts('2026011', {
      entries: [{ date: '2026-03-26' }, { date: '2026-03-27' }],
      serviceReportData: { '2026-03-26': 'Day one.', '2026-03-27': 'Day two.' },
    }));
    expect(c.dayCount).toBe(2);
    expect(c.work.map((w) => w.text)).toEqual(['Day one.', 'Day two.']);
    expect(c.date).toBe('2026-03-26');
    expect(c.hasWork).toBe(true);
  });

  it('flags a timesheet with nothing written up', () => {
    // Three real ones look like this; a visit from them is a date and nothing else.
    const c = toCandidate(ts('2025003', { serviceReportData: {}, entries: [] }));
    expect(c.hasWork).toBe(false);
    expect(c.work).toEqual([]);
  });

  it('falls back to the write-up dates when there are no entries', () => {
    const c = toCandidate(ts('x', { entries: [], serviceReportData: { '2025-05-01': 'Work.' } }));
    expect(c.date).toBe('2025-05-01');
  });
});

describe('buildVisitFromCandidate', () => {
  const c = toCandidate(ts('2026011'));

  it('names the visit after the report and tags the number', () => {
    const v = buildVisitFromCandidate(c, []);
    expect(v.name).toBe('2026011');
    expect(v.globalData.serviceReportNumber).toBe('2026011');
  });

  it('marks it as backfilled, so it is never mistaken for a logged visit', () => {
    expect(buildVisitFromCandidate(c, []).globalData.backfilledFrom).toBe('timesheet');
  });

  it('carries the write-up into the notes', () => {
    expect(buildVisitFromCandidate(c, []).globalData.notes).toContain('Repaired 4 drive units.');
  });

  it('dates the visit from the work, not from today', () => {
    expect(buildVisitFromCandidate(c, []).date.slice(0, 10)).toBe('2026-03-26');
  });

  it('takes the machines it is given', () => {
    const lines = [{ id: 1, title: 'Line 1', heads: [{ id: 1 }] }];
    expect(buildVisitFromCandidate(c, lines).lines).toEqual(lines);
  });
});
