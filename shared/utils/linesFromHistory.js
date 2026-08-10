// shared/utils/linesFromHistory.js
//
// Rebuild a plant's lines from what it has logged before.
//
// A plant that has been running for months already told us its lines — every
// previous log names them, with their head counts. Making somebody retype
// "Line 1 … Line 4, fourteen heads each" on a fresh log is asking them for
// information the app is already holding.
//
// Titles are the identity. Head history is matched across records by line
// TITLE, so a line rebuilt under the same name inherits its own past; one
// rebuilt under a new name starts from nothing, which is why this copies the
// names exactly rather than tidying them.
import { scaffoldLinesFrom } from './headHelpers.js';

const when = (v) => {
  const t = new Date(v?.date || 0).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/**
 * One entry per line title, taken from the most recent record that had it.
 *
 * Newest-first so a line that changed size keeps the size it had last time,
 * and so the order follows the most recent log rather than an archaeological
 * one. Lines that only exist in older records are appended rather than
 * dropped — a line idle for a year is still a line.
 */
export const linesFromHistory = (visits = []) => {
  const byTitle = new Map();
  [...visits]
    .filter((v) => !v?.deleted)
    .sort((a, b) => when(b) - when(a))
    .forEach((v) => (v.lines || []).forEach((l) => {
      const title = String(l?.title || '').trim();
      if (title && !byTitle.has(title)) byTitle.set(title, l);
    }));

  // Everything logged against them is reset — this is the machine list, not
  // last month's faults carried forward onto a new shift.
  const scaffolded = scaffoldLinesFrom({ lines: [...byTitle.values()] });

  // Fresh sequential ids. The originals came from different records and could
  // collide, and two lines sharing an id on one log is a line that cannot be
  // edited without editing the other.
  return scaffolded.map((line, i) => ({ ...line, id: i + 1 }));
};

/** Just the names, for telling somebody what they are about to get. */
export const lineTitlesFromHistory = (visits = []) => linesFromHistory(visits).map((l) => l.title);

export default { linesFromHistory, lineTitlesFromHistory };
