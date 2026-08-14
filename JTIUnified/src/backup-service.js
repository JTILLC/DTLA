import { collection, getDocs, setDoc, doc } from 'firebase/firestore';
import { ref as storageRef, getDownloadURL, uploadString } from 'firebase/storage';
import { ref as dbRef, get, set } from 'firebase/database';
import { ccwIssuesDb, timesheetDb, jobsStorage, shearersRealtimeDb } from './firebase-config';
import { ccwCustomerSplit, planRestore } from './utils/backupShape';

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

// Backup Jobs (Firebase Storage)
export async function backupJobs(onProgress) {
  try {
    onProgress?.('Starting JTI Jobs Tracker backup...');

    const backup = {
      timestamp: new Date().toISOString(),
      app: 'JTI Jobs Tracker',
      data: {}
    };

    // Get years dynamically (2022 to current year + 3)
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = 2022; y <= currentYear + 3; y++) {
      years.push(y.toString());
    }

    for (const year of years) {
      try {
        const url = await getDownloadURL(storageRef(jobsStorage, `jobs-${year}.json`));
        const response = await fetch(url);
        if (response.ok) {
          backup.data[year] = await response.json();
        }
      } catch (e) {
        console.log(`No data for year ${year}`);
      }
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    downloadJSON(backup, `jobs-backup-${timestamp}.json`);

    const yearCount = Object.keys(backup.data).length;
    onProgress?.(`✅ Jobs backup complete! ${yearCount} years backed up.`);
    return { success: true, message: `${yearCount} years backed up` };
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
export async function importCCWIssues(backupData) {
  try {
    if (!backupData.data || typeof backupData.data !== 'object') {
      throw new Error('Invalid CCW Issues backup format');
    }

    let totalRestored = 0;

    for (const [userId, userData] of Object.entries(backupData.data)) {
      if (!userData.customers) continue;

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
export async function importShearers(backupData, { replaceEverything = false } = {}) {
  try {
    if (!backupData.data) {
      throw new Error('Invalid Shearers backup format');
    }
    // set() at the tree root deletes anything not in the file. A backup taken
    // this morning would erase this afternoon's work, so the caller has to say
    // that is what it means rather than arriving here by choosing a file.
    if (!replaceEverything) {
      throw new Error('Restoring Shearers replaces the whole downtime tree. Confirm that first.');
    }

    await set(dbRef(shearersRealtimeDb, 'jti-downtime/main-logger/data'), backupData.data);

    return { success: true, message: 'Shearers data restored' };
  } catch (error) {
    console.error('Shearers import error:', error);
    return { success: false, error: error.message };
  }
}

// Import Timesheet data
export async function importTimesheet(backupData) {
  try {
    if (!backupData.data || typeof backupData.data !== 'object') {
      throw new Error('Invalid Timesheet backup format');
    }

    let totalRestored = 0;

    for (const [docId, docData] of Object.entries(backupData.data)) {
      await setDoc(doc(timesheetDb, 'timesheets', docId), docData);
      totalRestored++;
    }

    return { success: true, message: `Restored ${totalRestored} timesheet entries` };
  } catch (error) {
    console.error('Timesheet import error:', error);
    return { success: false, error: error.message };
  }
}

// Import Jobs data
export async function importJobs(backupData) {
  try {
    if (!backupData.data || typeof backupData.data !== 'object') {
      throw new Error('Invalid Jobs backup format');
    }

    let totalRestored = 0;

    for (const [year, jobsData] of Object.entries(backupData.data)) {
      await uploadString(
        storageRef(jobsStorage, `jobs-${year}.json`),
        JSON.stringify(jobsData, null, 2),
        'raw',
        { contentType: 'application/json' }
      );
      totalRestored++;
    }

    return { success: true, message: `Restored ${totalRestored} years of jobs data` };
  } catch (error) {
    console.error('Jobs import error:', error);
    return { success: false, error: error.message };
  }
}

// Import backup from file
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
