import { collection, getDocs, setDoc, doc, getDoc, deleteDoc } from 'firebase/firestore';
import { ref as dbRef, get, set } from 'firebase/database';
import { ccwIssuesDb, timesheetDb, jobsMasterDb, shearersRealtimeDb } from './firebase-config';
import { ccwCustomerSplit, planRestore, deepSame as same } from './utils/backupShape';

// Helper function to download JSON
function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Backup CCW Issues (Firestore)
export async function backupCCWIssues(onProgress) {
  try {
    onProgress?.('Starting CCW Issues backup...');

    const backup = {
      timestamp: new Date().toISOString(),
      app: 'CCW Issues',
      data: {}
    };

    // Get all users
    const usersSnapshot = await getDocs(collection(ccwIssuesDb, 'user_files'));

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      backup.data[userId] = {};

      // Get customers
      const customersSnapshot = await getDocs(
        collection(ccwIssuesDb, 'user_files', userId, 'customers')
      );
      backup.data[userId].customers = {};

      for (const customerDoc of customersSnapshot.docs) {
        const customerId = customerDoc.id;
        backup.data[userId].customers[customerId] = customerDoc.data();

        // Get visits for this customer
        const visitsSnapshot = await getDocs(
          collection(ccwIssuesDb, 'user_files', userId, 'customers', customerId, 'visits')
        );

        backup.data[userId].customers[customerId].visits = {};
        visitsSnapshot.forEach(visitDoc => {
          backup.data[userId].customers[customerId].visits[visitDoc.id] = visitDoc.data();
        });
      }
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    downloadJSON(backup, `ccw-issues-backup-${timestamp}.json`);

    onProgress?.(`✅ CCW Issues backup complete! ${Object.keys(backup.data).length} users backed up.`);
    return { success: true, message: `${Object.keys(backup.data).length} users backed up` };
  } catch (error) {
    console.error('CCW backup error:', error);
    onProgress?.(`❌ CCW Issues backup failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Backup Shearers (Realtime Database)
export async function backupShearers(onProgress) {
  try {
    onProgress?.('Starting Shearers Downtime Logger backup...');
    console.log('[Shearers Backup] Fetching data from path: jti-downtime/main-logger/data');

    const snapshot = await get(dbRef(shearersRealtimeDb, 'jti-downtime/main-logger/data'));
    const data = snapshot.val();

    console.log('[Shearers Backup] Data fetched:', data ? 'Data exists' : 'No data found');
    console.log('[Shearers Backup] Snapshot exists:', snapshot.exists());

    if (!snapshot.exists()) {
      console.warn('[Shearers Backup] No data found at jti-downtime/main-logger/data path');
      onProgress?.('⚠️ Shearers backup: No data found');
      return { success: true, message: 'No Shearers data to backup' };
    }

    const backup = {
      timestamp: new Date().toISOString(),
      app: 'Shearers Downtime Logger',
      data: data || {}
    };

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    downloadJSON(backup, `shearers-backup-${timestamp}.json`);

    onProgress?.('✅ Shearers backup complete!');
    return { success: true, message: 'Shearers data backed up' };
  } catch (error) {
    console.error('[Shearers Backup] Error:', error);
    console.error('[Shearers Backup] Error details:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    onProgress?.(`❌ Shearers backup failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Backup Timesheet (Firestore)
export async function backupTimesheet(onProgress) {
  try {
    onProgress?.('Starting Timesheet backup...');

    const snapshot = await getDocs(collection(timesheetDb, 'timesheets'));

    const backup = {
      timestamp: new Date().toISOString(),
      app: 'Timesheet',
      data: {}
    };

    snapshot.forEach(doc => {
      backup.data[doc.id] = doc.data();
    });

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    downloadJSON(backup, `timesheet-backup-${timestamp}.json`);

    onProgress?.(`✅ Timesheet backup complete! ${snapshot.size} entries backed up.`);
    return { success: true, message: `${snapshot.size} entries backed up` };
  } catch (error) {
    console.error('Timesheet backup error:', error);
    onProgress?.(`❌ Timesheet backup failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Backup Jobs (Firestore — the per-job mirror)
//
// This used to download the jobs-<year>.json files. Those stopped being
// written on 2026-08-14 when the Jobs app moved to a document per job, so
// reading them now would produce a backup that looks complete and is frozen at
// that date — the worst kind, because nothing about it says so.
export async function backupJobs(onProgress) {
  try {
    onProgress?.('Starting JTI Jobs Tracker backup...');

    const snap = await getDocs(collection(jobsMasterDb, 'jobs'));
    const backup = {
      timestamp: new Date().toISOString(),
      app: 'JTI Jobs Tracker',
      // Grouped by year, which is the shape the restore and the old files both
      // use, so a backup taken before this change still restores.
      data: {},
    };

    snap.docs.forEach((d) => {
      const job = { id: d.id, ...d.data() };
      const year = String(job.year || new Date().getFullYear());
      (backup.data[year] = backup.data[year] || []).push(job);
    });

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    downloadJSON(backup, `jobs-backup-${timestamp}.json`);

    const yearCount = Object.keys(backup.data).length;
    onProgress?.(`✅ Jobs backup complete! ${snap.size} jobs across ${yearCount} years.`);
    return { success: true, message: `${snap.size} jobs backed up` };
  } catch (error) {
    console.error('Jobs backup error:', error);
    onProgress?.(`❌ Jobs backup failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Backup all apps at once
export async function backupAllApps(onProgress) {
  const apps = [
    { name: 'CCW Issues', fn: backupCCWIssues },
    { name: 'Shearers', fn: backupShearers },
    { name: 'Timesheet', fn: backupTimesheet },
    { name: 'Jobs', fn: backupJobs }
  ];

  const results = [];
  let completed = 0;
  const total = apps.length;

  for (const app of apps) {
    onProgress?.({
      message: `Backing up ${app.name}...`,
      progress: Math.round((completed / total) * 100)
    });

    try {
      const result = await app.fn(onProgress);
      results.push({ app: app.name, ...result });
      completed++;
    } catch (error) {
      console.error(`Failed to backup ${app.name}:`, error);
      results.push({ app: app.name, success: false, error: error.message });
      completed++;
    }

    onProgress?.({
      message: `${app.name} complete`,
      progress: Math.round((completed / total) * 100)
    });
  }

  const successCount = results.filter(r => r.success).length;
  onProgress?.({
    message: `✅ All backups complete! ${successCount}/${total} apps backed up successfully.`,
    progress: 100
  });

  return results;
}

// ==================== IMPORT FUNCTIONS ====================

// Import CCW Issues data
/**
 * @param {string} [intoUserId] - write everything under this user instead of
 *   the ones in the file. The verification below restores into a sandbox that
 *   no app reads, using THIS function rather than a copy of it — a rehearsal
 *   that runs different code proves nothing about the performance.
 */
export async function importCCWIssues(backupData, { intoUserId = null } = {}) {
  try {
    if (!backupData.data || typeof backupData.data !== 'object') {
      throw new Error('Invalid CCW Issues backup format');
    }

    let totalRestored = 0;

    for (const [sourceUserId, userData] of Object.entries(backupData.data)) {
      if (!userData.customers) continue;
      const userId = intoUserId || sourceUserId;

      for (const [customerId, customerData] of Object.entries(userData.customers)) {
        // The document is written back EXACTLY as it was read. It already
        // contains its own `profile` key; wrapping the remainder in another one
        // — which this did — restored {profile:{profile:{...}}} and broke every
        // customer it touched. ccwCustomerSplit has a round-trip test.
        const { docData, visits } = ccwCustomerSplit(customerData);
        await setDoc(
          doc(ccwIssuesDb, 'user_files', userId, 'customers', customerId),
          docData
        );

        // Restore visits
        {
          for (const [visitId, visitData] of Object.entries(visits)) {
            await setDoc(
              doc(ccwIssuesDb, 'user_files', userId, 'customers', customerId, 'visits', visitId),
              visitData
            );
            totalRestored++;
          }
        }
      }
    }

    return { success: true, message: `Restored ${totalRestored} visits` };
  } catch (error) {
    console.error('CCW import error:', error);
    return { success: false, error: error.message };
  }
}

// Import Shearers data
/** @param {string} [intoPath] - write elsewhere in the tree; see verifyRestore. */
export async function importShearers(backupData, { replaceEverything = false, intoPath = null } = {}) {
  try {
    if (!backupData.data) {
      throw new Error('Invalid Shearers backup format');
    }
    // set() at the tree root deletes anything not in the file. A backup taken
    // this morning would erase this afternoon's work, so the caller has to say
    // that is what it means rather than arriving here by choosing a file.
    // The sandbox is a different path, so it replaces nothing anybody uses and
    // needs no such confirmation.
    if (!intoPath && !replaceEverything) {
      throw new Error('Restoring Shearers replaces the whole downtime tree. Confirm that first.');
    }

    await set(dbRef(shearersRealtimeDb, intoPath || 'jti-downtime/main-logger/data'), backupData.data);

    return { success: true, message: 'Shearers data restored' };
  } catch (error) {
    console.error('Shearers import error:', error);
    return { success: false, error: error.message };
  }
}

// Import Timesheet data
/** @param {string} [intoCollection] - write somewhere else; see verifyRestore. */
export async function importTimesheet(backupData, { intoCollection = 'timesheets' } = {}) {
  try {
    if (!backupData.data || typeof backupData.data !== 'object') {
      throw new Error('Invalid Timesheet backup format');
    }

    let totalRestored = 0;

    for (const [docId, docData] of Object.entries(backupData.data)) {
      await setDoc(doc(timesheetDb, intoCollection, docId), docData);
      totalRestored++;
    }

    return { success: true, message: `Restored ${totalRestored} timesheet entries` };
  } catch (error) {
    console.error('Timesheet import error:', error);
    return { success: false, error: error.message };
  }
}

// Import Jobs data
/**
 * @param {string} [intoCollection] - write somewhere else; see verifyRestore.
 *
 * Restores per-job documents. A backup taken before 2026-08-14 holds year
 * ARRAYS with no ids; those are restored too, with ids minted on the way in,
 * so an old file is still worth having.
 */
export async function importJobs(backupData, { intoCollection = 'jobs' } = {}) {
  try {
    if (!backupData.data || typeof backupData.data !== 'object') {
      throw new Error('Invalid Jobs backup format');
    }

    let totalRestored = 0;

    for (const [year, jobs] of Object.entries(backupData.data)) {
      const list = Array.isArray(jobs) ? jobs : Object.values(jobs || {});
      for (const job of list) {
        const id = job.id || crypto.randomUUID();
        await setDoc(doc(jobsMasterDb, intoCollection, id), { ...job, id, year: String(job.year || year) });
        totalRestored += 1;
      }
    }

    return { success: true, message: `Restored ${totalRestored} jobs` };
  } catch (error) {
    console.error('Jobs import error:', error);
    return { success: false, error: error.message };
  }
}

// Import backup from file
// A user id no app reads. Everything the verification writes lives under here
// and is deleted afterwards.
//
// NOT wrapped in double underscores, however much it wants to be: Firestore
// reserves every id matching __…__ and rejects the write outright. The name
// still has to be one no real account could hold — Firebase uids are 28
// characters of alphanumeric, so a hyphenated phrase cannot collide.
export const SANDBOX_UID = 'zz-restore-verification';

/**
 * Prove a backup can actually be restored.
 *
 * Everything up to now showed the data coming OUT. This puts some of it back
 * in, through the real importer, and reads it from Firestore to check it
 * arrived intact — which is the only claim that matters on the day it is
 * needed, and the only one that had never been tested.
 *
 * It restores into a user id no app reads, then deletes what it wrote. Live
 * data is never touched: the sandbox is a sibling of the real workspace, not a
 * parent of it.
 */
export async function verifyRestore(backup, onProgress, { sample = 3 } = {}) {
  const app = backup?.app || '';
  if (/Timesheet/i.test(app)) return finish(await verifyTimesheets(backup, onProgress, sample));
  if (/Jobs/i.test(app)) return finish(await verifyJobs(backup, onProgress, sample));
  if (/Shearers/i.test(app)) return finish(await verifyShearers(backup, onProgress));
  if (!/CCW/i.test(app)) throw new Error(`No verification for a "${app}" backup.`);

  const report = { checked: 0, matched: 0, mismatches: [], cleaned: 0, errors: [] };

  // A representative slice rather than everything: this writes and then deletes
  // real documents, and the question is whether the shape survives the trip,
  // which three customers answer as well as three hundred.
  const [sourceUid, userData] = Object.entries(backup.data)[0] || [];
  const customers = Object.entries(userData?.customers || {}).slice(0, sample);
  if (!customers.length) throw new Error('That backup has no customers to verify with.');

  const slice = { ...backup, data: { [sourceUid]: { customers: Object.fromEntries(customers) } } };

  onProgress?.(`Restoring ${customers.length} customers into a sandbox…`);
  const res = await importCCWIssues(slice, { intoUserId: SANDBOX_UID });
  if (!res.success) throw new Error(res.error || 'The restore itself failed.');

  // Read it back through Firestore, not from memory — the round trip is the
  // thing being tested.
  for (const [customerId, node] of customers) {
    const { docData, visits } = ccwCustomerSplit(node);
    try {
      const snap = await getDoc(doc(ccwIssuesDb, 'user_files', SANDBOX_UID, 'customers', customerId));
      report.checked += 1;
      if (!snap.exists()) {
        report.mismatches.push(`${customerId}: nothing was written`);
      } else if (!same(snap.data(), docData)) {
        report.mismatches.push(`${customerId}: the customer record came back different`);
      } else {
        let visitsOk = true;
        for (const [visitId, visitData] of Object.entries(visits)) {
          const v = await getDoc(doc(ccwIssuesDb, 'user_files', SANDBOX_UID, 'customers', customerId, 'visits', visitId));
          if (!v.exists() || !same(v.data(), visitData)) {
            visitsOk = false;
            report.mismatches.push(`${customerId}/${visitId}: visit came back different`);
            break;
          }
        }
        if (visitsOk) report.matched += 1;
      }
    } catch (err) {
      report.errors.push(`${customerId}: ${err.message}`);
    }
  }

  // Cleaned up whatever happened above, including a failure — leaving test data
  // in a live project is its own small mess.
  onProgress?.('Removing the sandbox…');
  for (const [customerId, node] of customers) {
    try {
      for (const visitId of Object.keys(ccwCustomerSplit(node).visits)) {
        await deleteDoc(doc(ccwIssuesDb, 'user_files', SANDBOX_UID, 'customers', customerId, 'visits', visitId));
        report.cleaned += 1;
      }
      await deleteDoc(doc(ccwIssuesDb, 'user_files', SANDBOX_UID, 'customers', customerId));
      report.cleaned += 1;
    } catch (err) {
      report.errors.push(`cleanup ${customerId}: ${err.message}`);
    }
  }

  return finish(report);
}

/**
 * A verification passes only if everything checked came back identical.
 *
 * Written once and shared, because "ok" is the whole output and four copies of
 * the condition is four chances to write a lenient one. Errors count against
 * it too: a cleanup that failed is not a pass, it is a pass plus a mess.
 */
const finish = (report) => ({
  ...report,
  ok: report.checked > 0
    && report.matched === report.checked
    && !report.mismatches.length
    && !report.errors.length,
});

/**
 * Timesheets: Firestore documents in their own collection.
 *
 * The sandbox is a separate collection rather than prefixed ids in the real
 * one — a stray verification document sitting among live timesheets would be
 * picked up by every query that reads them.
 */
async function verifyTimesheets(backup, onProgress, sample) {
  const report = { checked: 0, matched: 0, mismatches: [], cleaned: 0, errors: [] };
  const entries = Object.entries(backup.data || {}).slice(0, sample);
  if (!entries.length) throw new Error('That backup has no timesheets to verify with.');

  onProgress?.(`Restoring ${entries.length} timesheets into a sandbox…`);
  const res = await importTimesheet(
    { ...backup, data: Object.fromEntries(entries) }, { intoCollection: SANDBOX_UID });
  if (!res.success) {
    // The timesheet project's rules name every collection they allow and have
    // no catch-all — which is the point of them, and means the sandbox is
    // refused. Worth explaining rather than passing "Missing or insufficient
    // permissions" up as though something were broken: nothing is, the rules
    // are doing their job and have not been told about this collection.
    if (/permission|insufficient/i.test(res.error || '')) {
      throw new Error(
        `The timesheet project refuses writes to "${SANDBOX_UID}" — its rules list the collections they allow `
        + 'and this is not one of them. Adding it is one line in jti-timesheet/firestore.rules '
        + '(already written, not deployed), or skip this check: a real restore writes to `timesheets`, '
        + 'which is allowed, so the restore itself is unaffected.');
    }
    throw new Error(res.error || 'The restore itself failed.');
  }

  for (const [docId, docData] of entries) {
    try {
      const snap = await getDoc(doc(timesheetDb, SANDBOX_UID, docId));
      report.checked += 1;
      if (!snap.exists()) report.mismatches.push(`${docId}: nothing was written`);
      else if (!same(snap.data(), docData)) report.mismatches.push(`${docId}: came back different`);
      else report.matched += 1;
    } catch (err) { report.errors.push(`${docId}: ${err.message}`); }
  }

  onProgress?.('Removing the sandbox…');
  for (const [docId] of entries) {
    try { await deleteDoc(doc(timesheetDb, SANDBOX_UID, docId)); report.cleaned += 1; }
    catch (err) { report.errors.push(`cleanup ${docId}: ${err.message}`); }
  }
  return report;
}

/**
 * Jobs: per-job documents, restored into a sandbox collection.
 *
 * Was a Storage folder read back over HTTP, until the jobs moved to Firestore.
 */
async function verifyJobs(backup, onProgress, sample) {
  const report = { checked: 0, matched: 0, mismatches: [], cleaned: 0, errors: [] };
  const jobs = Object.values(backup.data || {}).flatMap((v) => (Array.isArray(v) ? v : Object.values(v || {})));
  const slice = jobs.slice(0, sample);
  if (!slice.length) throw new Error('That backup has no jobs to verify with.');

  onProgress?.(`Restoring ${slice.length} jobs into a sandbox…`);
  const res = await importJobs(
    { ...backup, data: { probe: slice } }, { intoCollection: SANDBOX_UID });
  if (!res.success) throw new Error(res.error || 'The restore itself failed.');

  for (const job of slice) {
    const id = job.id;
    if (!id) { report.errors.push('a job in this backup has no id'); continue; }
    try {
      const snap = await getDoc(doc(jobsMasterDb, SANDBOX_UID, id));
      report.checked += 1;
      if (!snap.exists()) report.mismatches.push(`${id}: nothing was written`);
      // year is normalised on the way in, so compare what the job SAYS.
      else if (!same({ ...snap.data(), year: String(snap.data().year) },
                     { ...job, id, year: String(job.year) })) {
        report.mismatches.push(`${job.sr || id}: came back different`);
      } else report.matched += 1;
    } catch (err) { report.errors.push(`${id}: ${err.message}`); }
  }

  onProgress?.('Removing the sandbox…');
  for (const job of slice) {
    if (!job.id) continue;
    try { await deleteDoc(doc(jobsMasterDb, SANDBOX_UID, job.id)); report.cleaned += 1; }
    catch (err) { report.errors.push(`cleanup ${job.id}: ${err.message}`); }
  }
  return report;
}

/**
 * Shearers: one Realtime Database tree.
 *
 * The sandbox sits UNDER jti-downtime so the existing rules cover it — a path
 * at the root would be denied by default and the failure would look like the
 * restore being broken rather than the rules not reaching it.
 */
async function verifyShearers(backup, onProgress) {
  const report = { checked: 0, matched: 0, mismatches: [], cleaned: 0, errors: [] };
  const path = `jti-downtime/${SANDBOX_UID}`;

  onProgress?.('Restoring the downtime tree into a sandbox…');
  const res = await importShearers(backup, { intoPath: path });
  if (!res.success) throw new Error(res.error || 'The restore itself failed.');

  try {
    const snap = await get(dbRef(shearersRealtimeDb, path));
    report.checked = 1;
    if (!snap.exists()) report.mismatches.push('nothing was written');
    else if (!same(snap.val(), backup.data)) report.mismatches.push('the tree came back different');
    else report.matched = 1;
  } catch (err) { report.errors.push(err.message); }

  onProgress?.('Removing the sandbox…');
  try { await set(dbRef(shearersRealtimeDb, path), null); report.cleaned = 1; }
  catch (err) { report.errors.push(`cleanup: ${err.message}`); }
  return report;
}

/** Read and validate a file WITHOUT writing anything, so it can be shown first. */
export async function readBackupFile(file) {
  const backup = JSON.parse(await file.text());
  return { backup, plan: planRestore(backup) };
}

export async function importBackupFromFile(file, onProgress, { replaceEverything = false } = {}) {
  try {
    const text = await file.text();
    const backup = JSON.parse(text);

    if (!backup.app || !backup.data) {
      throw new Error('Invalid backup file format');
    }
    // Checked here as well as in the UI: this function overwrites live data and
    // must not depend on a caller having looked first.
    const plan = planRestore(backup);
    if (!plan.valid) throw new Error(plan.warnings[0] || 'This file cannot be restored.');

    onProgress?.(`Importing ${backup.app} backup...`);

    let result;
    switch (backup.app) {
      case 'CCW Issues':
        result = await importCCWIssues(backup);
        break;
      case 'Shearers Downtime Logger':
        result = await importShearers(backup, { replaceEverything });
        break;
      case 'Timesheet':
        result = await importTimesheet(backup);
        break;
      case 'JTI Jobs Tracker':
        result = await importJobs(backup);
        break;
      default:
        throw new Error(`Unknown app type: ${backup.app}`);
    }

    if (result.success) {
      onProgress?.(`✅ ${backup.app} import complete! ${result.message}`);
    } else {
      onProgress?.(`❌ ${backup.app} import failed: ${result.error}`);
    }

    return result;
  } catch (error) {
    console.error('Import error:', error);
    onProgress?.(`❌ Import failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
