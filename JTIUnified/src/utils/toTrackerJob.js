// src/utils/toTrackerJob.js
//
// A job started on the dashboard, in the shape the Jobs Tracker stores.
//
// Until now the dashboard could only RESERVE a number: it wrote a reservation,
// the Jobs app offered that number on its SR field, and somebody typed the job
// in again. That was not a design so much as a consequence — the Jobs app kept
// every year in one file and rewrote the lot on save, so a second writer would
// have clobbered whatever the first had done.
//
// Now that each job is its own document, two writers are no longer a problem
// and the dashboard can create the job outright.
//
// The Tracker's fields are free text in formats a person typed, not ISO dates,
// so this converts rather than copies. The money fields are left empty on
// purpose: a job that has not been quoted has no quote, and inventing a zero
// would put it in the totals as though it had been priced at nothing.

const pad = (n) => String(n);

/**
 * "2026-08-17" as "8/17", without going through Date.
 *
 * A bare date string parsed by Date is UTC midnight, which in Arizona is the
 * previous evening — the same off-by-one that had invoices showing a day early
 * on the reports screen. The parts are right there in the string.
 */
export const shortDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return '';
  return `${pad(Number(m[2]))}/${pad(Number(m[3]))}`;
};

/** The Tracker writes a range as "8/17 - 8/19", or a single day as "8/17". */
export const toDateRange = (start, end) => {
  const a = shortDate(start);
  const b = shortDate(end);
  if (!a) return b || '';
  if (!b || b === a) return a;
  return `${a} - ${b}`;
};

/** Which year file this job belongs to. The number decides; the date is the fallback. */
export const yearOf = (job = {}) => {
  const fromSr = /^(\d{4})/.exec(String(job.sr || ''));
  if (fromSr) return fromSr[1];
  const fromDate = /^(\d{4})-/.exec(String(job.dateStart || job.date || ''));
  return fromDate ? fromDate[1] : String(new Date().getFullYear());
};

/**
 * @param {object} started - what the dashboard's Start a job page collected
 * @param {string} id      - the document id, which also lives in the job
 */
export const toTrackerJob = (started = {}, id) => ({
  id,
  sr: String(started.sr || '').trim(),
  customer: String(started.customer || '').trim(),
  city: String(started.city || '').trim(),
  state: String(started.state || '').trim(),
  dateRange: toDateRange(started.dateStart || started.date, started.dateEnd),
  year: yearOf(started),

  // Not filled in, and not zero. These are the Tracker's to collect, and a zero
  // would read as "quoted at nothing" in every total that sums them.
  quote: '',
  actual: '',
  terms: '',
  expPaid: '',
  invoiceDate: '',
  paid: false,

  // So the Tracker can show where a job came from, and so this is separable
  // again if the idea turns out to be wrong.
  createdBy: 'dashboard',
  createdAt: new Date().toISOString(),
});

export default { toTrackerJob, toDateRange, shortDate, yearOf };
