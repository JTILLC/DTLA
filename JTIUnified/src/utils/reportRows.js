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

import { normalizeSr } from './srMatch.js';

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

export default { withPacketNumbers };
