// src/utils/jobMirror.js
//
// Deciding whether the per-job Firestore mirror can be trusted yet.
//
// The Jobs app is being moved off whole-year JSON files onto a document per
// job. The dashboard switching to the mirror is the first time anything READS
// it, and the obvious way to gain confidence — watch it for a week and then
// flip — depends on somebody remembering to watch, and on nothing going wrong
// in the week after they stop.
//
// So the switch checks itself instead. Both sources are read, and the mirror is
// used only where it agrees with the files. Where it does not, the files win —
// they are still what the Jobs app writes and therefore still the truth — and
// the disagreement is reported rather than absorbed.
//
// This is meant to be temporary. Once it has gone a long stretch without
// reporting anything, the file read goes away and this goes with it.

/** Fields that describe the JOB, as opposed to how it was stored. */
const meaningful = (job = {}) => {
  const { updatedAt, updatedBy, ...rest } = job || {};
  return rest;
};

/** A job in comparable form: keys sorted, storage metadata dropped. */
export const jobSignature = (job) => {
  const m = meaningful(job);
  return JSON.stringify(Object.keys(m).sort().reduce((o, k) => {
    // Undefined and empty string mean the same thing in a form-filled record,
    // and the two stores round-trip them differently. Treating them as
    // different would report drift on every job forever.
    const v = m[k];
    if (v !== undefined && v !== null && v !== '') o[k] = v;
    return o;
  }, {}));
};

/**
 * Compare the two sources, keyed by job id.
 *
 * A job with no id cannot be compared — ids were assigned when the mirror was
 * set up, so one without means a job written by something that has not been
 * through that. Reported rather than ignored: it is the case where the mirror
 * is quietly incomplete.
 */
export const compareSources = (fileJobs = [], mirrorJobs = []) => {
  const withoutIds = fileJobs.filter((j) => !j?.id).length;
  const byId = (list) => new Map(list.filter((j) => j?.id).map((j) => [j.id, j]));
  const files = byId(fileJobs);
  const mirror = byId(mirrorJobs);

  const missingFromMirror = [...files.keys()].filter((id) => !mirror.has(id));
  const notInFiles = [...mirror.keys()].filter((id) => !files.has(id));
  const differing = [...files.keys()].filter(
    (id) => mirror.has(id) && jobSignature(files.get(id)) !== jobSignature(mirror.get(id)));

  return {
    agree: !withoutIds && !missingFromMirror.length && !notInFiles.length && !differing.length,
    withoutIds,
    missingFromMirror,
    notInFiles,
    differing,
    counts: { files: fileJobs.length, mirror: mirrorJobs.length },
  };
};

/** Why the mirror was not used, in words. Empty when it was. */
export const describeDrift = (cmp) => {
  if (!cmp || cmp.agree) return '';
  const bits = [];
  if (cmp.withoutIds) bits.push(`${cmp.withoutIds} with no id`);
  if (cmp.missingFromMirror.length) bits.push(`${cmp.missingFromMirror.length} missing from the mirror`);
  if (cmp.notInFiles.length) bits.push(`${cmp.notInFiles.length} in the mirror but not the files`);
  if (cmp.differing.length) bits.push(`${cmp.differing.length} different`);
  return `Job mirror not used: ${bits.join(', ')}. Reading the year files instead.`;
};

/**
 * Ids appearing more than once in a list of jobs.
 *
 * Duplicates do not look like an error — they look like more income. The
 * dashboard shipped exactly that: year-file jobs were appended to the mirror's
 * jobs by a race, and the only symptom was totals that were roughly double and
 * varied between loads. A number being wrong in a plausible direction is the
 * hardest kind to notice, so it is checked rather than trusted.
 */
export const duplicateIds = (jobs = []) => {
  const seen = new Set();
  const dupes = new Set();
  (jobs || []).forEach((j) => {
    const id = j?.id;
    if (!id) return;
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  });
  return [...dupes];
};

export default { jobSignature, compareSources, describeDrift, duplicateIds };
