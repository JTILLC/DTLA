// shared/utils/serviceReportBackfill.js
//
// Which invoiced service reports never became a visit, and what a visit built
// from one would contain.
//
// Kept as plain functions with no Firebase in sight, because the decisions here
// are the ones worth being sure about: whether a plant already has a visit for
// a number, which CCW customer a timesheet name refers to, and what carries
// across. Those are testable; a Firestore query is not.

/** Same normalisation the dashboard uses: "2025-016" and "2025016" are one number. */
export const normalizeSr = (n) => String(n || '').trim().replace(/[\s-]/g, '').toUpperCase();

/** Loose customer key — case, punctuation and spacing all vary between systems. */
export const customerKey = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Plants get renamed and bought, and each app spells them independently.
// DatePac became Oasis Date between two invoices in the same system; B&G Foods
// is now Seneca Foods. Matching on name alone files those under a second,
// duplicate plant and splits one machine's history in two, so the join goes
// through an alias list that can be added to when it happens again.
export const resolveCustomer = (timesheetName, ccwCustomers = [], aliases = {}) => {
  const key = customerKey(timesheetName);
  if (!key) return null;

  // Keys are normalised here rather than demanded of the caller, so the list
  // can be written the way anyone would write it — "DatePac": "Oasis Date" —
  // and still survive a stray space or a capital.
  const aliasTarget = Object.entries(aliases)
    .find(([from]) => customerKey(from) === key)?.[1];
  if (aliasTarget) {
    const byAlias = ccwCustomers.find((c) => customerKey(c.name) === customerKey(aliasTarget));
    if (byAlias) return { customer: byAlias, via: 'alias' };
  }

  const exact = ccwCustomers.find((c) => customerKey(c.name) === key);
  if (exact) return { customer: exact, via: 'name' };

  return null;
};

/**
 * Timesheets that carry a service report number which no visit claims.
 *
 * `visits` is what the app already holds for this customer, so "does it exist
 * already?" costs nothing extra. Matching is on the NUMBER, not the date or the
 * customer: the number is the thing both systems agree on, and it is what makes
 * running this twice harmless.
 */
export const findMissingVisits = (timesheets = [], visits = []) => {
  const taken = new Set(
    visits
      .filter((v) => !v.deleted)
      .map((v) => normalizeSr(v.globalData?.serviceReportNumber))
      .filter(Boolean),
  );

  const seen = new Set();
  return timesheets
    .map((t) => ({ t, norm: normalizeSr(t.invoiceInfo?.invoiceNumber) }))
    .filter(({ norm }) => norm && !taken.has(norm))
    // Two timesheets can carry the same number; one missing visit, not two.
    .filter(({ norm }) => (seen.has(norm) ? false : seen.add(norm)))
    .map(({ t, norm }) => toCandidate(t, norm))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
};

/** The parts of a timesheet worth showing before deciding to file it. */
export const toCandidate = (t, norm = null) => {
  const srd = t.serviceReportData || {};
  const dates = Array.isArray(t.entries) && t.entries.length
    ? t.entries.map((e) => e.date).filter(Boolean)
    : Object.keys(srd);
  const days = [...new Set(dates)].sort();
  const work = days
    .map((d) => ({ date: d, text: String(srd[d] || '').trim() }))
    .filter((x) => x.text);

  return {
    id: t.id,
    number: t.invoiceInfo?.invoiceNumber || '',
    norm: norm || normalizeSr(t.invoiceInfo?.invoiceNumber),
    customer: t.customer || t.customerInfo?.company || '',
    purpose: t.customerInfo?.purpose || '',
    date: days[0] || '',
    dayCount: days.length,
    work,
    // The write-up is the reason to keep any of this; a candidate without one
    // would produce a visit that is a date and nothing else.
    hasWork: work.length > 0,
  };
};

/**
 * The visit a candidate would create.
 *
 * `lines` come from the customer's most recent visit via scaffoldLinesFrom, so
 * a backfilled visit starts with the right machines instead of empty — and
 * `keepIssues` is deliberately false: this is a record of a past job, not a
 * carry-forward of today's faults.
 */
export const buildVisitFromCandidate = (candidate, scaffoldedLines = []) => ({
  date: candidate.date ? new Date(candidate.date).toISOString() : new Date().toISOString(),
  name: candidate.number,
  globalData: {
    serviceReportNumber: candidate.number,
    // Marked so a backfilled visit is never mistaken for one somebody stood in
    // front of the machine and wrote. It came from the invoice.
    backfilledFrom: 'timesheet',
    backfilledAt: new Date().toISOString(),
    notes: candidate.work.map((w) => `${w.date}\n${w.text}`).join('\n\n'),
    purpose: candidate.purpose || '',
  },
  lines: scaffoldedLines,
});
