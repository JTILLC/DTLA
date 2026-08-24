// Marking a job complete writes several assertions at once — including that the
// customer paid. What it will write has to be exactly what is outstanding.
import { describe, it, expect } from 'vitest';
import { completionPlan, describePlan } from './completeJob.js';

const row = (done = {}, over = {}) => ({
  sr: '2026029',
  jobId: 'job1',
  steps: [
    { key: 'created', done: done.created !== false },
    { key: 'serviceReport', done: !!done.serviceReport },
    { key: 'po', optional: true, done: false },
    { key: 'invoice', done: !!done.invoice },
    { key: 'receipts', optional: true, done: false },
    { key: 'packet', done: !!done.packet },
    { key: 'sent', done: !!done.sent },
    { key: 'paid', done: !!done.paid },
  ],
  ...over,
});

describe('what marking a job complete would write', () => {
  it('lists every outstanding required step, in flow order', () => {
    expect(completionPlan(row()).steps)
      .toEqual(['serviceReport', 'invoice', 'packet', 'sent', 'paid']);
  });

  it('leaves alone what is already true', () => {
    expect(completionPlan(row({ serviceReport: true, invoice: true, packet: true })).steps)
      .toEqual(['sent', 'paid']);
  });

  it('never writes the optional steps', () => {
    // A PO and receipts are things a job may genuinely not have; asserting
    // them would be inventing paperwork.
    const plan = completionPlan(row());
    expect(plan.steps).not.toContain('po');
    expect(plan.steps).not.toContain('receipts');
  });

  it('has nothing to do for a finished job', () => {
    const plan = completionPlan(row({ serviceReport: true, invoice: true, packet: true, sent: true, paid: true }));
    expect(plan.steps).toEqual([]);
    expect(describePlan(plan, '2026029')).toBe('2026029 is already complete.');
  });
});

describe('when it must refuse', () => {
  it('refuses a job that is not in the Tracker, and says why', () => {
    const plan = completionPlan(row({ created: false }));
    expect(plan.steps).toEqual([]);
    expect(plan.blocked).toMatch(/not in the Jobs Tracker/);
  });

  it('does everything but paid when the job has no document to write to, and says both', () => {
    // Jobs read from the archived year files have no id in the mirror.
    const plan = completionPlan(row({}, { jobId: null }));
    expect(plan.steps).toEqual(['serviceReport', 'invoice', 'packet', 'sent']);
    expect(plan.partial).toBe(true);
    expect(plan.blocked).toMatch(/archived year files/);
    // The refusal AND the list — the first version printed the reason twice
    // and never said what it would still do.
    const text = describePlan(plan, '2026029');
    expect(text).toMatch(/archived year files/);
    expect(text).toContain('packet built');
    expect(text.match(/archived year files/g)).toHaveLength(1);
  });

  it('says something sensible about nothing at all', () => {
    expect(completionPlan(null).steps).toEqual([]);
    expect(completionPlan(undefined).blocked).toBeTruthy();
  });
});

describe('the confirm somebody has to read', () => {
  it('spells out the money one in capitals', () => {
    const text = describePlan(completionPlan(row({ serviceReport: true, invoice: true, packet: true, sent: true })), '2026029');
    expect(text).toContain('PAID');
    expect(text).toContain('2026029');
  });

  it('says the report and invoice are being taken on trust', () => {
    const text = describePlan(completionPlan(row()), '2026029');
    expect(text).toContain('on your word');
  });
});
