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
import { releaseBlockers } from './jobRelease.js';

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
export const boardRow = ({ sr, customer, date, job, sources, packet, visits, timesheets, closedAt } = {}, today = new Date()) => {
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
    // The Tracker document behind this row, when there is one. Only the id:
    // anything that wants to WRITE to the job (marking it paid) needs somewhere
    // to write, and the whole job object would put a second, ageing copy of it
    // on every row.
    jobId: job?.id || null,
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
    // Why this number cannot be handed back, if it cannot. Computed here so
    // the board and the packet page answer it identically, and so a row can
    // say why rather than quietly offering nothing.
    blockers: releaseBlockers({ trackerJob: job, sources, visits, timesheets }),
    // Cancelled. Kept as a row rather than dropped: a closed number can still
    // carry an unpaid invoice, and a board that silently forgets money owed is
    // worse than one showing a job nobody is working.
    closed: !!closedAt,
    closedAt: closedAt || null,
  };
};

/**
 * The board: rows grouped by what each is waiting on, in flow order.
 *
 * Finished jobs are returned separately rather than dropped — the count is
 * worth seeing, and "show me the completed ones" should not need a different
 * screen.
 */
/** A service report number as a number, for ordering. Unnumbered sorts last. */
const srValue = (r) => {
  const n = parseInt(String(r?.sr || '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : -1;
};

export const buildBoard = (inputs = [], today = new Date()) => {
  const rows = inputs.map((i) => boardRow(i, today));
  // Closed takes precedence over finished: a cancelled job is not an
  // achievement, and listing it among the completed ones would say it was.
  const closed = rows.filter((r) => r.closed);
  const live = rows.filter((r) => !r.closed);
  const open = live.filter((r) => !r.done);

  const groups = BOARD_GROUPS.map((g) => ({
    ...g,
    rows: open
      .filter((r) => r.group === g.key)
      // NEWEST FIRST, by service report number.
      //
      // This used to be longest-waiting first, on the reasoning that the
      // oldest thing in a column is the one that needs chasing. In practice
      // it buried the job you had just created: a new job has waited no time,
      // so it sorted below fifty older ones and read as missing. The number
      // counts up, so the highest is the most recent.
      //
      // Nothing is lost by this — anything genuinely overdue is already
      // singled out as `chasing`, which is where "needs attention" belongs.
      // Ordering is for finding; flags are for chasing.
      .sort((a, b) => srValue(b) - srValue(a)
        || String(b.date).localeCompare(String(a.date))),
  })).filter((g) => g.rows.length);

  return {
    groups,
    open,
    done: live.filter((r) => r.done),
    closed,
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
