// shared/utils/photoUpload.js
//
// Take a photo from a phone and put it somewhere the broker can serve it.
//
// This was written twice — once for reference images on a PM checklist item,
// once for issue photos — and a third copy was about to appear for pre-start
// checks. The three had already drifted apart on the detail that matters most:
// stripping the download token. A copy that forgets it uploads a customer's
// equipment photo with a permanent public URL, which is exactly the hole the
// media broker exists to close.
//
// So it lives here once.

import firebase from 'firebase/compat/app';
import 'firebase/compat/storage';

const MAX_DIM = 1400;
const JPEG_QUALITY = 0.8;

/**
 * Shrink and re-encode to JPEG. Resolves null if the browser cannot decode it.
 *
 * iOS shoots HEIC, which only Safari decodes. Rejecting what will not decode
 * beats storing bytes that nothing can render — a photo that silently fails to
 * display later is worse than one that fails to upload now, while the person
 * who took it is still standing at the machine.
 */
export const compressImage = (file) =>
  new Promise((resolve) => {
    if (!file || !file.type?.startsWith('image/')) return resolve(null);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => resolve(b || null), 'image/jpeg', JPEG_QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });

export const HEIC_HINT = "If it's a HEIC photo from an iPhone, save it as JPEG first.";

/**
 * Compress, upload, and revoke the public token. Returns { path }.
 *
 * Throws with a readable message rather than a Firebase error code, because
 * the only person who ever sees it is standing on a factory floor.
 */
export async function uploadPhoto(pathPrefix, file) {
  const blob = await compressImage(file);
  if (!blob) {
    const err = new Error(`Couldn't read "${file?.name || 'that photo'}". ${HEIC_HINT}`);
    err.unreadable = true;
    throw err;
  }
  const path = `${pathPrefix}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
  const ref = firebase.storage().ref().child(path);
  await ref.put(blob, { contentType: 'image/jpeg' });
  // Firebase mints a public download token on upload. Left in place, anyone
  // holding the URL reads the object forever, with no sign-in and no way to
  // revoke it short of deleting the file. Best-effort: an object that uploaded
  // but kept its token is still better than losing the photo, and the broker
  // path does not depend on this succeeding.
  try {
    await ref.updateMetadata({ customMetadata: { firebaseStorageDownloadTokens: '' } });
  } catch (err) {
    console.warn('Could not revoke public token:', err?.message || err);
  }
  return { path };
}

export async function deletePhoto(path) {
  if (!path) return;
  try {
    await firebase.storage().ref().child(path).delete();
  } catch (err) {
    // A photo already gone, or one the rules will not let this account remove,
    // must not block the edit that removed it from the record.
    console.warn('Could not delete photo:', err?.message || err);
  }
}

export default { compressImage, uploadPhoto, deletePhoto, HEIC_HINT };
