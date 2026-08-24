// shared/utils/srMatch.js
//
// Matching a service report number across systems that write it differently.
//
// The same job is "2026028" in the Jobs Tracker, "2026-028" on a timesheet and
// "SR 2026028" on somebody's invoice. Every screen that joins these had its own
// inline normaliser, which meant a number that matched on the packet page could
// fail to match on the reports page for no reason a person could see.

/** Comparison form: spaces and dashes out, upper case. */
export const normalizeSr = (v) => String(v || '').trim().replace(/[\s-]/g, '').toUpperCase();

/**
 * Every Jobs Tracker entry recorded against a service report number.
 *
 * A job is keyed by `sr`, but older entries only ever had the invoice number
 * filled in — and for this business those are the same number, so both are
 * checked. Returns a list rather than one match: the same number legitimately
 * appears twice when a job was split across two invoices, and silently showing
 * the first would hide the second.
 */
export const findJobsForSr = (jobs = [], sr) => {
  const key = normalizeSr(sr);
  if (!key) return [];
  return (jobs || []).filter((j) => {
    if (!j) return false;
    return normalizeSr(j.sr) === key || normalizeSr(j.invoiceNumber) === key;
  });
};

export default { normalizeSr, findJobsForSr };
