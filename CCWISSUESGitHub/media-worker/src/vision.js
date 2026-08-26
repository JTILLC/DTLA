// src/vision.js
//
// Google Cloud Vision, behind the Worker instead of in the browser.
//
// PartsViewer called Vision directly with `VITE_GOOGLE_VISION_API_KEY`. Vite
// inlines VITE_* variables into the bundle at build time, so the key was served
// as plain text in the app's JavaScript — fetchable without signing in, by
// anyone who knew the URL, and billable to the account that owns it.
//
// The key lives here now as a Worker secret and never leaves the edge. The
// route in index.js applies the same gate as /scan-weights: a verified Firebase
// ID token from an allow-listed project, and an allow-listed origin. Same
// reasoning too — this route spends money per call.

const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

// Vision bills per image; a runaway retry loop on a phone should cost pennies,
// not a bill. Same shape as the weigher-screen limiter.
const RATE = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

const rateLimited = (uid) => {
  const now = Date.now();
  const hits = (RATE.get(uid) || []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  RATE.set(uid, hits);
  return hits.length > MAX_PER_WINDOW;
};

// Vision's own request cap is 20MB for the base64 payload; stop well short so a
// large drawing fails here with a sentence rather than there with a 400.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Who may spend a Vision call.
 *
 * PartsViewer signs in against its own Firebase project, so a token from any
 * allow-listed project is accepted — the allow-list is the gate. On the CCW
 * project the same claims rule as the weigher scanner applies, so a customer
 * login cannot quietly start billing OCR.
 */
export const mayUseVision = (claims, ccwProjectId) => {
  if (claims?.firebase?.sign_in_provider === 'anonymous') return false;
  if (claims?.aud === ccwProjectId) {
    return claims.admin === true || !!claims.customerId;
  }
  return true;
};

/**
 * Proxy one TEXT_DETECTION request.
 *
 * The response is passed through untouched: the caller wants Vision's own
 * `textAnnotations`, with the bounding boxes it uses to place hotspots, and
 * reshaping them here would mean two places to change when that placement is
 * tuned.
 */
export async function visionOcr(env, claims, body) {
  if (rateLimited(claims.sub)) {
    const err = new Error('Too many OCR requests in the last minute — give it a moment.');
    err.status = 429;
    throw err;
  }

  const b64 = typeof body?.image === 'string' ? body.image.replace(/^data:[^,]+,/, '') : '';
  if (!b64) {
    const err = new Error('No image supplied.');
    err.status = 400;
    throw err;
  }
  if (Math.floor((b64.length * 3) / 4) > MAX_IMAGE_BYTES) {
    const err = new Error('That drawing is too large to read — export it at a lower quality.');
    err.status = 413;
    throw err;
  }

  const features = Array.isArray(body?.features) && body.features.length
    ? body.features
    : [{ type: 'TEXT_DETECTION' }];

  const res = await fetch(`${VISION_ENDPOINT}?key=${env.GOOGLE_VISION_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ image: { content: b64 }, features }] }),
  });

  const text = await res.text();
  if (!res.ok) {
    // Never surface Vision's body to the browser: a misconfigured key produces
    // an error that quotes the key back. Log it, tell the operator something
    // useful, and keep the two separate.
    const err = new Error('Could not read that drawing. Try again, or place the hotspots by hand.');
    err.status = res.status >= 500 ? 502 : 500;
    err.cause = text.slice(0, 500);
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const err = new Error('Vision returned something unreadable.');
    err.status = 502;
    err.cause = text.slice(0, 200);
    throw err;
  }

  const first = parsed?.responses?.[0] || {};
  if (first.error) {
    const err = new Error('Could not read that drawing.');
    err.status = 502;
    err.cause = JSON.stringify(first.error).slice(0, 500);
    throw err;
  }
  return first;
}

export default { visionOcr, mayUseVision };
