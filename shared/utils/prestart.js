// shared/utils/prestart.js
//
// "Has this line been checked today?"
//
// The one question the pre-start page exists to answer, and the reason it shows
// a line-by-line board rather than a list of past submissions: an operator
// arriving for a shift needs to know what still needs walking, not what was
// done last Tuesday.
//
// Day boundaries are LOCAL calendar days, matching shared/utils/todaysLog.js. A
// 3rd-shift check signed at 23:50 and read back at 00:10 belong to different
// days by the clock on the wall, and the wall is what the operator goes by.

import { isSameDay } from './todaysLog.js';

export const RESULTS = ['ok', 'issue', 'na'];

// Newest first; unparseable timestamps sort last rather than winning.
const byNewest = (a, b) => {
  const ta = new Date(a?.performedAt).getTime();
  const tb = new Date(b?.performedAt).getTime();
  return (Number.isNaN(tb) ? -Infinity : tb) - (Number.isNaN(ta) ? -Infinity : ta);
};

/**
 * The most recent check for each line, and whether it was today.
 *
 * Returns [{ lineTitle, entry, doneToday }] in the order the lines were given,
 * so the board reads in the same order as everything else in the app.
 */
export function boardFor(lines = [], entries = [], now = new Date()) {
  const byLine = new Map();
  [...entries].sort(byNewest).forEach((e) => {
    const t = String(e?.lineTitle ?? '').trim();
    if (!t || byLine.has(t)) return;   // sorted newest-first, so the first is the latest
    byLine.set(t, e);
  });
  return (lines || []).map((l) => {
    const lineTitle = typeof l === 'string' ? l : String(l?.title ?? '');
    const entry = byLine.get(lineTitle) || null;
    return {
      lineTitle,
      entry,
      doneToday: !!entry && isSameDay(entry.performedAt, now),
    };
  });
}

export const outstandingLines = (board = []) => board.filter((b) => !b.doneToday).map((b) => b.lineTitle);

// A check is "clear" when nothing was marked as a problem. N/A is not a problem
// — an item that does not apply to this machine is a legitimate answer, and
// counting it as a fault would train people to tick OK instead.
export const issueCount = (entry) =>
  (entry?.items || []).filter((i) => i.result === 'issue').length;

/**
 * Turn the filled-in answers into what gets stored.
 *
 * Labels are COPIED into the submission rather than referenced by id, for the
 * same reason the PM log does it: templates get edited, items get reworded and
 * removed, and a signed check has to keep meaning what it meant on the day.
 */
export function buildSubmission({ items = [], answers = {}, notes = {}, photos = {} }) {
  return items.map((it) => ({
    label: it.label,
    type: it.type || 'check',
    ...(it.imageUrl ? { imageUrl: it.imageUrl } : {}),
    result: it.type === 'value' ? '' : (answers[it.id] || ''),
    value: it.type === 'value' ? (answers[it.id] || '') : '',
    note: notes[it.id] || '',
    // Only the paths. A resolved broker URL is short-lived and storing one
    // would leave the record pointing at a link that expires.
    photos: (photos[it.id] || []).map((ph) => ({ path: ph.path })),
  }));
}

// Every photo on a submission, with the item it belongs to — for the views that
// show a check at a glance rather than item by item.
export const allPhotos = (entry) =>
  (entry?.items || []).flatMap((i) => (i.photos || []).map((p) => ({ ...p, label: i.label })));

export const photoCount = (entry) => allPhotos(entry).length;

// Every check item answered? `value` items are free readings and may be blank —
// requiring them would stop a shift over a box that has nothing to put in it.
export const unanswered = (items = [], answers = {}) =>
  items.filter((it) => (it.type || 'check') === 'check' && !answers[it.id]);

export default { boardFor, outstandingLines, issueCount, buildSubmission, unanswered, allPhotos, photoCount, RESULTS };
