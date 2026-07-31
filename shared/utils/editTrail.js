// shared/utils/editTrail.js
//
// Editing a saved log entry, without quietly rewriting history.
//
// A log is worth something because it says what happened. An entry that can be
// changed with no trace is worth LESS than one that cannot be changed at all —
// so every edit stamps who made it and when, and the entry says it has been
// edited wherever it is shown.
//
// What is deliberately not here: field-level diffs. Storing every previous
// value would make each entry grow without bound for a question nobody has
// asked. "Edited twice, last by Dana on the 3rd" is the useful part; if the
// full before-and-after ever matters, that is a different feature and should be
// built as one rather than half-guessed now.
//
// performedAt is NEVER touched. The entry keeps the time the work happened; an
// edit is a separate fact with its own timestamp.

export const MAX_TRAIL = 20;   // keeps a long-lived entry from growing forever

// Merge an edit into an entry's patch. Callers pass the fields they changed;
// this adds the provenance.
export function withEditStamp(patch, entry, byName) {
  const at = new Date().toISOString();
  const prior = Array.isArray(entry?.edits) ? entry.edits : [];
  return {
    ...patch,
    editedAt: at,
    editedBy: byName || '',
    editCount: (Number(entry?.editCount) || 0) + 1,
    // Newest last, capped. The cap drops the OLDEST entries, because the recent
    // ones are the ones anyone asks about.
    edits: [...prior, { at, by: byName || '' }].slice(-MAX_TRAIL),
  };
}

// "edited twice · last by Dana, 3 Aug" — or nothing at all for an untouched
// entry, so a clean log stays clean.
export function editSummary(entry) {
  const n = Number(entry?.editCount) || 0;
  if (!n) return '';
  const when = entry.editedAt
    ? new Date(entry.editedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : '';
  const who = entry.editedBy ? ` by ${entry.editedBy}` : '';
  return `edited ${n === 1 ? 'once' : `${n} times`}${who ? ` · last${who}` : ''}${when ? `, ${when}` : ''}`;
}

export default { withEditStamp, editSummary, MAX_TRAIL };
