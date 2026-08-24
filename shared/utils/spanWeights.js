// shared/utils/spanWeights.js
//
// What a span adjustment actually moved.
//
// The screen was built around one reading and a typed target: you entered what
// the head showed, typed the test weight it was supposed to show, and the
// difference was the gap between them. That gap is the error BEFORE the
// adjustment, and it assumes the adjustment then landed exactly on the target.
//
// It usually does, but "usually" is not a record. With a 200g test weight a
// head reads 199.8 or 200.1 beforehand, and the only way to know it reads 200.0
// afterwards is to look. So there are two readings now — before and after — and
// the difference is between them: what the span did, measured, not assumed.

/** One decimal place, which is the resolution these screens report. */
export const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

/** Is there a number here at all? 0 counts; '' and null do not. */
const filled = (v) => v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(Number(v));

/**
 * After minus before, or null when either reading is missing.
 *
 * Null rather than 0: a head that has not been read yet has no difference, and
 * showing 0.0 for it would claim the span moved nothing.
 */
export const spanDiff = (before, after) => {
  if (!filled(before) || !filled(after)) return null;
  return round1(Number(after) - Number(before));
};

/**
 * The stored shape for one head.
 *
 * `currentWeight` and `spanWeight` keep the names and the meanings they have
 * had since the first entry was written — the before reading and the test
 * weight — so every entry already in the log still renders. `afterWeight` and
 * `afterDifference` are new and absent on all of them, which is how an old
 * entry is told apart from a new one.
 *
 * `difference` also keeps its old meaning (test weight minus before) so history
 * written by this version reads the same way as history written by the last.
 */
export const headRecord = ({ head, currentWeight, afterWeight, spanWeight }) => {
  const before = filled(currentWeight) ? round1(currentWeight) : 0;
  const target = filled(spanWeight) ? round1(spanWeight) : 0;
  const record = {
    head,
    currentWeight: before,
    spanWeight: target,
    difference: round1(target - before),
  };
  if (filled(afterWeight)) {
    record.afterWeight = round1(afterWeight);
    record.afterDifference = spanDiff(currentWeight, afterWeight);
  }
  return record;
};

/** Does this entry carry after-span readings — i.e. was it written by this version? */
export const hasAfterReadings = (heads = []) =>
  heads.some((h) => h && h.afterWeight !== null && h.afterWeight !== undefined);

/**
 * The test weight an entry was spanned to.
 *
 * Stored per head because that is the shape the log has always had, but it is
 * one number for the whole line — every head is spanned to the same weight.
 * Reads the first head that has one rather than assuming head 1 exists.
 */
export const testWeightOf = (heads = []) => {
  const found = heads.find((h) => filled(h?.spanWeight));
  return found ? round1(found.spanWeight) : null;
};

export default { round1, spanDiff, headRecord, hasAfterReadings, testWeightOf };
