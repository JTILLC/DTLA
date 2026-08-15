// Writing a job into the Jobs Tracker from the dashboard.
//
// The Tracker's fields are free text a person typed, so this converts rather
// than copies — and the conversion is where a job lands in the wrong year or
// on the wrong day.
import { describe, it, expect } from 'vitest';
import { toTrackerJob, toDateRange, shortDate, yearOf } from './toTrackerJob.js';

describe('shortDate', () => {
  it('reads the day somebody wrote down', () => {
    expect(shortDate('2026-08-17')).toBe('8/17');
    expect(shortDate('2026-12-01')).toBe('12/1');
  });

  it('does not go through Date, so it cannot shift a day', () => {
    // A bare date string parsed by Date is UTC midnight — the previous evening
    // in Arizona. That bug already reached the reports screen once.
    expect(shortDate('2026-01-01')).toBe('1/1');
    expect(shortDate('2026-03-09')).toBe('3/9');
  });

  it('says nothing about nothing', () => {
    ['', null, undefined, 'not a date', '2026-8-1'].forEach((v) => expect(shortDate(v)).toBe(''));
  });
});

describe('toDateRange', () => {
  it('writes a range the way the Tracker does', () => {
    expect(toDateRange('2026-08-17', '2026-08-19')).toBe('8/17 - 8/19');
  });

  it('writes a single day as one date', () => {
    expect(toDateRange('2026-08-17', '')).toBe('8/17');
    expect(toDateRange('2026-08-17', '2026-08-17')).toBe('8/17');
  });

  it('copes with only an end date, or neither', () => {
    expect(toDateRange('', '2026-08-19')).toBe('8/19');
    expect(toDateRange('', '')).toBe('');
  });
});

describe('yearOf', () => {
  it('takes the year from the service report number', () => {
    expect(yearOf({ sr: '2026028', dateStart: '2027-01-02' })).toBe('2026');
  });

  it('falls back to the date when there is no number', () => {
    expect(yearOf({ sr: '', dateStart: '2025-11-04' })).toBe('2025');
  });

  it('falls back to this year rather than filing it nowhere', () => {
    expect(yearOf({})).toBe(String(new Date().getFullYear()));
  });
});

describe('toTrackerJob', () => {
  const started = {
    sr: '2026029', customer: 'Flagstone Foods', city: 'Robersonville', state: 'NC',
    dateStart: '2026-08-17', dateEnd: '2026-08-19', description: 'Span adjust',
  };

  it('produces what the Tracker stores', () => {
    const j = toTrackerJob(started, 'doc-1');
    expect(j).toMatchObject({
      id: 'doc-1', sr: '2026029', customer: 'Flagstone Foods',
      city: 'Robersonville', state: 'NC', dateRange: '8/17 - 8/19', year: '2026',
    });
  });

  it('leaves the money EMPTY rather than zero', () => {
    // A zero quote reads as "priced at nothing" in every total that sums these.
    const j = toTrackerJob(started, 'doc-1');
    expect(j.quote).toBe('');
    expect(j.actual).toBe('');
    expect(j.invoiceDate).toBe('');
    expect(j.paid).toBe(false);
  });

  it('records where the job came from', () => {
    expect(toTrackerJob(started, 'doc-1').createdBy).toBe('dashboard');
  });

  it('trims what somebody typed', () => {
    const j = toTrackerJob({ ...started, customer: '  Flagstone Foods ', state: 'NC ' }, 'x');
    expect(j.customer).toBe('Flagstone Foods');
    expect(j.state).toBe('NC');
  });

  it('survives an empty draft rather than writing junk into the year', () => {
    expect(() => toTrackerJob({}, 'x')).not.toThrow();
    expect(toTrackerJob({}, 'x').dateRange).toBe('');
  });
});
