// src/utils/jobBoard.js
//
// Every open job and where it is stuck, on one screen.
//
// The flow chart already knew this — it just only ever ran for the one job you
// had picked, so answering "what needs doing today?" meant opening jobs one at
// a time and remembering what each said. The steps are computed the same way
// here; the only new idea is grouping by the FIRST outstanding step, which is
// the thing you would actually act on.
//
// Deliberately no stored status. A job's state is derived from its files and
// its payment record every time, so the board cannot drift out of step with
// reality the way a column of hand-moved cards does.

import { jobFlowSteps, nextAction, flowProgress } from './jobFlow.js';
import { isPaid } from './format.js';

// The buckets, in the order work actually flows. The key is the step that is
// outstanding, so a job sits in the bucket named for what it is waiting on.
export const BOARD_GROUPS = [
  { key: 'created', label: 'Not in the Jobs Tracker', hint: 'Started here, never created over there' },
  { key: 'serviceReport', label: 'Waiting on the service report', hint: 'Signed and uploaded' },
  { key: 'invoice', label: 'Needs an invoice', hint: 'Raise it in the Jobs Tracker or upload it' },
  { key: 'packet', label: 'Ready to build', hint: 'Everything needed is here' },
  { key: 'sent', label: 'Built, not sent', hint: 'Waiting to go to accounts payable' },
  { key: 'paid', label: 'Sent, awaiting payment', hint: 'With the customer' },
];

/**
 * Whole days between two dates. Null when either is unreadable.
 *
 * Null and '' are rejected before they reach `new Date`, which turns both into
 * the epoch rather than an invalid date — a missing send date would otherwise
 * read as fifty-odd years overdue and sit at the top of the chase list.
 */
export const daysBetween = (from, to) => {
  if (from == null || from === '' || to == null || to === '') return null;
  const a = from instanceof Date ? from : new Date(from);
  const b = to instanceof Date ? to : new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((b - a) / 86400000);
};

// Past this, a sent packet is worth chasing. Not a rule about the customer's
// terms — just the point where "it is with them" stops being an explanation.
export const CHASE_AFTER_DAYS = 30;

/**
 * One row per job: what it is, where it is stuck, and how long it has sat.
 *
 * `input` is whatever could be gathered in bulk — the tracker job, the packet,
 * and the files the system already holds. Anything missing simply reads as a
 * step not done, which is the honest answer rather than an error.
 */
export const boardRow = ({ sr, customer, date, job, sources, packet } = {}, today = new Date()) => {
  const steps = jobFlowSteps({ job, sources, packet });
  const next = nextAction(steps);
  const progress = flowProgress(steps);

  // Age is measured from the most recent thing that happened, not from the
  // job's date: a job worked last week and invoiced yesterday is not a week
  // stale. For a sent packet it is the send, which is what you would chase on.
  const sentAt = packet?.sentAt || null;
  const waitingDays = next?.key === 'paid' && sentAt ? daysBetween(sentAt, today) : null;

  return {
    sr: String(sr),
    customer: customer || '',
    date: date || '',
    steps,
    progress,
    next,
    group: next ? next.key : 'done',
    done: !next,
    paid: isPaid(job?.paid),
    sentAt,
    waitingDays,
    // Flagged rather than sorted into its own bucket: it is still "awaiting
    // payment", it has just been awaiting it too long.
    chase: waitingDays != null && waitingDays >= CHASE_AFTER_DAYS,
  };
};

/**
 * The board: rows grouped by what each is waiting on, in flow order.
 *
 * Finished jobs are returned separately rather than dropped — the count is
 * worth seeing, and "show me the completed ones" should not need a different
 * screen.
 */
export const buildBoard = (inputs = [], today = new Date()) => {
  const rows = inputs.map((i) => boardRow(i, today));
  const open = rows.filter((r) => !r.done);

  const groups = BOARD_GROUPS.map((g) => ({
    ...g,
    rows: open
      .filter((r) => r.group === g.key)
      // Longest-waiting first inside a bucket: the oldest thing in a column is
      // almost always the one that needs attention.
      .sort((a, b) => (b.waitingDays ?? -1) - (a.waitingDays ?? -1)
        || String(a.date).localeCompare(String(b.date))),
  })).filter((g) => g.rows.length);

  return {
    groups,
    open,
    done: rows.filter((r) => r.done),
    chasing: open.filter((r) => r.chase),
    total: rows.length,
  };
};

/** One line for the top of the board: what is worth knowing before the detail. */
export const boardSummary = (board) => {
  if (!board || !board.total) return 'Nothing to show yet';
  const bits = [`${board.open.length} open`];
  if (board.chasing.length) {
    bits.push(`${board.chasing.length} unpaid over ${CHASE_AFTER_DAYS} days`);
  }
  const ready = board.groups.find((g) => g.key === 'packet');
  if (ready) bits.push(`${ready.rows.length} ready to build`);
  return bits.join(' · ');
};

export default { BOARD_GROUPS, buildBoard, boardRow, boardSummary, daysBetween, CHASE_AFTER_DAYS };
