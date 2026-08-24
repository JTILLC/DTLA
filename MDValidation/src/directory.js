// Customer records and reserved job numbers, read from the same Firebase
// project the CCW apps keep them in.
//
// This app already signs into that project, and for JTI's own account the
// workspace root is simply user_files/{uid} — the same documents CCW Issues
// and the dashboard edit. Read-only here on purpose: a validation form fills
// itself from the record, it never becomes a second place customers are
// maintained. Any other account gets an empty list (the rules refuse it or
// there is nothing under its uid) and the picker simply stays hidden.
import { db } from './firebase';
import { collection, getDocs } from 'firebase/firestore';

export async function fetchCustomerRecords(uid) {
  const snap = await getDocs(collection(db, 'user_files', uid, 'customers'));
  return snap.docs.map((d) => {
    const data = d.data() || {};
    const profile = data.profile || {};
    return {
      id: d.id,
      // The name lives on the profile in CCW; older docs kept it at the top.
      name: profile.name || data.name || '',
      profile: {
        address: '', cityState: '', contacts: [], invoiceEmails: [], aliases: [], notes: '',
        ...profile,
      },
    };
  }).filter((c) => c.name);
}

// Job numbers the dashboard has handed out and not yet closed. Published by
// the dashboard into user_files/{uid}/sr_directory (see publishToTimesheet);
// each carries the customer's canonical id so a picked job also picks the
// plant without matching on spelling.
export async function fetchOpenJobs(uid) {
  const snap = await getDocs(collection(db, 'user_files', uid, 'sr_directory'));
  return snap.docs
    .map((d) => d.data() || {})
    .filter((j) => j.sr)
    .sort((a, b) => String(b.sr).localeCompare(String(a.sr)));
}
