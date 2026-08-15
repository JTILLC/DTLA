// src/utils/backupShape.js
//
// The shape of a backup file, and what restoring one would do.
//
// A backup nobody has restored from is not a backup, it is a belief. The
// restore half of this system was written and never run, and it did not work:
// a CCW customer document is stored as `{ profile: {...} }`, the backup adds
// `visits` beside it, and the importer then wrapped the whole thing in
// `{ profile: ... }` AGAIN — so restoring wrote `{profile: {profile: {...}}}`
// and quietly broke every customer record it touched.
//
// That bug is impossible to have a strong opinion about while it is spread
// across a Firestore call. Split apart and joined back here, it is one
// round-trip assertion: whatever the backup writes, the restore must return
// unchanged. Everything below exists so that assertion can be made in a test
// rather than discovered during an actual recovery.

/** Bumped when the file layout changes in a way an older reader cannot handle. */
export const BACKUP_FORMAT = 2;

// ---------------------------------------------------------------------------
// CCW Issues: user_files/{uid}/customers/{id} with a visits subcollection.

/** A customer document plus its visits, as one node in the file. */
export const ccwCustomerNode = (docData = {}, visits = {}) => ({ ...docData, visits });

/**
 * ...and back apart again.
 *
 * `docData` is returned EXACTLY as it was stored — not wrapped, not renamed.
 * The old importer's mistake was treating the remainder as the profile rather
 * than as the document that contains it.
 */
export const ccwCustomerSplit = (node = {}) => {
  const { visits, ...docData } = node || {};
  return { docData, visits: visits && typeof visits === 'object' ? visits : {} };
};

// ---------------------------------------------------------------------------
// What a file would do if restored.

const count = (o) => (o && typeof o === 'object' ? Object.keys(o).length : 0);

/**
 * A plain description of the writes a restore would make, for showing to a
 * person BEFORE anything is written.
 *
 * Restores overwrite. That is the point of them, and it is also how a stale
 * file silently undoes a fortnight of work — so nothing here writes anything,
 * and the destructive ones say so in `warnings`.
 */
export const planRestore = (backup) => {
  const app = backup?.app || 'Unknown';
  const data = backup?.data || {};
  const plan = { app, timestamp: backup?.timestamp || null, writes: [], warnings: [], valid: true };

  if (!backup || typeof backup !== 'object' || !backup.data) {
    return { ...plan, valid: false, warnings: ['This file is not a backup, or is damaged.'] };
  }

  if (/CCW/i.test(app)) {
    let customers = 0, visits = 0;
    Object.values(data).forEach((user) => {
      Object.values(user?.customers || {}).forEach((c) => {
        customers += 1;
        visits += count(ccwCustomerSplit(c).visits);
      });
    });
    plan.writes.push({ what: 'customers', n: customers }, { what: 'visits', n: visits });
  } else if (/Shearers/i.test(app)) {
    plan.writes.push({ what: 'downtime records', n: count(data) });
    // set() on the tree root removes anything not in the file. A backup taken
    // this morning would delete this afternoon's work with no undo.
    plan.warnings.push(
      'Restoring Shearers REPLACES the whole downtime tree. Anything recorded since this file was made will be gone.');
  } else if (/Timesheet/i.test(app)) {
    plan.writes.push({ what: 'timesheets', n: count(data) });
  } else if (/Jobs/i.test(app)) {
    const jobs = Object.values(data).reduce((n, year) => n + (Array.isArray(year) ? year.length : count(year)), 0);
    plan.writes.push({ what: 'years', n: count(data) }, { what: 'jobs', n: jobs });
    // No longer the whole-file replacement it was. Jobs are documents now, so a
    // restore overwrites the ones IN the file and leaves everything else alone
    // — including jobs added since. Saying otherwise overstates the damage, and
    // a warning that cries wolf is one people learn to click past.
    plan.warnings.push('Jobs in this file are overwritten. Jobs added since it was made are left alone.');
  } else {
    plan.valid = false;
    plan.warnings.push(`Not a backup this app knows how to restore: "${app}".`);
  }

  if (plan.valid && plan.writes.every((w) => !w.n)) {
    plan.valid = false;
    plan.warnings.push('This file contains no records.');
  }

  // A file older than the data is the dangerous case, and the age is the only
  // clue on offer.
  const at = backup?.timestamp ? new Date(backup.timestamp) : null;
  if (at && !Number.isNaN(at.getTime())) {
    const days = Math.floor((Date.now() - at.getTime()) / 86400000);
    if (days > 7) plan.warnings.push(`This backup is ${days} days old.`);
  }

  return plan;
};

/** One line describing the plan, for a confirmation. */
export const describePlan = (plan) => {
  if (!plan?.valid) return plan?.warnings?.[0] || 'This file cannot be restored.';
  const bits = plan.writes.filter((w) => w.n).map((w) => `${w.n} ${w.what}`);
  return `${plan.app}: ${bits.join(', ')}`;
};

/**
 * Deep equality for comparing restored data against its backup.
 *
 * Key order is normalised because Firestore does not preserve it, but nothing
 * else is forgiven: a missing field, a changed value, a reordered array and an
 * extra layer of wrapping all count as different. A false "identical" here
 * would certify a restore that lost data, which is worse than not checking.
 */
export const deepSame = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
  }
  return v;
};

export default { BACKUP_FORMAT, deepSame, ccwCustomerNode, ccwCustomerSplit, planRestore, describePlan };
