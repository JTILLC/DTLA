// Build head-history entries for one date — the exact exportable shape
// Summary produces (keep in sync with Summary.jsx rows), so Finish Day and
// Summary write identical records and firebaseKeyForEntry dedupes across
// both paths: re-saving the same downtime is an idempotent overwrite of the
// same child key, never a duplicate and never a wholesale set().
import { firebaseKeyForEntry } from './historyKeys';

const isHeadDown = (h) => (String(h?.offline ?? '').toLowerCase() || 'active') !== 'active';

// Photos ride along into Head History so the archive keeps its evidence. Only
// attached when non-empty — Realtime Database rejects undefined, and an empty
// array on every row would bloat the archive for nothing.
const withPhotos = (entry, photos) => {
  const list = (photos || []).filter((p) => p && p.url);
  return list.length ? { ...entry, photos: list } : entry;
};

export function historyEntriesForDate(dayData, date) {
  const entries = [];
  Object.keys(dayData || {}).forEach((line) => {
    const entry = dayData[line] || {};
    if (!entry.running) return; // running lines only, same rule as Summary

    (entry.heads || []).filter(isHeadDown).forEach((h) => {
      let issuesArray = [];
      if (Array.isArray(h.issues) && h.issues.length > 0) {
        issuesArray = h.issues;
      } else if (h.issue && h.issue !== 'None') {
        // old single-issue format
        issuesArray = [{ type: h.issue, repaired: h.repaired || 'Not Fixed', replacementReason: '' }];
      }

      if (issuesArray.length === 0) {
        entries.push({ date, line, head: h.head, issue: 'Undetermined', repaired: 'Not Fixed', notes: h.notes || '' });
      } else {
        issuesArray.forEach((iss) => {
          const issueDisplay = iss.type === 'WDU Replacement' && iss.replacementReason
            ? `${iss.type} (${iss.replacementReason})`
            : iss.type;
          entries.push(withPhotos(
            { date, line, head: h.head, issue: issueDisplay, repaired: iss.repaired || 'Not Fixed', notes: h.notes || '' },
            iss.photos
          ));
        });
      }
    });

    if (entry.machineNotes && entry.machineNotes.trim()) {
      entries.push(withPhotos(
        { date, line, head: '', issue: '', repaired: '', notes: `Machine note: ${entry.machineNotes.trim()}` },
        entry.notePhotos
      ));
    }
  });
  return entries;
}

export function historyUpdatesFor(entries) {
  const updates = {};
  entries.forEach((e) => { updates[firebaseKeyForEntry(e)] = e; });
  return updates;
}
