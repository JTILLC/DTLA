import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPaid, jobAmount, sumIncome } from './format.js';

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
