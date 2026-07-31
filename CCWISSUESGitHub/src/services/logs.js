// src/services/logs.js
//
// Shared read/write plumbing for the customer-level maintenance logs:
//   spanLog   — span adjustments, who did them and the weights at the time
//   boardLog  — circuit board replacements
//   pmLog     — preventative maintenance submissions
//   pmTemplate — the PM checklist definition (admin-editable)
//
// These live under the CUSTOMER, not inside a visit:
//
//   user_files/{workspaceId}/customers/{customerId}/{logName}/{entryId}
//
// A visit is one service call, but the question these logs answer — "when was
// this last done?" — spans visits. It also lets the original app (visit-based)
// and the customer fork (shift-based) write to the same history, and the
// share-link viewer read it, with no duplication.
//
// Security: firestore.rules already matches customers/{cid}/{document=**}, so
// these collections inherit read access (admin, that customer's login, or the
// viewer while an unexpired share exists) and write access (admin, or the
// customer) without any rule change.
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

export const LOG_SPAN = 'spanLog';
export const LOG_BOARD = 'boardLog';
export const LOG_PM = 'pmLog';
export const PM_TEMPLATE = 'pmTemplate';
export const CONFIG = 'config';

const col = (workspaceId, customerId, name) =>
  firebase
    .firestore()
    .collection('user_files')
    .doc(workspaceId)
    .collection('customers')
    .doc(customerId)
    .collection(name);

// Newest first — every screen that shows these wants the most recent at top.
export async function listLog(workspaceId, customerId, name, max = 200) {
  if (!workspaceId || !customerId) return [];
  const snap = await col(workspaceId, customerId, name)
    .orderBy('performedAt', 'desc')
    .limit(max)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Live version, for screens that should update while a customer is filling one in.
export function subscribeLog(workspaceId, customerId, name, cb, max = 200) {
  if (!workspaceId || !customerId) return () => {};
  return col(workspaceId, customerId, name)
    .orderBy('performedAt', 'desc')
    .limit(max)
    .onSnapshot(
      (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error(`${name} subscription failed:`, err)
    );
}

export async function addLogEntry(workspaceId, customerId, name, entry) {
  if (!workspaceId || !customerId) throw new Error('Missing customer');
  const id = `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  // performedAt is an ISO string rather than a serverTimestamp so the value is
  // readable straight after write (no null-until-round-trip) and sorts
  // identically for the offline queue.
  const payload = {
    performedAt: new Date().toISOString(),
    ...entry,
  };
  await col(workspaceId, customerId, name).doc(id).set(payload);
  return { id, ...payload };
}

export async function updateLogEntry(workspaceId, customerId, name, id, patch) {
  await col(workspaceId, customerId, name).doc(id).update(patch);
}

export async function deleteLogEntry(workspaceId, customerId, name, id) {
  await col(workspaceId, customerId, name).doc(id).delete();
}

// Most recent entry, optionally filtered — powers "last performed" summaries.
export function latestEntry(entries, predicate) {
  const list = predicate ? (entries || []).filter(predicate) : entries || [];
  return list.length ? list[0] : null;   // already sorted desc
}

// "3 days ago" / "today" — friendlier than a raw date when the whole point is
// noticing that something is overdue.
export function sinceLabel(iso) {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

// ---- Per-customer configuration -------------------------------------------
// Board types are set up in the ORIGINAL app and consumed by the customer app,
// so a plant's operators pick from the list JTI defined for that site rather
// than a hardcoded one. Stored per customer because equipment differs between
// factories.
//
// Existing log entries store the type as a STRING, so renaming or removing a
// type never rewrites history — old entries keep the name they were logged
// with. That's deliberate: the log should say what was actually recorded.
const configDoc = (workspaceId, customerId, key) =>
  firebase
    .firestore()
    .collection('user_files')
    .doc(workspaceId)
    .collection('customers')
    .doc(customerId)
    .collection(CONFIG)
    .doc(key);

// One-off read of ANOTHER customer's config, for the copy-from-customer flows.
// Setting up a second plant shouldn't mean retyping a checklist or a board list
// that already exists a few customers over.
//
// Reads within the same workspace only — every path is
// user_files/{workspaceId}/..., so this can't reach another JTI account's data.
export async function fetchConfig(workspaceId, customerId, key) {
  if (!workspaceId || !customerId) return null;
  const snap = await configDoc(workspaceId, customerId, key).get();
  return snap.exists ? snap.data() : null;
}

export function subscribeBoardTypes(workspaceId, customerId, cb) {
  if (!workspaceId || !customerId) return () => {};
  return configDoc(workspaceId, customerId, 'boardTypes').onSnapshot(
    (snap) => cb(snap.exists ? (snap.data().types || []) : null),
    (err) => { console.error('board types subscription failed:', err); cb(null); }
  );
}

export async function saveBoardTypes(workspaceId, customerId, types) {
  await configDoc(workspaceId, customerId, 'boardTypes').set({
    types: (types || []).map((t) => String(t).trim()).filter(Boolean),
    updatedAt: new Date().toISOString(),
  });
}

// ---- PM checklist template -------------------------------------------------
// Defined by JTI, filled in by the plant. Stored per customer alongside the
// board types, for the same reason: what needs checking differs between sites.
//
// Shape: { sections: [{ id, title, items: [{ id, label, type }] }] }
//   type 'check' -> OK / Issue / N/A plus an optional note
//   type 'value' -> a reading typed in (pressure, temperature, count…)
//
// A SUBMISSION copies each item's label into itself rather than referencing the
// template by id. Templates get edited — items renamed, removed — and a
// submission has to keep meaning what it meant on the day it was signed. A
// reference would silently rewrite history.
export function subscribePmTemplate(workspaceId, customerId, cb) {
  if (!workspaceId || !customerId) return () => {};
  return configDoc(workspaceId, customerId, 'pmTemplate').onSnapshot(
    (snap) => cb(snap.exists ? (snap.data() || null) : null),
    (err) => { console.error('PM template subscription failed:', err); cb(null); }
  );
}

export async function savePmTemplate(workspaceId, customerId, sections) {
  await configDoc(workspaceId, customerId, 'pmTemplate').set({
    sections: sections || [],
    updatedAt: new Date().toISOString(),
  });
}

// A starting point so a new customer isn't staring at a blank checklist. Edit
// freely — this is only used when nothing has been saved yet.
export const DEFAULT_PM_SECTIONS = [
  {
    id: 'daily',
    title: 'Daily checks',
    items: [
      { id: 'd1', label: 'Product contact surfaces clean', type: 'check' },
      { id: 'd2', label: 'No product build-up in hoppers', type: 'check' },
      { id: 'd3', label: 'Discharge chute clear', type: 'check' },
      { id: 'd4', label: 'Air pressure', type: 'value' },
    ],
  },
  {
    id: 'weekly',
    title: 'Weekly checks',
    items: [
      { id: 'w1', label: 'Load cell covers secure', type: 'check' },
      { id: 'w2', label: 'Drive belts / feeders inspected', type: 'check' },
      { id: 'w3', label: 'Hopper gates operate freely', type: 'check' },
      { id: 'w4', label: 'Guards and safety switches working', type: 'check' },
    ],
  },
];

// Due-date helpers. The schedule lives on the newest log entry (`nextDueAt`)
// rather than in a separate settings doc: the interval is a property of the
// work that was done, so re-scheduling is just logging the next one, and there
// is no second place to fall out of sync.
export function dueStatus(nextDueAt) {
  if (!nextDueAt) return { state: 'none', label: 'No schedule set', days: null };
  const due = new Date(nextDueAt).getTime();
  if (Number.isNaN(due)) return { state: 'none', label: 'No schedule set', days: null };
  // Compare whole days so "due today" doesn't flip to overdue at lunchtime.
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const startOfDue = new Date(due); startOfDue.setHours(0, 0, 0, 0);
  const days = Math.round((startOfDue - startOfToday) / 86400000);
  if (days < 0) return { state: 'overdue', label: `Overdue by ${-days} day${days === -1 ? '' : 's'}`, days };
  if (days === 0) return { state: 'due', label: 'Due today', days };
  if (days <= 7) return { state: 'soon', label: `Due in ${days} day${days === 1 ? '' : 's'}`, days };
  return { state: 'ok', label: `Due ${new Date(due).toLocaleDateString()}`, days };
}

export function addDays(iso, days) {
  const d = iso ? new Date(iso) : new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString();
}

export default {
  LOG_SPAN, LOG_BOARD, LOG_PM, PM_TEMPLATE,
  listLog, subscribeLog, addLogEntry, updateLogEntry, deleteLogEntry,
  latestEntry, sinceLabel, dueStatus, addDays,
  subscribeBoardTypes, saveBoardTypes,
  subscribePmTemplate, savePmTemplate, DEFAULT_PM_SECTIONS,
};
