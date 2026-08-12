// shared/utils/mergeApply.js
//
// Whether a finished save may write its merged result back onto the screen.
//
// The autosave takes a copy of the record, runs a transaction, and gets back a
// merged version that may contain another editor's changes. Putting that on
// screen is right — unless the person at this screen has typed something in the
// meantime, because the merge was computed from a copy taken BEFORE they did.
// Applying it then silently undoes whatever they just did.
//
// That is not theoretical. It is a head switched offline coming back on, an
// issue type snapping back to the first option in the list, and text vanishing
// out of a box mid-sentence — three complaints, one cause, and all of them only
// "sometimes", because they need an edit to land inside the window where the
// write is in flight. On a plant's connection that window is long.
//
// The rule: adopt the merge only if this screen has not moved since the copy
// was taken. If it has, the newer edits win and the next autosave carries them
// up — the baseline has already advanced, so that save merges against what was
// actually stored and nothing is lost either way.

/**
 * Did the editor change anything while the write was in flight?
 *
 * Both arguments are serialized snapshots of the same shape — whatever the
 * caller uses to compare record content. Unknowns count as "moved on": if we
 * cannot prove the screen is untouched, we do not overwrite it.
 */
export const localMovedOn = (atWriteTime, now) => {
  if (typeof atWriteTime !== 'string' || typeof now !== 'string') return true;
  return atWriteTime !== now;
};

/**
 * Should the merged result replace what is on screen?
 *
 * Yes only when BOTH hold:
 *   - the merge actually differs from what we sent, so there is something to
 *     show — otherwise this is a pointless re-render mid-typing;
 *   - the screen has not moved since, so showing it cannot undo anybody.
 */
export const shouldAdoptMerge = ({ sentSnapshot, mergedSnapshot, currentSnapshot }) => {
  if (localMovedOn(sentSnapshot, currentSnapshot)) return false;
  return mergedSnapshot !== sentSnapshot;
};

export default { shouldAdoptMerge, localMovedOn };
