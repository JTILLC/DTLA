// src/utils/dataHealth.js
//
// What failed to load, so the screen can say so.
//
// Every fetcher in this dashboard catches its own errors and returns an empty
// result — which is the right call, because one dead source must not blank the
// whole page. The cost is that a permission error, an expired sign-in and a
// genuinely empty collection all look identical: no rows, no message, nothing
// to act on. Both "it isn't showing" reports this month were real bugs the app
// gave no signal about.
//
// So failures are recorded here as they happen and shown once, together. This
// is deliberately not an error-throwing layer: the fetchers keep degrading
// gracefully, they just stop doing it silently.

const failures = new Map();   // source -> { source, message, at }
const listeners = new Set();

const notify = () => { listeners.forEach((fn) => { try { fn(list()); } catch { /* a bad listener must not break reporting */ } }); };

/** Everything currently failing, newest first. */
export const list = () => [...failures.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));

/**
 * Record that a source could not be read.
 *
 * `source` is a stable human name — "jobs", "timesheets" — and doubles as the
 * key, so a source failing on every refresh is one entry rather than a growing
 * pile.
 */
export const recordFailure = (source, error, at = new Date().toISOString()) => {
  const message = error?.message || String(error || 'Unknown error');
  failures.set(source, { source, message, at, permission: isPermission(message) });
  notify();
  return failures.get(source);
};

/** Record that a source loaded, clearing any earlier failure for it. */
export const recordSuccess = (source) => {
  if (failures.delete(source)) notify();
};

/** A permission or sign-in problem reads differently from a network blip. */
export const isPermission = (message) =>
  /permission|insufficient|unauthenti|unauthori|PERMISSION_DENIED|not allowed/i.test(String(message || ''));

/** One line for a banner. Says the shape of the problem, not the stack trace. */
export const summarise = (items = list()) => {
  if (!items.length) return '';
  const names = items.map((f) => f.source);
  const some = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  // Called out separately because the fix is different: a permission problem is
  // usually a sign-in that did not take, and reloading will not help.
  if (items.every((f) => f.permission)) {
    return `Not allowed to read ${some}. Your sign-in may have expired — sign out and back in.`;
  }
  return `Could not load ${some}. What you can see below may be incomplete.`;
};

export const subscribe = (fn) => {
  listeners.add(fn);
  // Guarded like notify(): this is the error-reporting path, and a listener
  // that throws on its first call must not take down the thing whose whole job
  // is surviving other people's failures.
  try { fn(list()); } catch { /* reported nowhere by design — see above */ }
  return () => listeners.delete(fn);
};

/**
 * Clear recorded failures.
 *
 * `keep` decides what survives. A refresh rebuilds the FETCH failures — each
 * fetcher reports again if it fails again — but must not wipe the sign-in
 * failures, which are recorded once at login and never re-tested by a refresh.
 * Clearing those would hide the very problem that explains the empty data.
 */
export const reset = (keep = null) => {
  let changed = false;
  [...failures.keys()].forEach((k) => {
    if (keep && keep(k)) return;
    failures.delete(k);
    changed = true;
  });
  if (changed || !keep) notify();
};

/** Sources recorded by the sign-in path, which a data refresh must not clear. */
export const isSignIn = (source) => String(source || '').startsWith('sign-in to ');

export default { list, recordFailure, recordSuccess, summarise, subscribe, isPermission, reset, isSignIn };
