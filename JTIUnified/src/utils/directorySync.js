// src/utils/directorySync.js
//
// Has a published copy of the job numbers fallen behind the jobs?
//
// The dashboard is the only app signed into all four Firebase projects, so it
// is the only one that can copy job numbers to the apps that cannot read them.
// It used to do that only when something happened HERE, which left a number
// created in the Jobs Tracker invisible to a timesheet until the dashboard was
// next used for something unrelated.
//
// The dashboard now checks on load. This is the comparison it makes — kept
// apart from the Firestore calls so the rule can be read and tested on its own,
// because the cost of getting it wrong is either a stale picker (the original
// bug) or a few hundred pointless writes on every page load.
//
// Only numbers and the customer against them are compared. Dates and addresses
// ride along in the published record, but they are edited HERE and republished
// on save, so they cannot drift behind our back the way a number can.

/**
 * What the copies ought to hold: open service report number -> fingerprint.
 *
 * The fingerprint is whatever has to MATCH for the copy to be current. It is
 * the customer by default, and the caller widens it where a copy carries more:
 * the timesheet's copy also carries the quoted figure, and a quote connected to
 * a job after the fact changes nothing else — same numbers, same plants — so a
 * check that only looked at names would never notice and the timesheet would
 * budget against a stale figure forever.
 */
export const openJobIndex = (started = [], fingerprint = (j) => j.customer || '') => new Map(
  started
    .filter((j) => j && !j.closedAt && String(j.sr || '').trim())
    .map((j) => [String(j.sr).trim(), String(fingerprint(j) ?? '')]),
);

/**
 * Does this published copy disagree with the jobs?
 *
 * `published` is [{ id, fingerprint }] — the documents as they are in the other
 * project, keyed by the number, each reduced to the same fingerprint the wanted
 * side was.
 *
 * A size difference catches BOTH directions, which is the point: a number that
 * never arrived, and one closed here that is still sitting in another app's
 * picker. Comparing only "is everything present" would fix the first and leave
 * the second forever.
 */
export const copyIsStale = (published = [], want = new Map()) => {
  const have = new Map(published.map((d) => [String(d.id), String(d.fingerprint ?? d.customer ?? '')]));
  if (have.size !== want.size) return true;
  for (const [sr, fingerprint] of want) {
    if (!have.has(sr)) return true;
    // A job re-pointed at a different plant, or a quote connected to it, has to
    // be republished — otherwise the picker offers the number under the old
    // name, or the timesheet budgets against a figure that has changed.
    if (have.get(sr) !== fingerprint) return true;
  }
  return false;
};

export default { openJobIndex, copyIsStale };
