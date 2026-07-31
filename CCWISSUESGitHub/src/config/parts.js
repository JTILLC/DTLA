// src/config/parts.js
//
// Reads the Parts Viewer catalog through the media Worker.
//
// The catalog lives in a different Firebase project, so the browser cannot read
// it directly — a second client-side Firebase app would mean a second login on
// a second project. The Worker holds a service account for it instead.
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import { MEDIA_BROKER_BASE } from './media.js';

const authedJson = async (path) => {
  const user = firebase.auth().currentUser;
  if (!user) throw new Error('not signed in');
  const idToken = await user.getIdToken();
  const res = await fetch(`${MEDIA_BROKER_BASE}${path}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).trim();
    throw new Error(detail || `Parts lookup failed (${res.status})`);
  }
  return res.json();
};

// The customer -> folder tree, for the JTI screen that binds a line to a
// machine. Admin-only at the Worker.
export const fetchPartsCatalog = () => authedJson('/parts/catalog');

// Every part in one machine's manual. A folder IS one machine.
export const fetchPartsForMachine = (partsCustomer, folder) =>
  authedJson(
    `/parts/parts?customer=${encodeURIComponent(partsCustomer)}&folder=${encodeURIComponent(folder)}`
  );

// Rank matches so an exact part number wins over an incidental substring in a
// description. Operators type the number far more often than the name.
export function searchParts(parts, query, limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const scored = [];
  for (const p of parts) {
    const code = (p.partCode || '').toLowerCase();
    const item = String(p.itemNo || '').toLowerCase();
    const name = (p.partName || '').toLowerCase();
    let score = -1;
    if (code === q || item === q) score = 0;
    else if (code.startsWith(q)) score = 1;
    else if (item.startsWith(q)) score = 2;
    else if (code.includes(q)) score = 3;
    else if (name.includes(q)) score = 4;
    if (score >= 0) scored.push({ p, score });
  }
  scored.sort((a, b) =>
    a.score - b.score
    || (a.p.partCode || '').localeCompare(b.p.partCode || '', undefined, { numeric: true })
  );
  return scored.slice(0, limit).map((s) => s.p);
}

export default { fetchPartsCatalog, fetchPartsForMachine, searchParts };
