// shared/utils/pmFrequency.js
//
// How often a PM section is meant to be run, and whether it is due.
//
// The PM log used to be ONE checklist submitted whole, with the interval typed
// in by whoever happened to be filling it in. Frequency existed only as a word
// in a section title — "Weekly checks" — which the app never read. So a plant
// that ran its daily walk-round marked the annual load-cell certification as
// done at the same time, and the next-due date for everything moved to whatever
// number was in the box.
//
// Now each section carries a frequency, and a submission covers ONE frequency.
// Daily, weekly, monthly, quarterly and annual each keep their own last-done
// and their own next-due, so finishing the dailies says nothing about the
// monthlies.
//
// Nothing here talks to Firestore and nothing here formats a due date: this
// module answers "which bucket, and when next", and `dueStatus` in
// services/logs.js turns a next-due into words. One definition of overdue,
// used by the PM page and the Overview alike.

// Ordered shortest-first, which is the order they are shown in and the order a
// shift meets them in.
export const FREQUENCIES = [
  { key: 'daily', label: 'Daily', days: 1, signOff: false },
  { key: 'weekly', label: 'Weekly', days: 7, signOff: false },
  { key: 'monthly', label: 'Monthly', days: 30, signOff: true },
  { key: 'quarterly', label: 'Quarterly', days: 90, signOff: true },
  { key: 'annually', label: 'Annually', days: 365, signOff: true },
  // Kept deliberately: a plant always has checks that are real but not on a
  // clock — "after a product changeover", "when a head is rebuilt". Forcing
  // those onto an interval would make the whole board cry overdue about work
  // nobody was ever meant to do on a schedule.
  { key: 'asneeded', label: 'As needed', days: null, signOff: false },
];

export const FREQ_BY_KEY = Object.fromEntries(FREQUENCIES.map((f) => [f.key, f]));

export const FREQ_ORDER = FREQUENCIES.map((f) => f.key);

export const isFrequency = (key) => Object.hasOwn(FREQ_BY_KEY, key);

export const labelOf = (key) => FREQ_BY_KEY[key]?.label || 'Unscheduled';

/** Long-interval checks are the ones an auditor asks about, so they get a signature. */
export const needsSignOff = (key) => !!FREQ_BY_KEY[key]?.signOff;

// Titles written before the field existed. Every checklist in the wild groups
// by interval already — the Ishida preset ships that way — so reading the title
// means an existing plant gets a working board without anyone re-typing their
// checklist first. Only ever a fallback: an explicit `frequency` always wins.
const TITLE_HINTS = [
  [/\bdail(y|ies)\b|\beach shift\b|\bevery shift\b/i, 'daily'],
  [/\bweek(ly)?\b/i, 'weekly'],
  [/\bmonth(ly)?\b/i, 'monthly'],
  [/\bquarter(ly)?\b/i, 'quarterly'],
  [/\b(annual(ly)?|year(ly)?)\b/i, 'annually'],
];

/** The frequency a section runs on. Explicit field, else its title, else as-needed. */
export function frequencyOf(section) {
  const explicit = section?.frequency;
  if (isFrequency(explicit)) return explicit;
  const title = String(section?.title ?? '');
  // Shortest interval wins when a title names two — "Monthly / quarterly" reads
  // as monthly. Guessing the shorter one means the worst case is a plant being
  // asked to run a check more often than it strictly must; guessing the longer
  // one means a check silently going unrun. ("Quarterly" alone is unambiguous:
  // it contains no "month".)
  for (const [re, key] of TITLE_HINTS) if (re.test(title)) return key;
  return 'asneeded';
}

// Entries submitted before this existed carry only the interval that was typed
// in. Mapping the ones that line up with a real interval keeps a plant's
// history in the right bucket instead of dumping years of checks into
// "unscheduled" — and 30 was the box's default, so most of them are monthlies.
const DAYS_TO_KEY = new Map([
  [1, 'daily'], [7, 'weekly'],
  [30, 'monthly'], [31, 'monthly'],
  [90, 'quarterly'], [91, 'quarterly'],
  [365, 'annually'], [366, 'annually'],
]);

/**
 * Which bucket a submitted entry belongs to.
 *
 * `unscheduled` rather than a guess when there is nothing to go on: a check
 * filed with a 45-day interval was somebody's own arrangement, and quietly
 * calling it monthly would misreport when it is next due.
 */
export function bucketOf(entry) {
  const explicit = entry?.frequency;
  if (isFrequency(explicit)) return explicit;
  const days = Number(entry?.intervalDays);
  if (Number.isFinite(days) && DAYS_TO_KEY.has(days)) return DAYS_TO_KEY.get(days);
  return 'unscheduled';
}

/** When a check of this frequency falls due again. Null when it is not on a clock. */
export function nextDueFor(key, fromISO = null) {
  const days = FREQ_BY_KEY[key]?.days;
  if (!days) return null;
  const from = fromISO ? new Date(fromISO) : new Date();
  if (Number.isNaN(from.getTime())) return null;
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** The frequencies this checklist actually uses, shortest interval first. */
export function frequenciesPresent(sections = []) {
  const used = new Set((sections || []).map(frequencyOf));
  return FREQ_ORDER.filter((k) => used.has(k));
}

/** The sections to show when running one frequency's checks. */
export function sectionsFor(sections = [], key) {
  return (sections || []).filter((s) => frequencyOf(s) === key);
}

const newestFirst = (a, b) => {
  const ta = new Date(a?.performedAt).getTime();
  const tb = new Date(b?.performedAt).getTime();
  return (Number.isNaN(tb) ? -Infinity : tb) - (Number.isNaN(ta) ? -Infinity : ta);
};

/** A check filed against no particular line. Empty string is the stored value. */
export const WHOLE_PLANT = '';

/**
 * The latest entry of one frequency for each line.
 *
 * EVERY PM check is run per line — "has Line 3 had its daily?" is the question,
 * and one line's walk-round says nothing about another's. That holds for the
 * monthly and the annual too: a monthly done on Line 2 is not a monthly done on
 * Line 1.
 *
 * The no-line row is included only when it is real, and it means one of two
 * things. Either the plant's lines are not on record yet, in which case it is
 * the only way to record work at all and the app must not refuse it — or there
 * are checks filed before the line became required, which are genuine work and
 * stay readable, but which the UI shows as history rather than as a button.
 */
export function lineBoardFor(entries = [], key, lineTitles = []) {
  const latest = new Map();
  [...(entries || [])]
    .filter((e) => bucketOf(e) === key)
    .sort(newestFirst)
    .forEach((e) => {
      const k = e?.lineTitle || WHOLE_PLANT;
      if (!latest.has(k)) latest.set(k, e);      // sorted, so the first is the newest
    });

  const row = (lineTitle) => {
    const last = latest.get(lineTitle) || null;
    return { lineTitle, last, nextDueAt: last?.nextDueAt ?? null };
  };

  const rows = (lineTitles || []).map(row);
  if (latest.has(WHOLE_PLANT) || !(lineTitles || []).length) rows.unshift(row(WHOLE_PLANT));
  return rows;
}

/**
 * One row per frequency the checklist uses: what it covers, when it was last
 * done, when it is next due, and the same broken down per line.
 *
 * Deliberately returns `nextDueAt` rather than a due label. A frequency that
 * has never been run returns null, which `dueStatus` reads as "no schedule" —
 * NOT as overdue. On the day this ships every plant has an empty history for
 * every bucket, and a board that opened shouting five overdue checks at a plant
 * that is perfectly up to date would be worse than the problem it fixes.
 *
 * `lineTitle` narrows the headline figures to one line's history; omit it and
 * the headline is the newest check of that frequency on any line, with
 * `byLine` carrying the detail.
 */
export function boardFor(sections = [], entries = [], { lineTitle = null, lineTitles = [] } = {}) {
  const relevant = (entries || []).filter(
    (e) => lineTitle == null || (e?.lineTitle || '') === lineTitle,
  );
  const latest = new Map();
  [...relevant].sort(newestFirst).forEach((e) => {
    const key = bucketOf(e);
    if (!latest.has(key)) latest.set(key, e);   // sorted, so the first is the newest
  });

  return frequenciesPresent(sections).map((key) => {
    const last = latest.get(key) || null;
    return {
      key,
      label: labelOf(key),
      signOff: needsSignOff(key),
      sections: sectionsFor(sections, key),
      last,
      // Read from the entry, not recomputed, so changing an interval later
      // never silently rewrites when a check already filed was next due.
      nextDueAt: last?.nextDueAt ?? null,
      awaitingSignOff: !!last && needsSignOff(key) && !last.supervisorSignedBy,
      byLine: lineBoardFor(relevant, key, lineTitles),
    };
  });
}

export default {
  FREQUENCIES, FREQ_BY_KEY, FREQ_ORDER, isFrequency, labelOf, needsSignOff,
  frequencyOf, bucketOf, nextDueFor, frequenciesPresent, sectionsFor,
  boardFor, lineBoardFor, WHOLE_PLANT,
};
