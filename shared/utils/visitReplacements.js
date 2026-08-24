// shared/utils/visitReplacements.js
//
// Which replacements belong on a visit's report.
//
// The replacement log is customer-level and dated; a visit is a record with its
// own date. Nothing joins them, so the report has to decide — and the obvious
// answer is wrong twice over:
//
//   By the visit's DAY. A service call runs over several days and the parts go
//   on during it, so day-matching finds nothing on real data: a visit opened on
//   the 25th, its parts logged on the 30th.
//
//   By everything since. That puts a later call's work on an earlier call's
//   report, which is the kind of error a customer notices when they are billed.
//
// So: from when this visit was opened until the NEXT visit was. Anything logged
// in that window was logged while this visit was the open one, which is as
// close to "during this visit" as records that were never linked can get. The
// newest visit has no next, so its window stays open.
import { partLines } from './partLines.js';

const at = (value) => {
  if (value == null || value === '') return null;
  const d = value?.toDate ? value.toDate() : new Date(value);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * The window for a visit, given the customer's visits newest-first.
 * `to` is null for the newest visit — nothing has superseded it.
 */
export function visitWindow(visits = [], visitId = null) {
  const idx = (visits || []).findIndex((v) => v?.id === visitId);
  if (idx === -1) return null;
  return {
    from: visits[idx]?.date || null,
    to: idx > 0 ? (visits[idx - 1]?.date || null) : null,
  };
}

/** Replacements on one line, inside one visit's window. */
export function replacementsForVisit(replacements = [], { lineTitle, window: w } = {}) {
  const from = at(w?.from);
  // No window means no visit is open. Say nothing rather than print every
  // replacement this plant has ever had on one report.
  if (from == null) return [];
  const to = at(w?.to);

  return (replacements || []).filter((r) => {
    if (!r || r.lineTitle !== lineTitle) return false;
    const when = at(r.performedAt);
    return when != null && when >= from && (to == null || when < to);
  });
}

/**
 * One entry as table rows — a row per part, with the head and reason on the
 * first only.
 *
 * Repeating the head down a five-part list reads as five separate jobs, which
 * is the opposite of what a reader needs: these came off one head, together.
 */
export function replacementRows(entry, notABoard = 'Part (not a board)') {
  const where = entry?.headNumber == null ? 'Machine' : `Head ${entry.headNumber}`;
  const what = entry?.boardType === notABoard ? '' : (entry?.boardType || '');
  const parts = partLines(entry);
  if (!parts.length) return [[where, what, '—', '', entry?.reason || '']];
  return parts.map((p, i) => [
    i === 0 ? where : '',
    i === 0 ? what : '',
    [p.partNumber, p.partName].filter(Boolean).join(' · '),
    String(p.qty > 1 ? p.qty : 1),
    i === 0 ? (entry?.reason || '') : '',
  ]);
}

export default { visitWindow, replacementsForVisit, replacementRows };
