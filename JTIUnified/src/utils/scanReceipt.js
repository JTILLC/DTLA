// src/utils/scanReceipt.js
//
// Read a receipt photo into { vendor, date, total } so the expense fields fill
// themselves in.
//
// Calls POST /scan-receipt on the ccw-media Worker, which is where the
// Anthropic key lives. The key stays server-side for the obvious reason: a key
// shipped in a browser bundle is a key anyone can spend.
//
// The token is this app's Firebase ID token for the CCW project — the same
// sign-in the dashboard already holds, and the same one /scan-weights uses, so
// nobody has to sign in twice.
//
// Everything it returns is a SUGGESTION. The caller fills the fields and the
// person checks them before the packet is built, because these figures end up
// on an invoice sent to a customer.
import { ccwIssuesAuth } from '../firebase-config';

const BROKER = 'https://ccw-media.josh-c80.workers.dev';

/** Largest image worth sending. Anything bigger is downscaled first. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

/**
 * Shrink a photo before it goes over the wire.
 *
 * A modern phone camera produces 3–8 MB, the Worker rejects over 4 MB, and a
 * receipt is legible at a fraction of that. Downscaling here means somebody in
 * a van on a weak signal is not uploading eight megabytes to read one number.
 */
export const prepareImage = (file) => new Promise((resolve, reject) => {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
  img.src = url;
});

/** Ask the Worker to read a receipt. Throws with a message worth showing. */
export async function scanReceipt(file) {
  const user = ccwIssuesAuth.currentUser;
  if (!user) throw new Error('Sign in again before scanning.');
  const idToken = await user.getIdToken();

  const dataUrl = await prepareImage(file);

  const res = await fetch(`${BROKER}/scan-receipt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl }),
  });

  if (!res.ok) {
    // The Worker replies in plain text on failure and those messages are
    // written to be read by a person — surface them rather than a status code.
    const detail = (await res.text().catch(() => '')).trim();
    throw new Error(detail || `Receipt reading failed (${res.status})`);
  }
  return res.json();
}

export default scanReceipt;
