// A library of reusable signatures, synced to Firebase (collection `user_signatures`,
// scoped to the signed-in user) so it's shared across every JTI app and all devices.
// localStorage is a local cache for instant render; the cloud is the source of truth.
import { db, auth } from './firebase';
import { collection, query, where, getDocs, setDoc, doc, deleteDoc } from 'firebase/firestore';

const KEY = 'jti-saved-signatures';
const COL = 'user_signatures';
let seq = 0;

function readLocal() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function writeLocal(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* quota */ }
  return list;
}
function uid() { return auth.currentUser ? auth.currentUser.uid : null; }

// Instant, synchronous read from the local cache (used for first paint).
export function getSavedSignatures() { return readLocal(); }

// Pull the user's signatures from the cloud, merge with any unsynced local ones,
// refresh the cache, and return the merged list. Call on mount.
export async function fetchSignatures() {
  const u = uid();
  if (!u) return readLocal();
  try {
    const snap = await getDocs(query(collection(db, COL), where('ownerId', '==', u)));
    const cloud = snap.docs.map((d) => d.data());
    const ids = new Set(cloud.map((s) => s.id));
    const local = readLocal().filter((s) => !ids.has(s.id));
    const merged = [...cloud, ...local].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return writeLocal(merged);
  } catch { return readLocal(); }
}

export function saveSignature(name, img) {
  const entry = { id: `sig-${Date.now()}-${seq++}`, name: (name || '').trim() || 'Signature', img, ts: Date.now() };
  const list = [entry, ...readLocal()];
  writeLocal(list);
  const u = uid();
  if (u) setDoc(doc(db, COL, entry.id), { ...entry, ownerId: u }).catch(() => {});
  return list;
}

export function deleteSignature(id) {
  const list = readLocal().filter((s) => s.id !== id);
  writeLocal(list);
  if (uid()) deleteDoc(doc(db, COL, id)).catch(() => {});
  return list;
}
