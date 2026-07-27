// src/utils/photoSync.js
//
// Drains the offline photo queue (see photoQueue.js) once connectivity is back.
//
// Uploading the blob is only half the job: the resulting download URL has to
// land back in the exact slot of the visit document the photo was taken for —
// which may be a head's `photos` array or an issue's. While offline the visit
// holds a placeholder `{ pendingId }` in that slot (persisted by the app's
// normal autosave, which Firestore queues offline), so reconciliation is a
// find-and-replace on the placeholder rather than an index we'd have to keep
// valid across edits. That matters because the tech keeps working while the
// photo is queued — heads get added, issues get removed — and any positional
// reference would rot.
import firebase from 'firebase/compat/app';
import 'firebase/compat/storage';
import 'firebase/compat/firestore';
import photoQueue from './photoQueue.js';

// Swap a `{ pendingId }` placeholder for the real `{ url, path }` wherever it
// appears in a visit's lines. Returns [nextLines, replacedCount].
export function replacePendingPhoto(lines, pendingId, resolved) {
  let replaced = 0;

  const mapPhotos = (photos) =>
    (photos || []).map((p) => {
      if (p && p.pendingId === pendingId) {
        replaced += 1;
        return resolved;
      }
      return p;
    });

  const nextLines = (lines || []).map((line) => ({
    ...line,
    heads: (line.heads || []).map((head) => ({
      ...head,
      photos: mapPhotos(head.photos),
      issues: (head.issues || []).map((issue) => ({
        ...issue,
        photos: mapPhotos(issue.photos),
      })),
    })),
  }));

  return [nextLines, replaced];
}

async function uploadOne(entry) {
  const path = `${entry.pathBase}/${entry.id}.jpg`;
  const ref = firebase.storage().ref().child(path);
  await ref.put(entry.blob, { contentType: 'image/jpeg' });
  const url = await ref.getDownloadURL();
  return { url, path };
}

async function reconcile(entry, resolved) {
  const docRef = firebase.firestore().doc(entry.docPath);
  const snap = await docRef.get();
  if (!snap.exists) return false;
  const [nextLines, replaced] = replacePendingPhoto(snap.data().lines, entry.id, resolved);
  if (replaced === 0) {
    // The placeholder is gone — the head, issue or whole visit was deleted while
    // the photo sat in the queue. Drop the orphaned upload rather than retrying
    // forever; the blob is already in Storage but nothing references it.
    return true;
  }
  await docRef.update({ lines: nextLines });
  return true;
}

let draining = false;

// Upload everything queued. Safe to call repeatedly and concurrently — a second
// call while a drain is in flight is a no-op. Returns the number still pending.
//
// `onResolved(docPath, pendingId, resolved)` fires for each uploaded photo and
// MUST be handled when the visit is open in the editor. Writing the URL to
// Firestore is not enough on its own: the editor keeps its own in-memory copy of
// `lines`, so it would still hold the placeholder and its next autosave would
// overwrite the URL we just wrote — losing the photo for good, since its queue
// entry is gone by then. The callback lets the editor swap the placeholder in
// memory too, so both copies converge.
export async function drainPhotoQueue({ onProgress, onResolved } = {}) {
  if (draining || !navigator.onLine) return photoQueue.count();
  draining = true;
  try {
    const entries = await photoQueue.all();
    for (const entry of entries) {
      if (!navigator.onLine) break;
      try {
        // eslint-disable-next-line no-await-in-loop
        const resolved = await uploadOne(entry);
        // Update the open editor BEFORE clearing the queue entry, so a failure
        // here still leaves the photo queued rather than stranded.
        onResolved?.(entry.docPath, entry.id, resolved);
        // eslint-disable-next-line no-await-in-loop
        const done = await reconcile(entry, resolved);
        // eslint-disable-next-line no-await-in-loop
        if (done) await photoQueue.remove(entry.id);
        onProgress?.();
      } catch (err) {
        // Leave it queued and try again on the next reconnect. Don't let one
        // bad entry (e.g. a since-deleted visit) block the rest.
        console.warn('Photo sync retry pending for', entry.id, err?.message || err);
      }
    }
  } finally {
    draining = false;
  }
  return photoQueue.count();
}

// Retry on reconnect and once at startup. Returns an unsubscribe function.
export function startPhotoSync({ onProgress, onResolved } = {}) {
  const run = () => { drainPhotoQueue({ onProgress, onResolved }).catch(() => {}); };
  window.addEventListener('online', run);
  run();
  return () => window.removeEventListener('online', run);
}

export default { drainPhotoQueue, startPhotoSync, replacePendingPhoto };
