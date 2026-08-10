// The concurrent-edit merge. Everything it gets wrong, it gets wrong silently:
// a dropped line looks like a successful save, and so does a discarded reorder.
import { describe, it, expect } from 'vitest';
import { mergeLinesArrays } from './mergeLines.js';

const L = (id, over = {}) => ({ id, title: `Line ${id}`, heads: [{ id: 1, status: 'active' }], ...over });
const ids = (arr) => arr.map((l) => l.id);
const edit = (line, over) => ({ ...line, ...over });

describe('content', () => {
  it('keeps this client\'s change to the line it touched', () => {
    const base = [L(1), L(2)];
    const local = [edit(L(1), { title: 'Renamed' }), L(2)];
    const remote = [L(1), L(2)];
    expect(mergeLinesArrays(base, local, remote)[0].title).toBe('Renamed');
  });

  it('keeps the other client\'s change to a line this one did not touch', () => {
    const base = [L(1), L(2)];
    const local = [edit(L(1), { title: 'Mine' }), L(2)];
    const remote = [L(1), edit(L(2), { title: 'Theirs' })];
    const out = mergeLinesArrays(base, local, remote);
    expect(out.map((l) => l.title)).toEqual(['Mine', 'Theirs']);
  });

  it('honours a deletion made here', () => {
    const out = mergeLinesArrays([L(1), L(2)], [L(1)], [L(1), L(2)]);
    expect(ids(out)).toEqual([1]);
  });

  it('keeps a line added here', () => {
    const out = mergeLinesArrays([L(1)], [L(1), L(9)], [L(1)]);
    expect(ids(out)).toEqual([1, 9]);
  });

  it('keeps a line added by the other client', () => {
    const out = mergeLinesArrays([L(1)], [L(1)], [L(1), L(7)]);
    expect(ids(out)).toEqual([1, 7]);
  });
});

describe('order', () => {
  it('takes the remote order when this client did not reorder', () => {
    // Someone else moved things; this screen should adopt it.
    const out = mergeLinesArrays([L(1), L(2), L(3)], [L(1), L(2), L(3)], [L(3), L(1), L(2)]);
    expect(ids(out)).toEqual([3, 1, 2]);
  });

  it('keeps a reorder made here — the bug this was written for', () => {
    // Moving a line changes no line's CONTENT, so the old merge saw nothing
    // dirty and handed back the remote sequence. The reorder screen appeared
    // to save and the list snapped straight back.
    const base = [L(1), L(2), L(3)];
    const local = [L(2), L(1), L(3)];
    const remote = [L(1), L(2), L(3)];
    expect(ids(mergeLinesArrays(base, local, remote))).toEqual([2, 1, 3]);
  });

  it('keeps a reorder AND the other client\'s edit to a line', () => {
    const base = [L(1), L(2), L(3)];
    const local = [L(3), L(2), L(1)];
    const remote = [L(1), edit(L(2), { title: 'Theirs' }), L(3)];
    const out = mergeLinesArrays(base, local, remote);
    expect(ids(out)).toEqual([3, 2, 1]);
    expect(out.find((l) => l.id === 2).title).toBe('Theirs');
  });

  it('places a line the other client added after the ones ordered here', () => {
    const base = [L(1), L(2)];
    const local = [L(2), L(1)];
    const remote = [L(1), L(2), L(8)];
    expect(ids(mergeLinesArrays(base, local, remote))).toEqual([2, 1, 8]);
  });

  it('does not mistake a deletion for a reorder', () => {
    // Removing the middle line leaves [1,3] — same relative sequence, so the
    // remote's ordering of what remains should still stand.
    const base = [L(1), L(2), L(3)];
    const local = [L(1), L(3)];
    const remote = [L(3), L(1), L(2)];
    expect(ids(mergeLinesArrays(base, local, remote))).toEqual([3, 1]);
  });

  it('does not mistake an addition for a reorder', () => {
    const base = [L(1), L(2)];
    const local = [L(1), L(2), L(9)];
    const remote = [L(2), L(1)];
    expect(ids(mergeLinesArrays(base, local, remote))).toEqual([2, 1, 9]);
  });

  it('keeps a reorder that also added a line', () => {
    const base = [L(1), L(2), L(3)];
    const local = [L(3), L(9), L(1), L(2)];
    const remote = [L(1), L(2), L(3)];
    expect(ids(mergeLinesArrays(base, local, remote))).toEqual([3, 9, 1, 2]);
  });
});

describe('robustness', () => {
  it('never invents or loses a line', () => {
    const base = [L(1), L(2), L(3)];
    const local = [L(3), L(1), L(2)];
    const remote = [L(2), L(3), L(1)];
    const out = mergeLinesArrays(base, local, remote);
    expect(out).toHaveLength(3);
    expect(new Set(ids(out)).size).toBe(3);
  });

  it('survives missing inputs', () => {
    expect(mergeLinesArrays(null, null, null)).toEqual([]);
    // A line added here with nothing in the cloud yet is still a line that was
    // added — dropping it would be the exact data loss this merge exists to
    // prevent. (This assertion was wrong first time round; the code was right.)
    expect(ids(mergeLinesArrays(undefined, [L(1)], undefined))).toEqual([1]);
    expect(ids(mergeLinesArrays([], [], [L(4)]))).toEqual([4]);
  });
});
