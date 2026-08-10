// shared/utils/lineOrder.js
//
// The order lines are listed in.
//
// It is not cosmetic. The chip strip, the dashboard, every PDF and the
// walk-the-plant order all read this array front to back, so the sequence is
// how somebody finds the machine they are standing at. Lines get added in
// whatever order they were first noticed, which is rarely the order they sit
// on the floor.
//
// Plain functions over the array, because "did anything actually move?" and
// "is this still the same set of lines?" are the questions worth being sure
// about before a reorder is saved over the real one.

/** Move one line by index. Returns the SAME array reference if nothing moved. */
export const moveLine = (lines = [], from, to) => {
  if (!Array.isArray(lines)) return [];
  if (from === to) return lines;
  if (from < 0 || from >= lines.length) return lines;
  // Clamping rather than refusing: "up" on the first line is a no-op the caller
  // shouldn't have to special-case, and neither should it silently drop a line.
  const dest = Math.max(0, Math.min(lines.length - 1, to));
  if (dest === from) return lines;

  const next = [...lines];
  const [moved] = next.splice(from, 1);
  next.splice(dest, 0, moved);
  return next;
};

export const moveLineUp = (lines, index) => moveLine(lines, index, index - 1);
export const moveLineDown = (lines, index) => moveLine(lines, index, index + 1);

/** Move by line id, for callers that hold an id rather than a position. */
export const moveLineById = (lines = [], id, delta) => {
  const from = lines.findIndex((l) => l.id === id);
  if (from === -1) return lines;
  return moveLine(lines, from, from + delta);
};

/**
 * A reorder must be a PERMUTATION — same lines, different sequence.
 *
 * The reorder screen writes the whole array back over the saved one, so a bug
 * that dropped or duplicated a line would take its heads, issues, photos and
 * span weights with it and look like a successful save. This is the check that
 * makes the write safe to do at all.
 */
export const isSameLineSet = (a = [], b = []) => {
  if (a.length !== b.length) return false;
  const idsOf = (arr) => arr.map((l) => l?.id);
  const sa = [...idsOf(a)].sort();
  const sb = [...idsOf(b)].sort();
  return sa.every((id, i) => id === sb[i]);
};

/** Did the sequence actually change? Used to skip a pointless save. */
export const orderChanged = (a = [], b = []) =>
  a.length !== b.length || a.some((l, i) => l?.id !== b[i]?.id);

/**
 * Sort helper for the one order people ask for by name: natural, so "Line 2"
 * comes before "Line 10" and "PPI-3" before "PPI-12". Offered as a starting
 * point, never applied on its own — the floor order is a fact about the plant,
 * not something a sort can know.
 */
export const sortLinesNaturally = (lines = []) =>
  [...lines].sort((x, y) =>
    String(x?.title || '').localeCompare(String(y?.title || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    }));
