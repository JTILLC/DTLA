// src/services/photoThumbs.js
//
// Tiny copies of photos, kept for the daily PDF.
//
// The report cannot reference an image by URL — the bytes have to be in the
// file — and every attempt to re-download them at export time has been at the
// mercy of something outside the app: CORS on the download, a cached opaque
// response, a filtering network, an object since deleted. The bytes are already
// in memory at upload, where none of that applies, so a thumbnail is kept then.
//
// Stored in their OWN node rather than beside the photo in the log entry. The
// logger reads a whole day of entries on every page view; ten photos' worth of
// base64 inline would be ~100KB added to every one of those reads, on a phone,
// on plant wifi. Here they cost nothing until a report is actually exported.
//
//   jti-downtime/photo-thumbs/{key} -> "data:image/jpeg;base64,…"
//
// Keyed by the Storage path, which is already unique (timestamp + random) and
// survives an entry being edited or re-saved.
import { getDatabase, ref, get, update } from 'firebase/database';
import { app } from '../firebaseConfig';

const db = getDatabase(app);
const PATH = 'jti-downtime/photo-thumbs';

// RTDB keys cannot contain . $ # [ ] or /. The Storage path contains / and .,
// so they are folded to _ . Uniqueness still comes from the filename's
// timestamp and random suffix, which this cannot collide away.
export const thumbKey = (storagePath) => String(storagePath || '').replace(/[.#$/[\]]/g, '_');

// Best effort by design: a missing thumbnail costs a slower export, while a
// failed write that propagated would cost the photo upload itself.
export async function saveThumb(storagePath, dataUrl) {
  if (!storagePath || !dataUrl) return;
  try {
    await update(ref(db, PATH), { [thumbKey(storagePath)]: dataUrl });
  } catch (err) {
    console.warn('thumbnail not stored (export will download instead):', err?.message || err);
  }
}

// One read at export time, rather than one per photo.
export async function fetchThumbs() {
  try {
    const snap = await get(ref(db, PATH));
    return snap.val() || {};
  } catch (err) {
    console.warn('thumbnails unavailable, export will download instead:', err?.message || err);
    return {};
  }
}

export default { thumbKey, saveThumb, fetchThumbs };
