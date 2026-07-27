// src/config/media.js
//
// Authenticated media delivery for the field apps.
//
// Firebase creates a public download token for every uploaded object, and those
// tokenized URLs bypass Storage security rules entirely. To make photos actually
// private we strip that token — which means the app can no longer just point an
// <img> at a stored `url`. Instead it asks the media broker, proving who it is
// with the signed-in user's Firebase ID token. The broker authorises against the
// same custom claims (`admin` / `customerId`) that storage.rules uses.
//
// `<img src>` cannot send an Authorization header, so images are fetched in JS
// and rendered from an object URL. That's the same trick already used to preview
// photos still sitting in the offline queue.
//
// MEDIA_BROKER_BASE empty => legacy behaviour: render the stored public `url`.
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';

export const MEDIA_BROKER_BASE = 'https://ccw-media.josh-c80.workers.dev';

// True once media should be fetched through the broker rather than by public URL.
export const usingBroker = () => !!MEDIA_BROKER_BASE;

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

// Fetch one object through the broker and return an object URL for it.
// Callers MUST revoke the returned URL when done (see useAuthedMedia).
export async function fetchAuthedMedia(path) {
  const user = firebase.auth().currentUser;
  if (!user) throw new Error('not signed in');
  const idToken = await user.getIdToken();       // refreshes automatically when stale
  const res = await fetch(`${MEDIA_BROKER_BASE}/a/${encodePath(path)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) throw new Error(`media ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

// Same, but returns a data: URL — jsPDF needs the bytes inline, and going
// through the broker avoids the canvas-tainting/CORS dance the old
// `<img crossOrigin>` approach depended on.
export async function fetchAuthedDataUrl(path) {
  const user = firebase.auth().currentUser;
  if (!user) throw new Error('not signed in');
  const idToken = await user.getIdToken();
  const res = await fetch(`${MEDIA_BROKER_BASE}/a/${encodePath(path)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) throw new Error(`media ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

export default { MEDIA_BROKER_BASE, usingBroker, fetchAuthedMedia, fetchAuthedDataUrl };
