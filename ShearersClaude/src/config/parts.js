// src/config/parts.js
//
// Reads the Parts Viewer catalog through the CCW media Worker.
//
// The catalog lives in a third Firebase project (jobs-data-17ee4) — not this
// app's, and not the CCW apps' either — so the browser cannot read it directly.
// The Worker holds a service account for it and gates every call on a Firebase
// ID token; this project is allow-listed there.
//
// Why this app never asks for the whole catalog
// ---------------------------------------------
// /parts/catalog lists EVERY customer in the Parts Viewer, so it is admin-only.
// This app asks /parts/folders for its own plants by name instead, which
// answers "which machines do we have?" without ever naming another plant.
import { getAuth } from 'firebase/auth';
import { app } from '../firebaseConfig';

const BROKER = 'https://ccw-media.josh-c80.workers.dev';

// The plants this site owns in the parts catalog. Both exist there; which
// machine a given line actually is gets bound per line on the Parts page,
// because that is plant knowledge, not something to guess from a line number.
export const PARTS_CUSTOMERS = ['Shearers (NEW)', 'Shearers Brewster'];

const authed = async (path) => {
  const user = getAuth(app).currentUser;
  if (!user) throw new Error('not signed in');
  const idToken = await user.getIdToken();
  const res = await fetch(`${BROKER}${path}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).trim();
    throw new Error(detail || `Parts lookup failed (${res.status})`);
  }
  return res;
};

const authedJson = async (path) => (await authed(path)).json();

export const fetchOurMachines = () =>
  authedJson(`/parts/folders?customers=${encodeURIComponent(PARTS_CUSTOMERS.join(','))}`);

export const fetchPartsForMachine = (customer, folder) =>
  authedJson(`/parts/parts?customer=${encodeURIComponent(customer)}&folder=${encodeURIComponent(folder)}`);

export const fetchDiagrams = (customer, folder) =>
  authedJson(`/parts/diagrams?customer=${encodeURIComponent(customer)}&folder=${encodeURIComponent(folder)}`);

export const fetchDiagram = (diagramId) =>
  authedJson(`/parts/diagram?id=${encodeURIComponent(diagramId)}`);

// Object URL — the caller must revoke it. An <img> cannot send an
// Authorization header, so the bytes are fetched in JS.
export async function fetchDiagramImage(diagramId) {
  const res = await authed(`/parts/diagram-image?id=${encodeURIComponent(diagramId)}`);
  return URL.createObjectURL(await res.blob());
}

// Rank matches so an exact part number beats an incidental substring in a
// description — operators type the number far more often than the name.
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

export default {
  PARTS_CUSTOMERS, fetchOurMachines, fetchPartsForMachine, fetchDiagrams,
  fetchDiagram, fetchDiagramImage, searchParts,
};
