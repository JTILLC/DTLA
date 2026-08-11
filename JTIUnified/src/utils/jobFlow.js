// src/utils/jobFlow.js
//
// Where a job has got to, and what the next service report number is.
//
// A job passes through the same seven steps every time and they are spread
// across four systems, so "did we ever invoice that one?" is a question nobody
// can answer without opening four apps. This turns it into a line of ticks.
//
// The steps are derived from real data rather than ticked by hand. A checklist
// somebody maintains is a checklist that goes stale the first busy week; one
// that reads the actual files can only be wrong if the data is.

/** Year prefix of a service report number: 2026024 → 2026. */
export const yearOf = (sr) => {
  const m = String(sr || '').match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
};

/** The numeric sequence part: 2026024 → 24, 2026014LF1 → 14. */
export const sequenceOf = (sr) => {
  const m = String(sr || '').match(/^\d{4}(\d{1,3})/);
  return m ? Number(m[1]) : null;
};

/**
 * The next free service report number for a year.
 *
 * Takes the highest sequence in use and adds one — never fills a gap. A gap is
 * usually a job that was cancelled or a number written on paper somewhere, and
 * reusing it puts two different jobs under one number in systems that have no
 * way to tell them apart.
 *
 * Suffixed numbers (2026014LF1 — a second visit on one job) count as their base
 * number, so they neither claim a new one nor push the sequence along.
 */
export const nextServiceReportNumber = (existing = [], year = new Date().getFullYear()) => {
  const used = existing
    .map((e) => (typeof e === 'string' ? e : e?.number || e?.sr))
    .filter((n) => yearOf(n) === year)
    .map(sequenceOf)
    .filter((n) => Number.isFinite(n));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${year}${String(next).padStart(3, '0')}`;
};

/**
 * The steps, in order, with whether each is done.
 *
 * `optional` marks a step that is genuinely not always needed — not every job
 * has a purchase order or an expense — so a packet without one is not shown as
 * unfinished. It is still listed, because "no PO on this job" should be a thing
 * somebody decided rather than a thing nobody noticed.
 */
export const jobFlowSteps = ({ job, sources, packet, manualInvoice } = {}) => {
  const files = packet?.files || [];
  const hasKind = (kind) => files.some((f) => f.kind === kind);

  return [
    {
      key: 'created',
      label: 'Job created',
      hint: 'In the Jobs Tracker, with this service report number',
      done: !!job,
    },
    {
      key: 'serviceReport',
      label: 'Service report filed',
      hint: 'Signed by the customer and uploaded',
      done: !!(sources?.serviceReportUrl || hasKind('serviceReport')),
    },
    {
      key: 'po',
      label: 'Purchase order received',
      hint: 'Not every customer issues one',
      optional: true,
      done: hasKind('po'),
    },
    {
      key: 'invoice',
      label: 'Invoice raised',
      hint: 'In the Jobs Tracker or uploaded here',
      done: !!(sources?.invoiceUrl || manualInvoice || hasKind('invoice')),
    },
    {
      key: 'receipts',
      label: 'Receipts added',
      hint: 'Fuel, parts, anything rebilled',
      optional: true,
      done: hasKind('receipts'),
    },
    {
      key: 'packet',
      label: 'Packet built',
      hint: 'One PDF: PO, invoice, service report, receipts',
      done: !!packet?.builtAt,
    },
    {
      key: 'sent',
      label: 'Sent to accounts payable',
      hint: 'Emailed to the addresses on the customer record',
      done: !!packet?.sentAt,
    },
    {
      key: 'paid',
      label: 'Paid',
      hint: 'Marked paid in the Jobs Tracker',
      done: isPaidish(job),
    },
  ];
};

// The Jobs Tracker records paid in several shapes over the years.
const isPaidish = (job) => {
  const v = job?.paid;
  if (v === true) return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === 'paid' || s === 'y';
};

/** The first step still outstanding — what to do next, in one line. */
export const nextAction = (steps = []) => steps.find((s) => !s.done && !s.optional) || null;

/** How far along, ignoring the optional ones so the bar cannot stall on a job with no PO. */
export const flowProgress = (steps = []) => {
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  return { done, total: required.length, pct: required.length ? Math.round((done / required.length) * 100) : 0 };
};

export default { nextServiceReportNumber, jobFlowSteps, nextAction, flowProgress, yearOf, sequenceOf };
