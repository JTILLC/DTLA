#!/usr/bin/env node
//
// Strip the public download token from existing Storage objects.
//
// Firebase creates a `firebaseStorageDownloadTokens` metadata entry on every
// upload, and the resulting URL BYPASSES Storage security rules — it stays
// readable forever and is not covered by share-link expiry. Removing the token
// is what actually makes an object private; the media broker then serves it
// after re-checking the share (or the caller's claims).
//
// *** THIS IS DESTRUCTIVE AND NOT REVERSIBLE. ***
// Every `url` stored in a visit document stops working. Do NOT run it until
// every client reads media through the broker:
//   - customer viewer   : MEDIA_BROKER_BASE set  (done)
//   - field apps        : MEDIA_BROKER_BASE set + deployed  <-- verify first
//   - PDF export        : goes through the broker            <-- verify first
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/revoke-download-tokens.mjs --dry-run
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/revoke-download-tokens.mjs --prefix=issue-photos/
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/revoke-download-tokens.mjs --confirm

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || !args.includes('--confirm');
const prefixArg = args.find((a) => a.startsWith('--prefix='));
const PREFIX = prefixArg ? prefixArg.split('=')[1] : 'issue-photos/';
const BUCKET = 'downtimelogger-a96fb.firebasestorage.app';

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is not set. See SECURITY.md.');
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), storageBucket: BUCKET });
const bucket = getStorage().bucket();

console.log(`${DRY_RUN ? 'DRY RUN — nothing will change' : '*** LIVE RUN — REVOKING TOKENS ***'}`);
console.log(`bucket : ${BUCKET}`);
console.log(`prefix : ${PREFIX}\n`);

let scanned = 0;
let withToken = 0;
let revoked = 0;
let failed = 0;
let pageToken;

do {
  // eslint-disable-next-line no-await-in-loop
  const [files, nextQuery] = await bucket.getFiles({
    prefix: PREFIX,
    maxResults: 500,
    autoPaginate: false,
    pageToken,
  });
  pageToken = nextQuery?.pageToken;

  for (const file of files) {
    scanned += 1;
    // eslint-disable-next-line no-await-in-loop
    const [md] = await file.getMetadata();
    if (!md.metadata?.firebaseStorageDownloadTokens) continue;
    withToken += 1;

    if (DRY_RUN) {
      if (withToken <= 10) console.log(`  would revoke: ${file.name}`);
      continue;
    }
    try {
      // Setting the key to null removes it, which invalidates the public URL.
      // eslint-disable-next-line no-await-in-loop
      await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
      revoked += 1;
      if (revoked % 25 === 0) console.log(`  revoked ${revoked}…`);
    } catch (err) {
      failed += 1;
      console.error(`  ! ${file.name}: ${err.message}`);
    }
  }
} while (pageToken);

console.log(`\nscanned ${scanned}`);
console.log(`with a public token: ${withToken}`);
if (DRY_RUN) {
  if (withToken > 10) console.log(`  (listed the first 10)`);
  console.log('\nRe-run with --confirm to revoke. Verify every client reads via');
  console.log('the broker first — this cannot be undone.');
} else {
  console.log(`revoked ${revoked}, failed ${failed}`);
}
