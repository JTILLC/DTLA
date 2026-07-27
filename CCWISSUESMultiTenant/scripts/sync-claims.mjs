#!/usr/bin/env node
//
// Mirror the `app_roles` Firestore collection into Firebase Auth CUSTOM CLAIMS.
//
// Why this exists: Firestore security rules can read `app_roles` directly, but
// STORAGE rules cannot read Firestore at all. Storage therefore had no way to
// tell one tenant from another, which is why its write rule was an unscoped
// `request.auth != null` — any authenticated user could overwrite or delete any
// other tenant's photos. Putting `admin` / `customerId` on the auth token closes
// that hole (see storage.rules).
//
// Run this whenever a role changes in app_roles. Claims are small and change
// rarely, so a manual/scheduled sync is fine — no always-on infrastructure.
//
// Usage:
//   npm i -D firebase-admin
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json \
//     node scripts/sync-claims.mjs [--dry-run]
//
// Get the key from: Firebase Console -> Project settings -> Service accounts ->
// "Generate new private key". NEVER commit it.

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const DRY_RUN = process.argv.includes('--dry-run');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    'GOOGLE_APPLICATION_CREDENTIALS is not set.\n' +
      'Point it at a service account key JSON for the Firebase project, e.g.\n' +
      '  GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/sync-claims.mjs --dry-run'
  );
  process.exit(1);
}

if (getApps().length === 0) initializeApp({ credential: applicationDefault() });

const db = getFirestore();
const auth = getAuth();

const snap = await db.collection('app_roles').get();
if (snap.empty) {
  console.log('app_roles is empty — nothing to sync.');
  process.exit(0);
}

let updated = 0;
let skipped = 0;
let failed = 0;

for (const doc of snap.docs) {
  const uid = doc.id;
  const { admin = false, customerId = null } = doc.data() || {};
  // Only the two fields the Storage rules consult. Keep this minimal: claims ride
  // on every ID token and are capped at 1000 bytes.
  const desired = { admin: admin === true, customerId: customerId || null };

  try {
    const user = await auth.getUser(uid);
    const current = user.customClaims || {};
    const same =
      (current.admin === true) === desired.admin &&
      (current.customerId ?? null) === desired.customerId;

    if (same) {
      skipped += 1;
      continue;
    }

    console.log(
      `${DRY_RUN ? '[dry-run] ' : ''}${user.email || uid}: ` +
        `admin=${desired.admin} customerId=${desired.customerId ?? '—'}`
    );
    if (!DRY_RUN) await auth.setCustomUserClaims(uid, desired);
    updated += 1;
  } catch (err) {
    failed += 1;
    console.error(`  ! ${uid}: ${err.message}`);
  }
}

console.log(
  `\n${DRY_RUN ? 'Would update' : 'Updated'} ${updated}, unchanged ${skipped}, failed ${failed}.`
);
if (updated > 0 && !DRY_RUN) {
  console.log(
    'Claims take effect on the next ID token refresh (~1h, or immediately on re-login).'
  );
}
