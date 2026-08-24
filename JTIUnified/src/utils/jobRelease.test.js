// Whether a service report number can be handed back to the pool.
//
// The case that matters is the one that broke: a job the dashboard created
// moments ago has a Jobs Tracker record, and the old inline rule read that
// alone as "somebody has worked on this" — so the release control never
// rendered for any job started on the dashboard.
import { describe, it, expect } from 'vitest';
import { isTrackerJobFilled, releaseBlockers, canRelease, describeBlockers } from './jobRelease.js';

const justStarted = {
  id: 'abc', sr: '2026031', customer: 'Trident Seafood',
  city: 'Phoenix', state: 'AZ', dateRange: '8/20', year: '2026',
  quote: '', actual: '', terms: '', expPaid: '', invoiceDate: '', paid: false,
  createdBy: 'dashboard',
};

describe('a job the dashboard just started', () => {
  it('can be released — nothing has been filed against it', () => {
    expect(releaseBlockers({ trackerJob: justStarted })).toEqual([]);
    expect(canRelease({ trackerJob: justStarted })).toBe(true);
  });

  it('does not count customer, city, state or dates as work', () => {
    expect(isTrackerJobFilled(justStarted)).toBe(false);
  });
});

describe('what counts as somebody having filled the job in', () => {
  it.each(['quote', 'actual', 'terms', 'expPaid', 'invoiceDate'])('%s', (field) => {
    expect(isTrackerJobFilled({ ...justStarted, [field]: '3800' })).toBe(true);
  });

  it('does not count whitespace as content', () => {
    expect(isTrackerJobFilled({ ...justStarted, quote: '   ' })).toBe(false);
  });

  it('counts the paid checkbox, in the shapes it has been stored as', () => {
    expect(isTrackerJobFilled({ ...justStarted, paid: true })).toBe(true);
    expect(isTrackerJobFilled({ ...justStarted, paid: 'Yes' })).toBe(true);
    expect(isTrackerJobFilled({ ...justStarted, paid: false })).toBe(false);
  });

  it('counts a recorded payment even when every other field is empty', () => {
    expect(isTrackerJobFilled({ ...justStarted, payments: [{ amount: '4000', date: '2026-08-18' }] })).toBe(true);
  });

  it('does not count an empty payment row somebody opened and abandoned', () => {
    expect(isTrackerJobFilled({ ...justStarted, payments: [{ amount: '', date: '' }] })).toBe(false);
  });

  it('treats no tracker job at all as nothing filled — that is a bare reservation', () => {
    expect(isTrackerJobFilled(null)).toBe(false);
    expect(releaseBlockers({ trackerJob: null })).toEqual([]);
  });
});

describe('commitments elsewhere block a release', () => {
  it('a filed service report', () => {
    expect(releaseBlockers({ sources: { serviceReportUrl: 'https://x/r.pdf' } }))
      .toEqual(['a service report has been filed against it']);
  });

  it('a raised invoice', () => {
    expect(releaseBlockers({ sources: { invoiceUrl: 'https://x/i.pdf' } }))
      .toEqual(['an invoice has been raised against it']);
  });

  it('a logged visit', () => {
    expect(releaseBlockers({ visits: [{ date: '2026-08-18' }] }))
      .toEqual(['a visit is logged against it']);
  });

  it('a booked timesheet', () => {
    expect(releaseBlockers({ timesheets: [{ date: '2026-08-18' }] }))
      .toEqual(['a timesheet is booked to it']);
  });

  it('reports every reason, not just the first', () => {
    const reasons = releaseBlockers({
      trackerJob: { ...justStarted, actual: '4200' },
      sources: { serviceReportUrl: 'https://x/r.pdf', invoiceUrl: 'https://x/i.pdf' },
      visits: [{}], timesheets: [{}],
    });
    expect(reasons).toHaveLength(5);
    expect(canRelease({ trackerJob: { ...justStarted, actual: '4200' } })).toBe(false);
  });
});

describe('the reasons read as a sentence, because the screen says them out loud', () => {
  it('says nothing when there is nothing to say', () => {
    expect(describeBlockers([])).toBe('');
  });

  it('reads a single reason', () => {
    expect(describeBlockers(['a visit is logged against it']))
      .toBe('This number cannot be released because a visit is logged against it.');
  });

  it('joins several with an and', () => {
    expect(describeBlockers(['a', 'b', 'c']))
      .toBe('This number cannot be released because a, b and c.');
  });
});

describe('a number with no trace anywhere', () => {
  it('releases — that is exactly the case this exists for', () => {
    expect(releaseBlockers()).toEqual([]);
    expect(releaseBlockers({})).toEqual([]);
  });
});
