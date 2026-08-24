// src/utils/jobRelease.js
//
// Whether a service report number can be handed back to the pool.
//
// Releasing deletes the job and puts its number back in play. That is only safe
// while nothing has been FILED against it: once the number is on a service
// report, an invoice, a timesheet or a customer's paperwork, handing it out
// again puts two jobs under one number in four systems that key on it and
// cannot tell them apart afterwards.
//
// This used to be decided inline on the packet page, as:
//
//     !trackerJob && !job && !sources?.serviceReportUrl && !sources?.invoiceUrl
//
// `!trackerJob` was right when starting a job only RESERVED a number and
// somebody typed the job into the Tracker afterwards — a tracker job existing
// meant a person had been there. Since the dashboard creates the tracker job
// itself at step one, every job started here has one from the moment it exists,
// so that test was false for all of them and the button silently never
// rendered. The number could not be released at all.
//
// What matters is not whether a tracker job exists but whether anyone has put
// anything IN it. A job created by the dashboard carries a number, a customer
// and some dates; its money fields are deliberately left empty (see
// toTrackerJob). Nothing there is a commitment.
//
// Reasons rather than a boolean, and a button that explains itself rather than
// disappearing: a control that vanishes with no account of why reads as a
// missing feature, which is exactly how this bug went unnoticed.

import { isPaid, parseMoney } from './format.js';
import { paymentsOf } from './payments.js';

/** Money and terms — the Tracker's to collect, empty on a job just started. */
const FILLED_FIELDS = ['quote', 'actual', 'terms', 'expPaid', 'invoiceDate'];

/**
 * Has anybody actually entered anything on this Tracker job?
 *
 * Deliberately NOT counting customer, city, state or dateRange: the dashboard
 * writes those when the job is started, so treating them as content would make
 * every job look worked-on the moment it existed.
 */
export const isTrackerJobFilled = (trackerJob) => {
  if (!trackerJob) return false;
  if (FILLED_FIELDS.some((f) => String(trackerJob[f] ?? '').trim() !== '')) return true;
  if (isPaid(trackerJob.paid)) return true;
  // A recorded payment is money in the bank against this number, whatever the
  // rest of the job says.
  if (paymentsOf(trackerJob).some((p) => parseMoney(p.amount) > 0 || p.date)) return true;
  return false;
};

/**
 * Why this number cannot go back in the pool. Empty means it can.
 *
 * @param {object} trackerJob - the Jobs Tracker record, or null
 * @param {object} sources    - fetchPacketSources / sourcesFromLists output
 * @param {Array}  visits     - CCW visits joined to this number
 * @param {Array}  timesheets - timesheet entries booked to this number
 */
export const releaseBlockers = ({ trackerJob = null, sources = null, visits = [], timesheets = [] } = {}) => {
  const reasons = [];
  if (sources?.serviceReportUrl) reasons.push('a service report has been filed against it');
  if (sources?.invoiceUrl) reasons.push('an invoice has been raised against it');
  if ((visits || []).length) reasons.push('a visit is logged against it');
  if ((timesheets || []).length) reasons.push('a timesheet is booked to it');
  if (isTrackerJobFilled(trackerJob)) reasons.push('the job has been quoted, invoiced or paid in the Jobs Tracker');
  return reasons;
};

export const canRelease = (evidence) => releaseBlockers(evidence).length === 0;

/** The blockers as one sentence, for a screen to show instead of hiding a button. */
export const describeBlockers = (reasons = []) => {
  if (!reasons.length) return '';
  if (reasons.length === 1) return `This number cannot be released because ${reasons[0]}.`;
  const last = reasons[reasons.length - 1];
  return `This number cannot be released because ${reasons.slice(0, -1).join(', ')} and ${last}.`;
};

export default { isTrackerJobFilled, releaseBlockers, canRelease, describeBlockers };
