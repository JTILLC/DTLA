// shared/utils/todaysLog.js
//
// Which daily log should the Current Log tab open?
//
// The old answer was "whichever one you last opened on this device", read from
// localStorage and applied regardless of age. Two ways that goes wrong:
//
//   A fresh tablet has no remembered log, so Current Log opens BLANK — an empty
//   Log Name box, on the one screen that should already know what it is.
//
//   A remembered log is opened even when it is days old. If Tuesday 3rd shift
//   is what you last had open and it is now Thursday, you land in Tuesday's log
//   and start recording Thursday's heads into it. Nothing on screen contradicts
//   you; the editor is identical. That is worse than blank, because blank makes
//   you go and find the right log, while stale looks correct and files a
//   shift's readings under the wrong date.
//
// So: open TODAY'S log automatically, and never open an older one without
// being asked. `chooseOpeningLog` returns what to do, and the caller decides
// how to say it.
//
// A note on `shift`. A log with a shift is the plant's own; a log WITHOUT one is
// a JTI service visit, which a plant may read but not edit (App.jsx derives
// readOnly from exactly that). Auto-opening a read-only record as "current"
// would put an operator in an editor that silently discards their work, so for
// a plant those are excluded from every answer here. JTI sees all of them.

// Local calendar day, not UTC. A 3rd-shift log written at 23:40 and read back
// at 00:20 are different days by the clock on the wall, and the wall is what
// the operator is going by.
export const dayKey = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export const isSameDay = (a, b) => {
  const ka = dayKey(a);
  return ka != null && ka === dayKey(b);
};

// A log this person is actually allowed to type into.
export const isEditableLog = (log, { isAdmin = false } = {}) => {
  if (!log || log.deleted) return false;
  return isAdmin ? true : !!log.shift;
};

// Newest first. `date` is an ISO string; anything unparseable sorts last rather
// than poisoning the comparison.
const byNewest = (a, b) => {
  const ta = new Date(a?.date).getTime();
  const tb = new Date(b?.date).getTime();
  return (Number.isNaN(tb) ? -Infinity : tb) - (Number.isNaN(ta) ? -Infinity : ta);
};

export const editableLogs = (logs = [], opts = {}) =>
  logs.filter((l) => isEditableLog(l, opts)).sort(byNewest);

/**
 * What Current Log should do when nothing is open yet.
 *
 * Returns one of:
 *   { action: 'open',     log }        — a log already exists for today
 *   { action: 'offer',    log }        — the newest is older; ask before opening
 *   { action: 'start' }                — this customer has no log to open at all
 *
 * `rememberedId` is the log this device last had open. It only wins when it is
 * still today's, which is what keeps a resumed session on the right record: a
 * plant running two shifts today stays in the one they were already in rather
 * than being yanked into the other shift's log by the sort order.
 */
export function chooseOpeningLog(logs = [], { now = new Date(), isAdmin = false, rememberedId = null } = {}) {
  const candidates = editableLogs(logs, { isAdmin });
  if (candidates.length === 0) return { action: 'start' };

  const today = candidates.filter((l) => isSameDay(l.date, now));
  if (today.length > 0) {
    const remembered = rememberedId && today.find((l) => l.id === rememberedId);
    return { action: 'open', log: remembered || today[0] };
  }

  return { action: 'offer', log: candidates[0] };
}

// "Sat 8/2 · 3rd Shift" — enough to recognise a log at a glance, and short
// enough to sit in a chip beside the log name.
export function logLabel(log, { now = new Date() } = {}) {
  if (!log) return '';
  const d = new Date(log.date);
  const when = Number.isNaN(d.getTime())
    ? ''
    : isSameDay(d, now)
      ? 'Today'
      : d.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
  return [when, log.shift].filter(Boolean).join(' · ');
}

// Whole days between a log and now, by calendar day rather than elapsed hours —
// a log from 23:00 yesterday is "1 day ago" at 07:00 today, not "8 hours".
export function daysOld(log, { now = new Date() } = {}) {
  const d = new Date(log?.date);
  if (Number.isNaN(d.getTime())) return null;
  const floor = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((floor(new Date(now)) - floor(d)) / 86400000);
}

export default { chooseOpeningLog, logLabel, daysOld, isSameDay, dayKey, editableLogs, isEditableLog };
