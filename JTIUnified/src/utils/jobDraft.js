// src/utils/jobDraft.js
//
// What a new job needs before it is worth handing a number to.
//
// The number is the expensive part. Once it is reserved it appears in the
// timesheet picker, on CCW's service report field and in the Jobs tracker, and
// it can never be quietly reused — so it is worth being sure the record is
// coherent before it goes out, rather than pushing a half-filled job into three
// other apps and correcting it in each.
//
// Checks only what would be WRONG, not what is merely blank. An address nobody
// has typed yet is normal; an end date before the start date is not.

/** Trim, and treat whitespace-only as empty. */
const clean = (v) => String(v ?? '').trim();

/**
 * A draft, tidied into the shape that gets stored.
 *
 * `date` is kept alongside `dateStart` and set to the same value: the timesheet
 * app, CCW and the packet page all read `date` already, and a field that
 * silently changed meaning would break them without any error to follow.
 */
export const normalizeDraft = (draft = {}) => {
  const dateStart = clean(draft.dateStart);
  const dateEnd = clean(draft.dateEnd);
  return {
    sr: clean(draft.sr).toUpperCase(),
    customer: clean(draft.customer),
    address: clean(draft.address),
    city: clean(draft.city),
    state: clean(draft.state).toUpperCase(),
    dateStart,
    // An end date equal to the start is a one-day job; storing it adds nothing
    // and makes every consumer decide whether to show "3 Aug – 3 Aug".
    dateEnd: dateEnd && dateEnd !== dateStart ? dateEnd : '',
    date: dateStart,
    description: clean(draft.description),
  };
};

/**
 * Why this draft cannot be saved yet. Empty array means it can.
 *
 * Returns every problem at once. Revealing them one at a time turns a form into
 * a guessing game.
 */
export const draftProblems = (draft = {}) => {
  const d = normalizeDraft(draft);
  const problems = [];

  if (!d.sr) problems.push('No service report number — reload to take the next one.');
  else if (!/^\d{4}\d{3}/.test(d.sr)) problems.push(`"${d.sr}" is not a service report number. They look like 2026028.`);

  if (!d.customer) problems.push('Which customer is this for?');

  if (d.dateEnd && d.dateStart && d.dateEnd < d.dateStart) {
    problems.push('The end date is before the start date.');
  }
  if (d.state && !/^[A-Z]{2}$/.test(d.state)) {
    problems.push('State should be two letters, like AZ.');
  }
  return problems;
};

/** How the date range reads on one line. */
export const describeRange = (draft = {}) => {
  const { dateStart, dateEnd } = normalizeDraft(draft);
  if (!dateStart) return '';
  if (!dateEnd) return dateStart;
  return `${dateStart} → ${dateEnd}`;
};

export default { normalizeDraft, draftProblems, describeRange };
