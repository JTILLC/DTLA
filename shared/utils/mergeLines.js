// shared/utils/mergeLines.js
//
// Three-way merge of a visit's lines, for when two people have the same visit
// open. Was duplicated in both apps; extracted so the rules live in one place
// and can be tested, because getting this wrong loses somebody's work silently.
//
// The shape is baseline / local / remote:
//   baseline — what this client last saw saved
//   local    — what this client has now
//   remote   — what is in the cloud right now (possibly someone else's edits)
//
// Content rule: a line this client CHANGED wins for that line; every other line
// keeps whatever the cloud has. So two people editing different lines both keep
// their work, and neither overwrites the other wholesale.

const ser = (l) => JSON.stringify(l);

// Did the caller deliberately re-sequence the lines they share with baseline?
// Compared over COMMON ids only, so adding or deleting a line is not mistaken
// for a reorder.
const didReorder = (baseIds, locIds, baseSeq, locSeq) => {
  const a = baseSeq.filter((id) => locIds.has(id));
  const b = locSeq.filter((id) => baseIds.has(id));
  return a.length === b.length && a.some((id, i) => id !== b[i]);
};

export function mergeLinesArrays(baseline, local, remote) {
  const base = baseline || [];
  const loc = local || [];
  const rem = remote || [];

  const baseSer = new Map(base.map((l) => [l.id, ser(l)]));
  const baseIds = new Set(base.map((l) => l.id));
  const locById = new Map(loc.map((l) => [l.id, l]));
  const locIds = new Set(locById.keys());
  const dirty = new Set(loc.filter((l) => ser(l) !== baseSer.get(l.id)).map((l) => l.id));
  const removed = new Set(base.filter((l) => !locIds.has(l.id)).map((l) => l.id));

  const out = [];
  const placed = new Set();
  rem.forEach((rl) => {
    if (removed.has(rl.id)) return;                 // this client deleted it
    placed.add(rl.id);
    out.push(dirty.has(rl.id) && locById.has(rl.id) ? locById.get(rl.id) : rl);
  });
  loc.forEach((ll) => {
    if (!placed.has(ll.id) && dirty.has(ll.id) && !baseIds.has(ll.id)) out.push(ll); // newly added
  });

  // ORDER.
  //
  // The loop above emits lines in the REMOTE's order, which quietly threw away
  // every reorder: moving a line changes no line's content, so `dirty` is empty
  // and the merge hands back the old sequence — the reorder screen appeared to
  // save and the list snapped straight back.
  //
  // Order is a property of the array rather than of any line, so it needs its
  // own rule, and it is the same rule as for content: whoever changed it wins.
  // Only when this client left the order alone does the remote's sequence
  // stand, which is what lets someone else's reorder reach this screen.
  if (didReorder(baseIds, locIds, base.map((l) => l.id), loc.map((l) => l.id))) {
    const rank = new Map(loc.map((l, i) => [l.id, i]));
    // Lines only the remote has are unranked; sort is stable, so they keep
    // their relative order and settle after the ones this client placed.
    out.sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER)
                     - (rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER));
  }

  return out;
}

export default mergeLinesArrays;
