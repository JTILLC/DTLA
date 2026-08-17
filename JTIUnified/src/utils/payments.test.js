// What has actually been received against a job.
//
// The risk in changing what "paid" means is the history: nearly every job on
// record has a checkbox and no payment rows, and reading those as unpaid would
// wipe years of income off the dashboard in one deploy.
import { describe, it, expect } from 'vitest';
import { paymentState, receivedTotal, isSettled, describePayments, sumIncome } from './payments.js';

describe('the checkbox, which is what the history has', () => {
  it('reads a ticked job as paid in full', () => {
    const s = paymentState({ paid: true }, 4200);
    expect(s.status).toBe('paid');
    expect(s.received).toBe(4200);
    expect(s.outstanding).toBe(0);
    expect(s.fromCheckbox).toBe(true);
  });

  it('reads an unticked job as owing the whole amount', () => {
    const s = paymentState({ paid: false }, 4200);
    expect(s.status).toBe('unpaid');
    expect(s.outstanding).toBe(4200);
  });

  it('accepts the several ways paid has been written', () => {
    ['Yes', 'yes', true, 1, '1', 'true', 'PAID'].forEach((v) => {
      expect(paymentState({ paid: v }, 100).status).toBe('paid');
    });
  });
});

describe('recorded payments', () => {
  const job = (payments) => ({ paid: false, payments });

  it('adds up what came in', () => {
    expect(receivedTotal(job([{ amount: '1,000' }, { amount: '$2,500.50' }]))).toBe(3500.5);
  });

  it('calls a job paid when the payments cover it', () => {
    const s = paymentState(job([{ amount: '4200', date: '2026-08-10' }]), 4200);
    expect(s.status).toBe('paid');
    expect(s.outstanding).toBe(0);
    expect(s.lastPaymentDate).toBe('2026-08-10');
  });

  it('calls a short payment PART paid — the case a checkbox cannot express', () => {
    const s = paymentState(job([{ amount: '4000', date: '2026-08-10' }]), 4200);
    expect(s.status).toBe('partial');
    expect(s.received).toBe(4000);
    expect(s.outstanding).toBe(200);
  });

  it('adds several payments together', () => {
    const s = paymentState(job([
      { amount: '2000', date: '2026-07-01' },
      { amount: '2200', date: '2026-08-10' },
    ]), 4200);
    expect(s.status).toBe('paid');
    expect(s.lastPaymentDate).toBe('2026-08-10');
  });

  it('does not report an overpayment as money still owed', () => {
    const s = paymentState(job([{ amount: '5000' }]), 4200);
    expect(s.outstanding).toBe(0);
    expect(s.received).toBe(5000);
  });

  it('forgives a penny, which is rounding, not a short payment', () => {
    expect(paymentState(job([{ amount: '4199.995' }]), 4200).status).toBe('paid');
    expect(paymentState(job([{ amount: '4100' }]), 4200).status).toBe('partial');
  });

  it('lets the payments overrule a stale checkbox', () => {
    // Ticked as paid, then a partial payment recorded. The money is the truth.
    const s = paymentState({ paid: true, payments: [{ amount: '1000' }] }, 4200);
    expect(s.status).toBe('partial');
    expect(s.outstanding).toBe(3200);
  });

  it('ignores blank rows left by a half-filled form', () => {
    expect(paymentState(job([{}, { amount: '', date: '' }, { amount: '4200' }]), 4200).received).toBe(4200);
  });

  it('survives junk', () => {
    expect(() => paymentState({ payments: 'nonsense' }, 100)).not.toThrow();
    expect(() => paymentState(null, 100)).not.toThrow();
    expect(paymentState({ payments: null }, 100).status).toBe('unpaid');
  });
});

describe('isSettled', () => {
  it('is what the income totals should count', () => {
    expect(isSettled({ paid: true }, 4200)).toBe(true);
    expect(isSettled({ payments: [{ amount: '4200' }] }, 4200)).toBe(true);
    expect(isSettled({ payments: [{ amount: '4000' }] }, 4200)).toBe(false);
    expect(isSettled({ paid: false }, 4200)).toBe(false);
  });
});

describe('describePayments', () => {
  it('says which of the three states a job is in', () => {
    expect(describePayments(paymentState({ paid: true }, 4200))).toBe('Paid');
    expect(describePayments(paymentState({ paid: false }, 4200))).toBe('Unpaid');
    expect(describePayments(paymentState({ payments: [{ amount: '4000' }] }, 4200)))
      .toMatch(/Part paid.*4,000.*4,200/);
  });
});

describe('closed jobs', () => {
  it('are left out of the income, both totals', () => {
    // Cancelled after a number was spent. Not income, and never will be.
    const jobs = [
      { actual: '1000', paid: true },
      { actual: '5000', paid: true, closedAt: '2026-08-01T00:00:00Z' },
    ];
    expect(sumIncome(jobs)).toBe(1000);
    expect(sumIncome(jobs, { paidOnly: true })).toBe(1000);
  });
});
