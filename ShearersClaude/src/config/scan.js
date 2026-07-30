// src/config/scan.js
//
// Sends a photo of the weigher screen to the CCW media Worker and gets back the
// head/weight pairs it could read. The API key lives in the Worker, never here.
//
// Shearers is a different Firebase project (shearers-4c4b4) from the CCW apps,
// so the Worker has to allow-list it explicitly — see SCAN_PROJECT_IDS in
// media-worker/wrangler.toml. Sign-in here is email/password only, so a verified
// token is enough; there are no anonymous accounts to gate against.
//
// Returns { heads: [{head, weight, confident}], unit, notes }. It is a READING,
// not a decision: the caller shows it for review and the operator still saves.
import { getAuth } from 'firebase/auth';
import { app } from '../firebaseConfig';

const BROKER = 'https://ccw-media.josh-c80.workers.dev';

export async function scanWeigherScreen(blob) {
  const user = getAuth(app).currentUser;
  if (!user) throw new Error('not signed in');
  const idToken = await user.getIdToken();

  const b64 = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]+,/, ''));
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });

  const res = await fetch(`${BROKER}/scan-weights`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: b64 }),
  });
  if (!res.ok) {
    // The Worker replies in plain text on failure, and those messages are
    // written for the operator — surface them rather than a status code.
    const detail = (await res.text().catch(() => '')).trim();
    throw new Error(detail || `Screen reading failed (${res.status})`);
  }
  return res.json();
}
