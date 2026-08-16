// `test` from vitest, not node:test — under node:test this file reported
// "no test suite found" to the vitest run, leaving the suite permanently red
// and a real failure indistinguishable from the usual noise.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isPaid, jobAmount, sumIncome, asLocalDate, parseMoney } from './format.js';

test('isPaid recognizes truthy forms', () => {
  for (const v of [true, 1, 'yes', 'Yes', 'YES', 'true', '1', 'paid', ' Paid ']) {
    assert.equal(isPaid(v), true, `expected ${JSON.stringify(v)} to be paid`);
  }
});

test('isPaid rejects unpaid / unknown forms', () => {
  for (const v of [false, 0, '', 'no', 'No', 'unpaid', 'pending', null, undefined, 'nope']) {
    assert.equal(isPaid(v), false, `expected ${JSON.stringify(v)} to be unpaid`);
  }
});

test('jobAmount prefers actual over quote when actual > 0', () => {
  assert.equal(jobAmount({ actual: 1200, quote: 1000 }), 1200);
  assert.equal(jobAmount({ actual: '1500.50', quote: '1000' }), 1500.5);
});

test('jobAmount falls back to quote when actual is missing or zero', () => {
  assert.equal(jobAmount({ quote: 1000 }), 1000);
  assert.equal(jobAmount({ actual: 0, quote: 1000 }), 1000);
  assert.equal(jobAmount({ actual: '', quote: '750' }), 750);
});

test('jobAmount is 0 for jobs with no money fields', () => {
  assert.equal(jobAmount({}), 0);
  assert.equal(jobAmount(null), 0);
});

test('sumIncome totals all jobs, and paidOnly filters to paid jobs', () => {
  const jobs = [
    { actual: 1000, quote: 900, paid: 'yes' },
    { actual: 0, quote: 500, paid: 'no' },
    { quote: 250, paid: true },
  ];
  assert.equal(sumIncome(jobs), 1750);
  assert.equal(sumIncome(jobs, { paidOnly: true }), 1250);
  assert.equal(sumIncome([]), 0);
});

// Dates typed into a date input arrive as "2026-08-02" with no timezone. JS
// parses that as UTC midnight, which in Arizona is 5pm the day before — so
// every such date on the reports screen rendered a day early.
test('asLocalDate reads a bare date as the day somebody wrote down', () => {
  const d = asLocalDate('2026-08-02');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);        // August
  assert.equal(d.getDate(), 2);         // the 2nd, not the 1st
});

test('asLocalDate leaves a full timestamp alone — that one carries its own zone', () => {
  assert.equal(asLocalDate('2026-08-02T15:30:00Z').toISOString(), '2026-08-02T15:30:00.000Z');
});

test('asLocalDate accepts a Firestore timestamp', () => {
  assert.equal(asLocalDate({ toDate: () => new Date('2026-08-02T00:00:00Z') }).getUTCDate(), 2);
});

// Money is free text in the Jobs Tracker. parseFloat reads "4200" and mangles
// everything else — this is the bug that made the paid totals wrong.
test('parseMoney reads amounts as people type them', () => {
  assert.equal(parseMoney('4200'), 4200);
  assert.equal(parseMoney('4,200'), 4200);        // parseFloat gives 4
  assert.equal(parseMoney('$4,200'), 4200);       // parseFloat gives NaN
  assert.equal(parseMoney('$12,500.50'), 12500.5); // parseFloat gives 12
  assert.equal(parseMoney(' 4200 '), 4200);
  assert.equal(parseMoney(4200), 4200);
});

test('parseMoney never returns NaN, which would poison a total', () => {
  // One unreadable amount used to turn the whole income figure into NaN.
  for (const v of ['', null, undefined, 'TBD', 'n/a', {}, NaN]) {
    assert.equal(parseMoney(v), 0, `expected 0 for ${JSON.stringify(v)}`);
  }
});

test('jobAmount prefers actual, falls back to quote, and reads commas', () => {
  assert.equal(jobAmount({ actual: '4,200', quote: '4,000' }), 4200);
  assert.equal(jobAmount({ actual: '', quote: '4,000' }), 4000);
  assert.equal(jobAmount({ actual: '0', quote: '4,000' }), 4000);
  assert.equal(jobAmount({}), 0);
});

test('sumIncome adds up amounts that carry commas', () => {
  // The reported symptom: totals far too low.
  const jobs = [
    { actual: '4,200', paid: true },
    { actual: '12,500.50', paid: true },
    { actual: '1,000', paid: false },
  ];
  assert.equal(sumIncome(jobs), 17700.5);
  assert.equal(sumIncome(jobs, { paidOnly: true }), 16700.5);
});
