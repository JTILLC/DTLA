// PartsViewer/src/utils/visionOcr.js
//
// Vision OCR, asked for through the Worker rather than called directly.
//
// This used to be a fetch to vision.googleapis.com with
// `import.meta.env.VITE_GOOGLE_VISION_API_KEY` in the query string. Vite inlines
// VITE_* variables into the bundle at build time, so the key shipped as plain
// text inside the app's JavaScript and could be fetched from the deployed site
// without signing in — and spent against the account that owns it.
//
// The key now lives as a secret on the ccw-media Worker. The browser sends the
// image and its Firebase ID token; the Worker checks the token and the origin
// before it spends anything.
import { auth } from '../firebase/config';

const WORKER_BASE = 'https://ccw-media.josh-c80.workers.dev';

/** Strip the data-URL prefix; the Worker wants raw base64 either way. */
const rawBase64 = (s) => String(s || '').replace(/^data:[^,]+,/, '');

/**
 * Run TEXT_DETECTION over one drawing.
 *
 * Returns Vision's own first response object, so callers keep reading
 * `textAnnotations` and its bounding boxes exactly as before.
 */
export async function detectTextInImage(imageDataUrlOrBase64, { maxResults = 100 } = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in again before running OCR.');
  const idToken = await user.getIdToken();

  const res = await fetch(`${WORKER_BASE}/vision-ocr`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: rawBase64(imageDataUrlOrBase64),
      features: [{ type: 'TEXT_DETECTION', maxResults }],
    }),
  });

  if (!res.ok) {
    // The Worker replies in plain text on failure and those messages are
    // written for the operator — surface them rather than a status code.
    const detail = (await res.text().catch(() => '')).trim();
    throw new Error(detail || `Drawing OCR failed (${res.status})`);
  }
  return res.json();
}

export default { detectTextInImage };
