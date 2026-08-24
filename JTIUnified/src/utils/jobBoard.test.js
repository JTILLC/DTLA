// The board answers "what needs doing today?", so the thing that matters is
// that a job lands in the bucket naming what it is actually waiting on — and
// that nothing quietly disappears from the board because a field was missing.
import { describe, it, expect } from 'vitest';
import { buildBoard, boardRow, boardSummary, daysBetween, CHASE_AFTER_DAYS } from './jobBoard.js';

const TODAY = new Date('2026-08-14T12:00:00Z');

// A job with everything done up to (but not including) `stuckAt`.
// `stuckAt: 'done'` means every step is done.
const ORDER = ['created', 'serviceReport', 'invoice', 'packet', 'sent', 'paid'];
const jobAt = (sr, stuckAt, over = {}) => {
  const stuckIdx = stuckAt === 'done' ? ORDER.length : ORDER.indexOf(stuckAt);
  const has = (step) => ORDER.indexOf(step) < stuckIdx;
  return {
    sr,
    customer: over.customer || 'Flagstone Foods',
    date: over.date || '2026-08-01',
    job: has('created') ? { paid: has('paid') ? 'Yes' : 'No' } : null,
    sources: {
      serviceReportUrl: has('serviceReport') ? 'x' : null,
      invoiceUrl: has('invoice') ? 'y' : null,
    },
    packet: {
      files: [],
      builtAt: has('packet') ? '2026-08-05' : null,
      sentAt: has('sent') ? (over.sentAt || '2026-08-06') : null,
    },
    ...over.raw,
  };
};

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-08-01', '2026-08-14')).toBe(13);
  });

  it('says nothing about an unreadable date rather than returning a number', () => {
    // A NaN here would sort to the top of the chase list and send somebody
    // after a job that is not late.
    expect(daysBetween('not a date', TODAY)).toBeNull();
    expect(daysBetween(null, TODAY)).toBeNull();
  });
});

describe('boardRow', () => {
  it('puts a job in the bucket for its first outstanding step', () => {
    expect(boardRow(jobAt('2026001', 'serviceReport'), TODAY).group).toBe('serviceReport');
    expect(boardRow(jobAt('2026002', 'invoice'), TODAY).group).toBe('invoice');
    expect(boardRow(jobAt('2026003', 'packet'), TODAY).group).toBe('packet');
    expect(boardRow(jobAt('2026004', 'sent'), TODAY).group).toBe('sent');
    expect(boardRow(jobAt('2026005', 'paid'), TODAY).group).toBe('paid');
  });

  it('marks a fully paid job done, not stuck somewhere', () => {
    const row = boardRow(jobAt('2026006', 'done'), TODAY);
    expect(row.done).toBe(true);
    expect(row.group).toBe('done');
  });

  it('ages a sent packet from when it was SENT, not from the job date', () => {
    // Worked in January, sent yesterday — that is one day of waiting, not two
    // hundred, and the difference decides whether somebody chases the customer.
    const row = boardRow(
      jobAt('2026007', 'paid', { date: '2026-01-04', sentAt: '2026-08-13' }), TODAY);
    expect(row.waitingDays).toBe(1);
    expect(row.chase).toBe(false);
  });

  it('flags one that has been out too long', () => {
    const row = boardRow(jobAt('2026008', 'paid', { sentAt: '2026-06-01' }), TODAY);
    expect(row.waitingDays).toBeGreaterThanOrEqual(CHASE_AFTER_DAYS);
    expect(row.chase).toBe(true);
  });

  it('does not age a job that is not waiting on payment', () => {
    // "Built, not sent" has no send date to count from; a number here would be
    // measuring the wrong thing.
    expect(boardRow(jobAt('2026009', 'sent'), TODAY).waitingDays).toBeNull();
  });

  it('shows a job started here but never created in the tracker', () => {
    const row = boardRow({ sr: '2026028', customer: 'SunTree' }, TODAY);
    expect(row.group).toBe('created');
  });

  it('survives a job with nothing on it at all', () => {
    // Missing data must read as "not done", never as an exception that takes
    // the whole board down with it.
    expect(() => boardRow({}, TODAY)).not.toThrow();
    expect(boardRow({}, TODAY).sr).toBe('undefined');
  });
});

describe('buildBoard', () => {
  const inputs = [
    jobAt('2026001', 'invoice'),
    jobAt('2026002', 'invoice'),
    jobAt('2026003', 'packet'),
    jobAt('2026004', 'paid', { sentAt: '2026-06-01' }),   // 74 days — chase
    jobAt('2026005', 'paid', { sentAt: '2026-08-13' }),   // 1 day
    jobAt('2026006', 'done'),
  ];

  it('groups the open jobs and keeps the finished ones separate', () => {
    const board = buildBoard(inputs, TODAY);
    expect(board.open).toHaveLength(5);
    expect(board.done).toHaveLength(1);
    expect(board.groups.map((g) => g.key)).toEqual(['invoice', 'packet', 'paid']);
  });

  it('drops empty buckets rather than showing a column of nothing', () => {
    const board = buildBoard([jobAt('2026001', 'invoice')], TODAY);
    expect(board.groups).toHaveLength(1);
  });

  // Was "longest wait first". That buried a job the moment it was created —
  // a new job has waited no time, so it sorted below every older one and read
  // as though it had never been made. Chasing is what `chasing` is for.
  it('puts the newest number at the top of its bucket', () => {
    const board = buildBoard(inputs, TODAY);
    const waiting = board.groups.find((g) => g.key === 'paid');
    expect(waiting.rows.map((r) => r.sr)).toEqual(['2026005', '2026004']);
  });

  it('still singles out what is worth chasing, whatever the order', () => {
    const board = buildBoard(inputs, TODAY);
    expect(board.chasing.map((r) => r.sr)).toEqual(['2026004']);
  });

  it('collects everything worth chasing, across buckets', () => {
    expect(buildBoard(inputs, TODAY).chasing.map((r) => r.sr)).toEqual(['2026004']);
  });

  it('handles an empty list', () => {
    const board = buildBoard([], TODAY);
    expect(board.groups).toEqual([]);
    expect(board.total).toBe(0);
  });
});

describe('boardSummary', () => {
  it('leads with what is worth knowing', () => {
    const board = buildBoard([
      jobAt('2026001', 'packet'),
      jobAt('2026004', 'paid', { sentAt: '2026-06-01' }),
    ], TODAY);
    expect(boardSummary(board)).toBe('2 open · 1 unpaid over 30 days · 1 ready to build');
  });

  it('says so plainly when there is nothing', () => {
    expect(boardSummary(buildBoard([], TODAY))).toBe('Nothing to show yet');
    expect(boardSummary(null)).toBe('Nothing to show yet');
  });
});

describe('a closed number', () => {
  // Closing says the job is not happening. It was already dropped from the
  // timesheet and CCW pickers; the board never asked, so a cancelled job kept
  // a row on "what needs doing" forever.
  const closed = (sr, stuckAt) => ({ ...jobAt(sr, stuckAt), closedAt: '2026-08-13T10:00:00Z' });

  it('is flagged on the row', () => {
    expect(boardRow(closed('2026031', 'serviceReport'), TODAY).closed).toBe(true);
    expect(boardRow(jobAt('2026032', 'serviceReport'), TODAY).closed).toBe(false);
  });

  it('leaves the open list and its bucket', () => {
    const board = buildBoard([closed('2026031', 'serviceReport'), jobAt('2026032', 'serviceReport')], TODAY);
    expect(board.open.map((r) => r.sr)).toEqual(['2026032']);
    expect(board.groups.flatMap((g) => g.rows.map((r) => r.sr))).toEqual(['2026032']);
  });

  it('is kept and reachable rather than dropped — it may still owe money', () => {
    const board = buildBoard([closed('2026031', 'paid')], TODAY);
    expect(board.closed.map((r) => r.sr)).toEqual(['2026031']);
    expect(board.total).toBe(1);
  });

  it('is not counted as finished, however far through it got', () => {
    // A cancelled job is not an achievement, and listing it among the
    // completed ones would say it was.
    const board = buildBoard([closed('2026031', 'done')], TODAY);
    expect(board.done).toEqual([]);
    expect(board.closed).toHaveLength(1);
  });

  it('never appears in the chase list, even when it is long overdue', () => {
    // Sent well past CHASE_AFTER_DAYS, so this would certainly be chased if
    // closing did not take it out — which is what makes the assertion mean
    // something. The control case proves the setup is actually overdue.
    const longAgo = { sentAt: '2026-06-01' };
    const stillOpen = jobAt('2026032', 'paid', longAgo);
    expect(buildBoard([stillOpen], TODAY).chasing.map((r) => r.sr)).toEqual(['2026032']);

    const cancelled = { ...jobAt('2026031', 'paid', longAgo), closedAt: '2026-08-13T10:00:00Z' };
    expect(buildBoard([cancelled], TODAY).chasing).toEqual([]);
  });

  it('counts as open again once reopened', () => {
    const board = buildBoard([{ ...jobAt('2026031', 'serviceReport'), closedAt: null }], TODAY);
    expect(board.open.map((r) => r.sr)).toEqual(['2026031']);
    expect(board.closed).toEqual([]);
  });
});
