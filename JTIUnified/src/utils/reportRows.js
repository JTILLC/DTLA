// src/utils/reportRows.js
//
// Every service report number worth showing on the reports screen.
//
// The list was built from timesheets, weigher visits and manually typed
// entries. A job packet was not a source — so a number that had an invoice
// uploaded to its packet, and nothing else yet, was not in the list at all.
// There was no row to click, which reads as the number not existing rather
// than as the screen not knowing about packets.
//
// That is the normal state for a job in progress: a number is reserved, the
// invoice and the signed report are uploaded to its packet, and the timesheet
// or weigher visit catches up later.

import { normalizeSr, findJobsForSr } from './srMatch.js';

const yearOf = (norm) => {
  const m = /^(\d{4})/.exec(String(norm || ''));
  return m ? m[1] : 'Other';
};

/**
 * Merge packet-only numbers into the report list.
 *
 * Existing rows are returned untouched — a packet never overrides what the
 * timesheets and visits say, it only adds numbers nothing else knew about.
 *
 * @param {Array}  reports - rows from fetchServiceReports
 * @param {Map}    packets - packets keyed by normalized number
 */
export const withPacketNumbers = (reports = [], packets = null) => {
  if (!packets || typeof packets.forEach !== 'function') return reports;

  const seen = new Set((reports || []).map((r) => r.norm));
  const extra = [];

  packets.forEach((p, key) => {
    const norm = normalizeSr(p?.sr || key);
    if (!norm || seen.has(norm)) return;
    // A packet with no files is a number somebody reserved and never used.
    // Showing it would fill the list with rows that open onto nothing.
    if (!(p?.files || []).length) return;
    seen.add(norm);
    extra.push({
      number: p.sr || key,
      norm,
      year: yearOf(norm),
      timesheets: [],
      visits: [],
      // Marks the row as existing only because of its packet, so the screen can
      // say so rather than presenting it as a fully recorded job.
      packetOnly: true,
    });
  });

  if (!extra.length) return reports;
  return [...reports, ...extra].sort((a, b) => String(b.norm).localeCompare(String(a.norm)));
};

/**
 * Whose job this is, for a row in the list.
 *
 * Asked of every source in turn because no single one covers every row: a
 * number can exist as a timesheet, as a weigher visit, as a tracker job, or as
 * nothing but a packet. "Unknown" is a real value in the timesheet data and is
 * treated as no answer rather than shown as if it were one.
 */
export const customerForReport = (report, jobs = [], started = []) => {
  if (!report) return '';
  const named = (v) => {
    const s = String(v || '').trim();
    return s && s.toLowerCase() !== 'unknown' ? s : '';
  };

  for (const t of report.timesheets || []) {
    const n = named(t.customer) || named(t.customerInfo?.company);
    if (n) return n;
  }
  for (const v of report.visits || []) {
    const n = named(v.customer);
    if (n) return n;
  }
  // A packet-only number has neither, and the tracker or the reservation is the
  // only place its customer was ever written down.
  for (const j of findJobsForSr(jobs, report.number)) {
    const n = named(j.customer);
    if (n) return n;
  }
  for (const j of started || []) {
    if (normalizeSr(j?.sr) === normalizeSr(report.number)) {
      const n = named(j.customer);
      if (n) return n;
    }
  }
  return '';
};

export default { withPacketNumbers, customerForReport };
