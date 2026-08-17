// src/utils/variance.js
//
// What a job was quoted against what it actually came to.
//
// Both figures have been collected for years and nothing has ever compared
// them. That comparison is the only feedback a quote ever gets: without it,
// the same job is underpriced every time it comes round and the only evidence
// is a vague sense that a customer is not very profitable.
//
// A job is only counted when BOTH numbers are present. A missing actual is a
// job that has not been invoiced yet, not a job that came in at zero, and
// letting those into an average would drag every figure toward "under quote"
// as a matter of arithmetic rather than fact.

import { parseMoney } from './format.js';

/** How one job compares. `state` is null when there is nothing to compare. */
export const jobVariance = (job = {}) => {
  const quote = parseMoney(job?.quote);
  const actual = parseMoney(job?.actual);
  if (quote <= 0 || actual <= 0) {
    return { quote, actual, delta: 0, pct: null, state: null };
  }
  const delta = actual - quote;
  const pct = (delta / quote) * 100;
  // Within a percent is the same number written twice, not a pricing signal.
  const state = Math.abs(pct) < 1 ? 'on' : (delta > 0 ? 'over' : 'under');
  return { quote, actual, delta, pct, state };
};

/**
 * How a set of jobs compares, and the ones worth looking at.
 *
 * The median is reported rather than the mean: one job that ran three times
 * over would otherwise decide the number for a whole year, and the question is
 * what usually happens.
 */
export const varianceSummary = (jobs = []) => {
  const rows = (jobs || [])
    .map((job) => ({ job, v: jobVariance(job) }))
    .filter((r) => r.v.state);

  if (!rows.length) {
    return { counted: 0, over: 0, under: 0, on: 0, totalDelta: 0, medianPct: null, worst: [] };
  }

  const pcts = rows.map((r) => r.v.pct).sort((a, b) => a - b);
  const mid = Math.floor(pcts.length / 2);
  const medianPct = pcts.length % 2 ? pcts[mid] : (pcts[mid - 1] + pcts[mid]) / 2;

  return {
    counted: rows.length,
    over: rows.filter((r) => r.v.state === 'over').length,
    under: rows.filter((r) => r.v.state === 'under').length,
    on: rows.filter((r) => r.v.state === 'on').length,
    totalDelta: rows.reduce((n, r) => n + r.v.delta, 0),
    medianPct,
    // Biggest misses either way — an underquote and an overquote are both worth
    // knowing about, so this sorts by size rather than by direction.
    worst: [...rows]
      .sort((a, b) => Math.abs(b.v.delta) - Math.abs(a.v.delta))
      .slice(0, 5)
      .map((r) => ({ ...r.v, sr: r.job.sr, customer: r.job.customer || r.job.customerName || '' })),
  };
};

/** Which customers are consistently misquoted, worst first. */
export const varianceByCustomer = (jobs = [], { minJobs = 2 } = {}) => {
  const groups = new Map();
  (jobs || []).forEach((job) => {
    const v = jobVariance(job);
    if (!v.state) return;
    const name = String(job.customer || job.customerName || '').trim();
    if (!name) return;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(v);
  });

  return [...groups.entries()]
    // One job is an anecdote. A pattern needs at least two.
    .filter(([, vs]) => vs.length >= minJobs)
    .map(([customer, vs]) => ({
      customer,
      jobs: vs.length,
      totalDelta: vs.reduce((n, v) => n + v.delta, 0),
      avgPct: vs.reduce((n, v) => n + v.pct, 0) / vs.length,
    }))
    .sort((a, b) => Math.abs(b.totalDelta) - Math.abs(a.totalDelta));
};

export default { jobVariance, varianceSummary, varianceByCustomer };
