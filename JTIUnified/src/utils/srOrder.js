// src/utils/srOrder.js
//
// Newest first, decided by the service report number.
//
// An SR number is YYYYNNN: the year, then the job's place in that year —
// 2026029 is the twenty-ninth job of 2026. That makes it the only field on a
// customer's page that reliably orders their work, because it is assigned in
// order and it is on everything. Dates are not: a job carries the date it was
// created, a timesheet the days worked, a visit the day it was opened, and a
// record can be filed weeks after the work.
//
// Sorted as a NUMBER rather than as text, so 2026009 and 2026029 cannot end up
// either side of 202610 if a number is ever written short.
import { normalizeSr } from './srMatch';

/** The sortable value of an SR number, or null when it is not one. */
export const srKey = (value) => {
  const norm = normalizeSr(value);
  const m = /^(?:SR)?(\d{4})(\d{1,3})$/.exec(norm);
  if (!m) return null;
  const year = Number(m[1]);
  // Sanity: 1990–2099. A part code or a phone number that happens to be seven
  // digits is not a job, and letting one in would sort a customer's page by it.
  if (year < 1990 || year > 2099) return null;
  return year * 1000 + Number(m[2]);
};

/** Milliseconds for a date in any of the shapes these records carry. */
const timeOf = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * Newest first, by SR number, falling back to a date.
 *
 * `get` pulls the SR off a record; `date` pulls its date. A record with no
 * usable number is ordered by date among the rest rather than being dumped at
 * the end — an unnumbered job is usually the newest thing there is, and hiding
 * it at the bottom of the list is how it gets forgotten.
 */
export const byNewestSr = (get, date = () => null) => (a, b) => {
  const ka = srKey(get(a));
  const kb = srKey(get(b));
  if (ka !== null && kb !== null && ka !== kb) return kb - ka;

  const ta = timeOf(date(a));
  const tb = timeOf(date(b));
  if (ta !== null && tb !== null && ta !== tb) return tb - ta;

  // One has a number and the other does not, and their dates cannot separate
  // them: the numbered one is placed by its number, the other by its date, and
  // with neither comparable the numbered one goes first because it is the one
  // we know something about.
  if (ka !== null && kb === null) return -1;
  if (ka === null && kb !== null) return 1;
  if (ta !== null && tb === null) return -1;
  if (ta === null && tb !== null) return 1;
  return 0;
};

export default { srKey, byNewestSr };
