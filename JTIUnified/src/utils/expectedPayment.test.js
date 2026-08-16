// When a job is expected to be paid.
//
// expPaid is free text, so the same date arrives in more than one form. Handed
// to `new Date` those land on different DAYS, which decides whether a job reads
// as overdue — so it was marking some jobs late a day early.
import { describe, it, expect } from 'vitest';
import { parseExpectedDate, expectedPayment, describeTiming } from './expectedPayment.js';

const AUG15 = new Date(2026, 7, 15);   // local, no timezone in play

describe('parseExpectedDate', () => {
  it('reads both forms people actually type as the SAME day', () => {
    // The bug: "2026-08-15" through new Date is UTC midnight, which is the
    // evening of the 14th in Arizona, while "08/15/2026" is local midnight.
    expect(parseExpectedDate('2026-08-15').getTime()).toBe(AUG15.getTime());
    expect(parseExpectedDate('08/15/2026').getTime()).toBe(AUG15.getTime());
    expect(parseExpectedDate('8/15/2026').getTime()).toBe(AUG15.getTime());
  });

  it('accepts a two-digit year, which people also type', () => {
    expect(parseExpectedDate('8/15/26').getTime()).toBe(AUG15.getTime());
  });

  it('refuses a date that does not exist rather than rolling it forward', () => {
    // new Date(2026, 1, 31) silently becomes 3 March.
    expect(parseExpectedDate('02/31/2026')).toBeNull();
    expect(parseExpectedDate('2026-13-01')).toBeNull();
  });

  it('says something is not a date instead of guessing', () => {
    ['', '   ', 'net 30', 'end of month', 'TBD', null, undefined]
      .forEach((v) => expect(parseExpectedDate(v)).toBeNull());
  });
});

describe('expectedPayment', () => {
  const job = (over) => ({ actual: '4200', quote: '4000', expPaid: '08/20/2026', ...over });

  it('prefers the actual over the quote', () => {
    expect(expectedPayment(job(), AUG15).amount).toBe(4200);
  });

  it('falls back to the quote when there is no actual yet', () => {
    expect(expectedPayment(job({ actual: '' }), AUG15).amount).toBe(4000);
  });

  it('gives no amount rather than zero when neither is set', () => {
    // A zero would read as "expecting nothing", which is a different claim.
    expect(expectedPayment(job({ actual: '', quote: '' }), AUG15).amount).toBeNull();
  });

  it('is not overdue before the date', () => {
    const i = expectedPayment(job({ expPaid: '08/20/2026' }), AUG15);
    expect(i.overdue).toBe(false);
    expect(i.days).toBe(-5);
  });

  it('is not overdue ON the day', () => {
    // Something due today has not been missed yet.
    const i = expectedPayment(job({ expPaid: '08/15/2026' }), AUG15);
    expect(i.overdue).toBe(false);
    expect(i.days).toBe(0);
  });

  it('is overdue after it', () => {
    const i = expectedPayment(job({ expPaid: '08/12/2026' }), AUG15);
    expect(i.overdue).toBe(true);
    expect(i.days).toBe(3);
  });

  it('treats both written forms identically at the boundary', () => {
    // The case that was wrong: due today, written as ISO, called overdue.
    expect(expectedPayment(job({ expPaid: '2026-08-15' }), AUG15).overdue).toBe(false);
  });

  it('keeps text that is not a date rather than swallowing it', () => {
    const i = expectedPayment(job({ expPaid: 'net 30' }), AUG15);
    expect(i.text).toBe('net 30');
    expect(i.date).toBeNull();
    expect(i.overdue).toBe(false);
  });

  it('survives a job with nothing on it', () => {
    expect(() => expectedPayment({}, AUG15)).not.toThrow();
    expect(expectedPayment({}, AUG15).text).toBe('');
  });
});

describe('describeTiming', () => {
  it('reads naturally in each direction', () => {
    const at = (d) => expectedPayment({ expPaid: d }, AUG15);
    expect(describeTiming(at('08/12/2026'))).toBe('3 days late');
    expect(describeTiming(at('08/14/2026'))).toBe('1 day late');
    expect(describeTiming(at('08/15/2026'))).toBe('due today');
    expect(describeTiming(at('08/16/2026'))).toBe('due in 1 day');
  });

  it('says nothing when there is no date to describe', () => {
    expect(describeTiming(expectedPayment({ expPaid: 'net 30' }, AUG15))).toBe('');
    expect(describeTiming(null)).toBe('');
  });
});
