// src/utils/progressText.js
//
// Turning a progress report into something React can render.
//
// The backup functions report progress in two shapes: the individual ones send
// a string, and backupAllApps sends { message, progress }. Putting the second
// straight into JSX is React error #31 — "objects are not valid as a React
// child" — which is not a graceful degradation, it is the whole page going
// white. It happened AFTER the backups had completed, so the work was fine and
// only the account of it was not.
//
// One callback with two contracts is the actual fault. Normalising at the
// boundary is the fix that holds regardless of which caller is used, including
// the ones that are handed this callback and call it themselves.

/** A progress report as text. Empty string for anything with nothing to say. */
export const progressText = (m) => {
  if (typeof m === 'string') return m;
  if (typeof m === 'number') return String(m);
  if (!m || typeof m !== 'object') return '';
  const pct = Number.isFinite(m.progress) ? ` (${m.progress}%)` : '';
  return m.message ? `${m.message}${pct}` : '';
};

export default { progressText };
