// src/utils/payments.js
//
// What has actually been received against a job.
//
// `paid` was a single checkbox. That makes three quite different situations
// look the same: not paid, paid in full, and paid short. A customer who settles
// £4,000 of a £4,200 invoice either reads as fully paid — and the £200 vanishes
// — or as unpaid, and the £4,000 is invisible. Neither is true, and neither can
// be reconciled against a bank statement.
//
// A job now carries the payments it received. The checkbox still works and is
// still what most of the history has, so it is read as "paid in full on a date
// nobody recorded" rather than being thrown away or migrated on a guess.

import { parseMoney, isPaid, jobAmount } from './format.js';

/** Payments recorded against a job, oldest first. Always an array. */
export const paymentsOf = (job) => {
  const list = Array.isArray(job?.payments) ? job.payments : [];
  return [...list]
    .filter((p) => p && (p.amount != null || p.date))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
};

/** How much has come in. */
export const receivedTotal = (job) =>
  paymentsOf(job).reduce((sum, p) => sum + parseMoney(p.amount), 0);

// A penny either way is a rounding artefact, not a short payment. Anything
// larger is a real difference somebody should see.
const TOLERANCE = 0.01;

/**
 * Where a job stands: what was invoiced, what came in, what is left.
 *
 * `amount` is passed in rather than derived here so this stays the single
 * answer to "how much is outstanding" while jobAmount stays the single answer
 * to "how much is it worth".
 */
export const paymentState = (job = {}, amount = 0) => {
  const invoiced = parseMoney(amount);
  const payments = paymentsOf(job);

  // No payment records: the checkbox is all there is, and it means paid in
  // full. Most of the history looks like this and will never be revisited.
  if (!payments.length) {
    const flagged = isPaid(job?.paid);
    return {
      invoiced,
      received: flagged ? invoiced : 0,
      outstanding: flagged ? 0 : invoiced,
      status: flagged ? 'paid' : 'unpaid',
      lastPaymentDate: null,
      payments: [],
      fromCheckbox: true,
    };
  }

  const received = receivedTotal(job);
  const outstanding = Math.max(0, invoiced - received);

  let status = 'unpaid';
  if (invoiced > 0 && received >= invoiced - TOLERANCE) status = 'paid';
  else if (received > TOLERANCE) status = 'partial';
  // An amount received against a job with no invoice figure is still money in.
  else if (invoiced === 0 && received > 0) status = 'paid';

  return {
    invoiced,
    received,
    outstanding,
    status,
    lastPaymentDate: payments[payments.length - 1]?.date || null,
    payments,
    fromCheckbox: false,
  };
};

/** Whether a job counts as settled, however that was recorded. */
export const isSettled = (job, amount) => paymentState(job, amount).status === 'paid';

/** One line for a job's payment position. */
export const describePayments = (state) => {
  if (!state) return '';
  if (state.status === 'paid') return state.fromCheckbox ? 'Paid' : `Paid in full`;
  if (state.status === 'partial') {
    return `Part paid — ${state.received.toLocaleString(undefined, { style: 'currency', currency: 'USD' })} of `
      + `${state.invoiced.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}`;
  }
  return 'Unpaid';
};

/**
 * Total billable income across jobs, optionally only what has been RECEIVED.
 *
 * `paidOnly` used to mean "the invoice value of jobs with the box ticked",
 * which counts a part-paid job as either its full value or nothing. It now
 * means money in: recorded payments where a job has them, and the invoice value
 * where all it has is the checkbox — which is nearly all of the history and
 * means exactly what it always did.
 */
export const sumIncome = (jobs, { paidOnly = false } = {}) =>
  (jobs || []).reduce((sum, job) => {
    // A closed job is one that was cancelled after a number was spent on it.
    // It is not income and never will be, so it does not belong in either
    // figure — but it stays visible everywhere else, because the number is
    // still spoken for and somebody will ask what happened to it.
    if (job?.closedAt) return sum;
    const amount = jobAmount(job);
    if (!paidOnly) return sum + amount;
    return sum + paymentState(job, amount).received;
  }, 0);

export default { paymentsOf, receivedTotal, paymentState, isSettled, describePayments, sumIncome };
