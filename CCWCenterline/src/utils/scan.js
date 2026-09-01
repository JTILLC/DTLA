// Calling the RCU screen reader.
//
// The reader lives in the ccw-media Worker (POST /scan-rcu-screen), not here:
// it spends money per call and holds an API key, so it sits behind a verified
// Firebase token and an origin allow-list. The browser never sees the key.
//
// Same shape as shared/config/media.js's scanWeigherScreen in the CCW apps.

export const MEDIA_BROKER_BASE = 'https://ccw-media.josh-c80.workers.dev';

/** A blob as bare base64, without the data: prefix the Worker would reject. */
const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]+,/, ''));
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });

/**
 * Read the settings off a straightened screen image.
 *
 * `getIdToken` is passed in rather than reaching for a global auth object, so
 * the reader works whichever way this app ends up signing in.
 *
 * Returns { screenTitle, activeTab, fields: [{label, value, enabled, confident}], notes }.
 * Every field comes back for review — nothing here is authoritative, because a
 * misread value printed on a customer's specification is worse than a gap.
 */
export async function scanRcuScreen(blob, getIdToken) {
  const idToken = await getIdToken?.();
  if (!idToken) {
    throw new Error('Sign in first — reading a screen needs an account.');
  }

  const res = await fetch(`${MEDIA_BROKER_BASE}/scan-rcu-screen`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: await toBase64(blob) }),
  });

  if (!res.ok) {
    // The Worker replies in plain text on failure and those messages are
    // written for the engineer on the plant floor — surface them rather than a
    // status code.
    const detail = (await res.text().catch(() => '')).trim();
    throw new Error(detail || `Screen reading failed (${res.status})`);
  }
  return res.json();
}

/** Is the reader configured and reachable? Used to explain why it is greyed out. */
export async function readerAvailable() {
  try {
    const res = await fetch(`${MEDIA_BROKER_BASE}/health?cb=${Date.now()}`);
    if (!res.ok) return false;
    return (await res.json())?.scanRcuScreen === true;
  } catch {
    return false;
  }
}

/** A canvas as a JPEG blob, at a size the Worker will accept. */
export const canvasToJpeg = (canvas, quality = 0.9) =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
