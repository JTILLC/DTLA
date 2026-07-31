// src/services/partsLog.js
//
// Part and board replacements for the Shearers plant.
//
// Stored in the Realtime Database beside the span log rather than in Firestore,
// because that is what this app uses:
//
//   jti-downtime/parts-log/{entryId}          one replacement
//   jti-downtime/parts-config/boardTypes      the list operators pick from
//   jti-downtime/parts-config/bindings/{line} which machine's manual a line uses
//
// Those nodes inherit the parent's `auth != null` rule with no public-read
// carve-out, so unlike the logger data they are not visible in the customer's
// shared view.
//
// Writes use update() with a child key rather than set() on the parent, so a
// concurrent write from another device cannot clobber the rest of the log —
// the same lesson the span log already carries.
import { getDatabase, ref, onValue, update, remove } from 'firebase/database';
import { app } from '../firebaseConfig';

const db = getDatabase(app);

const LOG_PATH = 'jti-downtime/parts-log';
const CONFIG_PATH = 'jti-downtime/parts-config';

// A starting point so the list is never empty on a fresh install. Editable.
export const DEFAULT_BOARD_TYPES = [
  'Load cell amplifier',
  'Load cell',
  'Main board',
  'Feeder driver board',
  'Power supply',
  'I/O board',
  'Other part',
];

const toList = (snapshot) => {
  const val = snapshot.val() || {};
  return Object.entries(val)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => new Date(b.performedAt || 0) - new Date(a.performedAt || 0));
};

export function subscribePartsLog(cb) {
  return onValue(
    ref(db, LOG_PATH),
    (snap) => cb(toList(snap)),
    (err) => { console.error('parts log subscription failed:', err); cb([]); }
  );
}

export async function addPartsEntry(entry) {
  const id = `part_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  // An ISO string rather than a server timestamp, so the value is readable
  // immediately after the write and sorts identically offline.
  await update(ref(db, LOG_PATH), {
    [id]: { performedAt: new Date().toISOString(), ...entry },
  });
  return id;
}

export async function deletePartsEntry(id) {
  await remove(ref(db, `${LOG_PATH}/${id}`));
}

export function subscribeBoardTypes(cb) {
  return onValue(
    ref(db, `${CONFIG_PATH}/boardTypes`),
    (snap) => {
      const v = snap.val();
      cb(Array.isArray(v) && v.length ? v : DEFAULT_BOARD_TYPES);
    },
    (err) => { console.error('board types subscription failed:', err); cb(DEFAULT_BOARD_TYPES); }
  );
}

export async function saveBoardTypes(types) {
  const cleaned = (types || []).map((t) => String(t).trim()).filter(Boolean);
  await update(ref(db, CONFIG_PATH), { boardTypes: cleaned });
}

// Which machine in the parts catalog each line's parts come from.
// { [lineTitle]: { partsCustomer, folder } }
export function subscribeBindings(cb) {
  return onValue(
    ref(db, `${CONFIG_PATH}/bindings`),
    (snap) => cb(snap.val() || {}),
    (err) => { console.error('bindings subscription failed:', err); cb({}); }
  );
}

export async function saveBindings(bindings) {
  const cleaned = {};
  for (const [line, b] of Object.entries(bindings || {})) {
    if (b?.partsCustomer && b?.folder) {
      cleaned[line] = { partsCustomer: b.partsCustomer, folder: b.folder };
    }
  }
  // set-shaped on purpose: clearing a line's binding must actually remove it,
  // which a merge-style update() would not do.
  await update(ref(db, CONFIG_PATH), { bindings: cleaned });
}

export default {
  subscribePartsLog, addPartsEntry, deletePartsEntry,
  subscribeBoardTypes, saveBoardTypes, DEFAULT_BOARD_TYPES,
  subscribeBindings, saveBindings,
};
