// Numbering and the flow. Handing out a service report number that is already
// in use is the expensive mistake here: two jobs under one number cannot be
// told apart afterwards by any of the four systems that key on it.
import { describe, it, expect } from 'vitest';
import {
  nextServiceReportNumber, jobFlowSteps, nextAction, flowProgress, yearOf, sequenceOf,
} from './jobFlow.js';

describe('nextServiceReportNumber', () => {
  it('follows the highest number in use', () => {
    expect(nextServiceReportNumber(['2026024', '2026027', '2026011'], 2026)).toBe('2026028');
  });

  it('pads to three digits', () => {
    expect(nextServiceReportNumber(['2026001'], 2026)).toBe('2026002');
    expect(nextServiceReportNumber([], 2026)).toBe('2026001');
  });

  it('NEVER fills a gap — a skipped number is usually still spoken for', () => {
    // 2026002..2026026 missing, but the next one is 28, not 2.
    expect(nextServiceReportNumber(['2026001', '2026027'], 2026)).toBe('2026028');
  });

  it('ignores other years', () => {
    expect(nextServiceReportNumber(['2025099', '2026003'], 2026)).toBe('2026004');
    expect(nextServiceReportNumber(['2025099'], 2026)).toBe('2026001');
  });

  it('counts a suffixed follow-up visit as its base number, not a new one', () => {
    // 2026014LF1 is a second visit on job 14 — it must not push the next to 15
    // when 14 is the highest, nor claim a number of its own.
    expect(nextServiceReportNumber(['2026014', '2026014LF1'], 2026)).toBe('2026015');
  });

  it('accepts objects as well as strings', () => {
    expect(nextServiceReportNumber([{ number: '2026024' }, { sr: '2026025' }], 2026)).toBe('2026026');
  });

  it('is not derailed by junk', () => {
    expect(nextServiceReportNumber(['', null, 'ABC', { }], 2026)).toBe('2026001');
  });
});

describe('yearOf / sequenceOf', () => {
  it('splits a number into its parts', () => {
    expect(yearOf('2026024')).toBe(2026);
    expect(sequenceOf('2026024')).toBe(24);
    expect(sequenceOf('2026014LF1')).toBe(14);
  });

  it('says nothing about nothing', () => {
    expect(yearOf('')).toBeNull();
    expect(sequenceOf('nope')).toBeNull();
  });
});

describe('jobFlowSteps', () => {
  const steps = (over) => jobFlowSteps(over);
  const keys = (s) => s.filter((x) => x.done).map((x) => x.key);

  it('a brand new job has nothing done', () => {
    expect(keys(steps({}))).toEqual([]);
  });

  it('reads each step from real data rather than a stored tick', () => {
    const s = steps({
      job: { paid: 'Yes' },
      sources: { serviceReportUrl: 'x', invoiceUrl: 'y' },
      packet: { files: [{ kind: 'po' }, { kind: 'receipts' }], builtAt: 'now', sentAt: 'now' },
    });
    expect(keys(s)).toEqual(['created', 'serviceReport', 'po', 'invoice', 'receipts', 'packet', 'sent', 'paid']);
  });

  // Not every customer issues a purchase order, so the step could never be
  // ticked on those jobs and they read as unfinished forever. Saying "no PO
  // here" settles it — without claiming a purchase order exists.
  it('counts a PO marked not applicable as settled, and says it is not one', () => {
    const s = steps({ packet: { files: [], poNotApplicable: true } });
    const po = s.find((x) => x.key === 'po');
    expect(po.done).toBe(true);
    expect(po.na).toBe(true);
  });

  it('counts receipts marked not applicable as settled too', () => {
    const s = steps({ packet: { files: [], receiptsNotApplicable: true } });
    const r = s.find((x) => x.key === 'receipts');
    expect(r.done).toBe(true);
    expect(r.na).toBe(true);
  });

  it('an actual PO is done but never flagged not-applicable', () => {
    const s = steps({ packet: { files: [{ kind: 'po' }], poNotApplicable: true } });
    const po = s.find((x) => x.key === 'po');
    expect(po.done).toBe(true);
    expect(po.na).toBe(false);
  });

  // A report filed in CCW under another number, or an invoice raised in the
  // accounting package: the work is done, only the evidence is out of reach.
  it('lets the service report and invoice be ticked by hand, and says so', () => {
    const s = steps({ packet: { files: [], manualSteps: { serviceReport: true, invoice: true } } });
    const sr = s.find((x) => x.key === 'serviceReport');
    const inv = s.find((x) => x.key === 'invoice');
    expect([sr.done, sr.byHand]).toEqual([true, true]);
    expect([inv.done, inv.byHand]).toEqual([true, true]);
  });

  it('a real file is never reported as taken on somebody\'s word', () => {
    const s = steps({
      sources: { serviceReportUrl: 'x' },
      packet: { files: [{ kind: 'invoice' }], manualSteps: { serviceReport: true, invoice: true } },
    });
    expect(s.find((x) => x.key === 'serviceReport').byHand).toBe(false);
    expect(s.find((x) => x.key === 'invoice').byHand).toBe(false);
  });

  it('accepts uploaded files as satisfying a step, not just system ones', () => {
    const s = steps({ packet: { files: [{ kind: 'serviceReport' }, { kind: 'invoice' }] } });
    expect(keys(s)).toEqual(expect.arrayContaining(['serviceReport', 'invoice']));
  });

  it('agrees with the definition the income totals use', () => {
    // Deliberately the same predicate as the money — a flow chart that
    // disagrees with the paid figure beside it makes both suspect.
    ['Yes', 'yes', true, 'PAID', 1, '1', 'true'].forEach((paid) => {
      expect(steps({ job: { paid } }).find((x) => x.key === 'paid').done).toBe(true);
    });
    ['No', '', null, undefined, 'unpaid'].forEach((paid) => {
      expect(steps({ job: { paid } }).find((x) => x.key === 'paid').done).toBe(false);
    });
  });

  it('marks PO and receipts optional — not every job has either', () => {
    const s = steps({});
    expect(s.find((x) => x.key === 'po').optional).toBe(true);
    expect(s.find((x) => x.key === 'receipts').optional).toBe(true);
    expect(s.find((x) => x.key === 'invoice').optional).toBeUndefined();
  });
});

describe('nextAction', () => {
  it('names the first required step still outstanding', () => {
    const s = jobFlowSteps({ job: {}, sources: { serviceReportUrl: 'x' } });
    expect(nextAction(s).key).toBe('invoice');
  });

  it('skips optional steps when deciding what is next', () => {
    const s = jobFlowSteps({ job: {}, sources: { serviceReportUrl: 'x', invoiceUrl: 'y' } });
    expect(nextAction(s).key).toBe('packet'); // not 'po' or 'receipts'
  });

  it('is null when everything required is done', () => {
    const s = jobFlowSteps({
      job: { paid: true },
      sources: { serviceReportUrl: 'x', invoiceUrl: 'y' },
      packet: { files: [], builtAt: 'n', sentAt: 'n' },
    });
    expect(nextAction(s)).toBeNull();
  });
});

describe('flowProgress', () => {
  it('counts only required steps, so a job with no PO can still reach 100%', () => {
    const s = jobFlowSteps({
      job: { paid: true },
      sources: { serviceReportUrl: 'x', invoiceUrl: 'y' },
      packet: { files: [], builtAt: 'n', sentAt: 'n' },
    });
    expect(flowProgress(s)).toEqual({ done: 6, total: 6, pct: 100 });
  });

  it('starts at zero', () => {
    expect(flowProgress(jobFlowSteps({})).pct).toBe(0);
  });
});
