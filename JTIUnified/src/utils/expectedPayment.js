// src/utils/expectedPayment.js
//
// When a job is expected to be paid, and how much.
//
// `expPaid` is a free-text field in the Jobs Tracker — the placeholder says
// MM/DD/YYYY but nothing enforces it, so the same date arrives as "08/15/2026"
// from one person and "2026-08-15" from another. Handed to `new Date`, those
// land on DIFFERENT DAYS: the slashed form parses as local midnight, the dashed
// form as UTC midnight, which in Arizona is the evening before.
//
// That decides whether a job reads as overdue, so it was quietly marking some
// jobs late a day early. Both forms are taken apart as text here instead, and
// the same function answers the display and the overdue test — two readings of
// one date that disagreed would be worse than either.

import { parseMoney } from './format.js';

/**
 * An expected-payment date as a LOCAL date, or null if it is not one.
 *
 * Accepts what people actually type. Anything else — "end of month", "net 30",
 * a blank — is not a date and says so rather than being coerced into one.
 */
export const parseExpectedDate = (value) => {
  const s = String(value ?? '').trim();
  if (!s) return null;

  let y, m, d;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  const usShort = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s);

  if (iso) [, y, m, d] = iso;
  else if (us) [, m, d, y] = us;
  else if (usShort) { [, m, d, y] = usShort; y = `20${y}`; }
  else return null;

  const date = new Date(Number(y), Number(m) - 1, Number(d));
  // Rejects 02/31 rather than silently rolling it into March.
  if (date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return null;
  return date;
};

/** Whole days between two local dates, ignoring the time of day. */
const daysBetween = (a, b) => {
  const x = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const y = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((y - x) / 86400000);
};

/**
 * What to show against an unpaid job.
 *
 * `text` is what was typed when it is not a date, so "net 30" is shown rather
 * than swallowed — somebody wrote it for a reason, and hiding it would make the
 * field look empty.
 */
export const expectedPayment = (job = {}, today = new Date()) => {
  const amount = (() => {
    // parseMoney, not parseFloat: these are free text and "4,200" reads as 4.
    const actual = parseMoney(job?.actual);
    const quote = parseMoney(job?.quote);
    return actual > 0 ? actual : (quote > 0 ? quote : null);
  })();

  const date = parseExpectedDate(job?.expPaid);
  const raw = String(job?.expPaid ?? '').trim();

  if (!date) {
    return { amount, date: null, text: raw, overdue: false, days: null };
  }

  const days = daysBetween(date, today);   // positive = the date has passed
  return {
    amount,
    date,
    text: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    overdue: days > 0,
    days,
  };
};

/** "3 days late" / "due in 5 days" / "due today". Empty when there is no date. */
export const describeTiming = (info) => {
  if (!info?.date || info.days == null) return '';
  if (info.days === 0) return 'due today';
  if (info.days > 0) return `${info.days} day${info.days === 1 ? '' : 's'} late`;
  const n = Math.abs(info.days);
  return `due in ${n} day${n === 1 ? '' : 's'}`;
};

export default { expectedPayment, parseExpectedDate, describeTiming };
