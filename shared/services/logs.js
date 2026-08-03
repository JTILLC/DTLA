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
import { isSiteLead } from '../utils/roles.js';
import { normalizeTypes } from '../utils/boardTypes.js';

export const LOG_SPAN = 'spanLog';
export const LOG_BOARD = 'boardLog';
export const LOG_PM = 'pmLog';
export const LOG_CREW = 'crewLog';
export const LOG_HEAD = 'headLog';
export const PM_TEMPLATE = 'pmTemplate';
// The daily pre-start walk. Its own log and its own template, kept apart from
// PM: PM is maintenance work, and an operator doing a before-shift check should
// not have to open a screen full of span checks and fuse ratings to find it.
export const LOG_PRESTART = 'prestartLog';
export const PRESTART_TEMPLATE = 'prestartTemplate';
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

// A head carries only its LATEST status change, so the head document alone can
// never answer "how often has this one been stopped this month". Every stop,
// restart and fix is therefore also appended here — the head keeps the current
// state for the screens that render it, and this keeps the history.
//
// Best-effort by design: a failure to write the history must not stop an
// operator taking a head offline. The machine matters more than the audit.
export async function addHeadEvent(workspaceId, customerId, event) {
  if (!workspaceId || !customerId) return null;
  try {
    return await addLogEntry(workspaceId, customerId, LOG_HEAD, event);
  } catch (err) {
    console.warn('head event not recorded:', err?.message || err);
    return null;
  }
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

// Types are normalised on the way out, so a list saved from an older screen (bare
// strings) and one saved from the current editor (objects carrying a part number)
// both land in the same shape. See shared/utils/boardTypes.js.
export async function saveBoardTypes(workspaceId, customerId, types) {
  await configDoc(workspaceId, customerId, 'boardTypes').set({
    types: normalizeTypes(types),
    updatedAt: new Date().toISOString(),
  });
}

// ---- Crew roster -----------------------------------------------------------
// The people who work this plant, so a log entry can say WHO rather than which
// login. A plant tablet signs in as one shared account, so the account name
// answers "which customer", never "which person".
//
// Shape: { people: [{ id, name, roles: ['operator'|'tech'|'supervisor'] }] }
//
// A person may hold several roles — the tech on nights is often the supervisor
// too — so roles is a list rather than one value.
export function subscribeCrew(workspaceId, customerId, cb) {
  if (!workspaceId || !customerId) return () => {};
  return configDoc(workspaceId, customerId, 'crew').onSnapshot(
    (snap) => cb(snap.exists ? (snap.data().people || []) : []),
    (err) => { console.error('crew subscription failed:', err); cb([]); }
  );
}

export async function saveCrew(workspaceId, customerId, people) {
  await configDoc(workspaceId, customerId, 'crew').set({
    people: (people || [])
      .map((p) => ({
        id: p.id,
        name: String(p.name || '').trim(),
        roles: Array.isArray(p.roles) ? p.roles : [],
        // Site Lead: manages the crew list and hands out PINs inside their own
        // plant. Deliberately NOT called admin any more — that word now means
        // JTI, and one word for both a cross-customer superuser and a shift
        // lead is how the wrong one eventually gets granted.
        //
        // The old `admin` flag is still read (see utils/roles.js) so existing
        // crew keep their access, and is carried through here so that a roster
        // saved by this version does not strip it from a client still reading
        // the old name.
        siteLead: isSiteLead(p),
        ...(p.admin ? { admin: true } : {}),
        // Lines this person may file against. An empty list means no
        // restriction rather than no access — see utils/lineAccess.js. Written
        // explicitly because this whitelist drops anything it does not name,
        // which would have let the picker appear to work and save nothing.
        lines: Array.isArray(p.lines)
          ? p.lines.map((l) => String(l || '').trim()).filter(Boolean)
          : [],
        // Written by the PIN flows; carried through here so an unrelated roster
        // edit never silently clears someone's PIN.
        ...(p.pinHash ? { pinHash: p.pinHash } : {}),
        ...(p.pinSetAt ? { pinSetAt: p.pinSetAt } : {}),
      }))
      .filter((p) => p.name && p.roles.length),
    updatedAt: new Date().toISOString(),
  });
}

// ---- Line crewing ----------------------------------------------------------
// Who is on which line this shift. Stored per customer rather than per device:
// designating a line is a statement about the plant, not about the tablet you
// happen to be holding, and a supervisor setting it once should reach every
// device on the floor.
//
// Shape: { lines: { [lineTitle]: { operator, tech, supervisor } }, updatedAt }
//
// Names are copied onto each log entry at the moment it is saved. Re-crewing a
// line therefore never rewrites what was already logged — the entry keeps the
// crew that was on when the work was done.
export function subscribeLineCrew(workspaceId, customerId, cb) {
  if (!workspaceId || !customerId) return () => {};
  return configDoc(workspaceId, customerId, 'lineCrew').onSnapshot(
    (snap) => cb(snap.exists ? (snap.data() || { lines: {} }) : { lines: {} }),
    (err) => { console.error('line crew subscription failed:', err); cb({ lines: {} }); }
  );
}

export async function saveLineCrew(workspaceId, customerId, lines, changedBy = '') {
  const cleaned = {};
  for (const [title, c] of Object.entries(lines || {})) {
    const entry = {
      operator: (c?.operator || '').trim(),
      tech: (c?.tech || '').trim(),
      supervisor: (c?.supervisor || '').trim(),
    };
    if (entry.operator || entry.tech || entry.supervisor) cleaned[title] = entry;
  }

  // The config doc holds only the CURRENT crewing, so each change used to erase
  // the last. Every change is now also appended to crewLog, and the config doc
  // records which log entry it came from — that id is the shiftId stamped on
  // work logged while this crewing stands.
  //
  // Without this, "who was on Tuesday nights" was unanswerable the moment
  // Wednesday's crew was set, even though entries logged on Tuesday kept their
  // names. This makes the crewing itself reconstructable, not just its effects.
  const logged = await addLogEntry(workspaceId, customerId, LOG_CREW, {
    lines: cleaned,
    changedBy,
  });
  const shiftId = logged.id;

  await configDoc(workspaceId, customerId, 'lineCrew').set({
    lines: cleaned,
    shiftId,
    updatedAt: new Date().toISOString(),
  });

  return shiftId;
}

// ---- Parts-manual bindings -------------------------------------------------
// Which machine in the Parts Viewer catalog a line's parts come from, keyed by
// line title (the same key the span and board logs use).
//
// Shape: { bindings: { [lineTitle]: { partsCustomer, folder, allowOthers } } }
//
// A binding rather than matching on model/serial: the catalog carries neither,
// and a string compare would fail SILENTLY on a typo and offer parts from the
// wrong machine. An unbound line simply says so.
export function subscribePartsBindings(workspaceId, customerId, cb) {
  if (!workspaceId || !customerId) return () => {};
  return configDoc(workspaceId, customerId, 'partsBindings').onSnapshot(
    (snap) => cb(snap.exists ? (snap.data().bindings || {}) : {}),
    (err) => { console.error('parts bindings subscription failed:', err); cb({}); }
  );
}

export async function savePartsBindings(workspaceId, customerId, bindings) {
  await configDoc(workspaceId, customerId, 'partsBindings').set({
    bindings: bindings || {},
    updatedAt: new Date().toISOString(),
  });
}

// Which part number a board type is ON A PARTICULAR MACHINE, keyed by the bound
// folder — because "Main Control Board" is a different part on a bigger weigher,
// and the board-type list carries only one number for all of them.
//
// Shape: { byMachine: { '<partsCustomer>//<folder>': { '<boardType>': { partNumber, … } } } }
//
// See shared/utils/boardParts.js for the resolution order.
export function subscribeBoardParts(workspaceId, customerId, cb) {
  if (!workspaceId || !customerId) return () => {};
  return configDoc(workspaceId, customerId, 'boardParts').onSnapshot(
    (snap) => cb(snap.exists ? (snap.data() || { byMachine: {} }) : { byMachine: {} }),
    (err) => { console.error('board parts subscription failed:', err); cb({ byMachine: {} }); }
  );
}

export async function saveBoardParts(workspaceId, customerId, boardParts) {
  await configDoc(workspaceId, customerId, 'boardParts').set({
    byMachine: boardParts?.byMachine || {},
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

// ---- JTI master templates --------------------------------------------------
// A checklist or board list that belongs to JTI rather than to any one plant,
// so the standard lives in one place and can be sent to many.
//
//   jti_templates/{id} = { kind, name, data, updatedAt, updatedBy }
//     kind 'pmTemplate'  -> data { sections: [...] }
//     kind 'boardTypes'  -> data { types: [...] }
//
// Deliberately OUTSIDE user_files/{ws}/customers, because it is not any
// customer's data — a plant login can't read it and has no reason to. What a
// plant sees is the COPY made in their own config by a push.
//
// Copy, not reference: a plant that adds a line item to their checklist must not
// have it vanish because JTI edited the master, and a master edit must not
// silently rewrite what fifty plants are checking tomorrow morning. Pushing is
// therefore an act with a date on it, not a live link.
const TEMPLATES = 'jti_templates';
const templatesCol = () => firebase.firestore().collection(TEMPLATES);

export function subscribeTemplates(kind, cb) {
  return templatesCol()
    .where('kind', '==', kind)
    .onSnapshot(
      (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))),
      (err) => { console.error('templates subscription failed:', err); cb([]); }
    );
}

export async function saveTemplate({ id, kind, name, data, updatedBy }) {
  const payload = {
    kind,
    name: String(name || '').trim() || 'Untitled',
    data: data || {},
    updatedAt: new Date().toISOString(),
    ...(updatedBy ? { updatedBy } : {}),
  };
  if (id) {
    await templatesCol().doc(id).set(payload);
    return id;
  }
  const ref = await templatesCol().add(payload);
  return ref.id;
}

export async function deleteTemplate(id) {
  if (!id) return;
  await templatesCol().doc(id).delete();
}

/**
 * Send a config to customers, keeping what it replaced.
 *
 * Each target gets a copy of `data` in customers/{cid}/config/{key}, stamped
 * with where it came from. Whatever was there first is written to
 * customers/{cid}/configBackups/{key}_{timestamp} BEFORE the overwrite — a push
 * across a dozen plants is exactly the action that quietly destroys the one
 * checklist somebody had spent an afternoon tailoring, and "it was JTI's
 * standard anyway" is no comfort to them.
 *
 * Customers are pushed one at a time and failures are reported per customer
 * rather than aborting: a plant whose rules or network refused should not
 * silently take the other eleven down with it.
 */
export async function pushConfigToCustomers(workspaceId, customerIds, key, data, meta = {}) {
  const results = [];
  const at = new Date().toISOString();
  for (const cid of customerIds || []) {
    try {
      const ref = configDoc(workspaceId, cid, key);
      const before = await ref.get();
      if (before.exists) {
        await firebase.firestore()
          .collection('user_files').doc(workspaceId)
          .collection('customers').doc(cid)
          .collection('configBackups').doc(`${key}_${Date.now()}`)
          .set({ key, replacedAt: at, data: before.data() });
      }
      await ref.set({
        ...data,
        updatedAt: at,
        pushedAt: at,
        ...(meta.templateId ? { pushedFrom: meta.templateId } : {}),
        ...(meta.templateName ? { pushedName: meta.templateName } : {}),
      });
      results.push({ customerId: cid, ok: true, replaced: before.exists });
    } catch (err) {
      console.error(`push to ${cid} failed:`, err);
      results.push({ customerId: cid, ok: false, error: err?.message || String(err) });
    }
  }
  return results;
}

// What a customer has now, for the "which plants would this overwrite" summary
// shown before a push. One read per customer — fine for the handful of plants
// this runs against, and it is a deliberate action, not a page load.
export async function fetchConfigSummaries(workspaceId, customerIds, key) {
  const out = {};
  await Promise.all((customerIds || []).map(async (cid) => {
    try {
      const snap = await configDoc(workspaceId, cid, key).get();
      out[cid] = snap.exists ? snap.data() : null;
    } catch {
      out[cid] = undefined; // couldn't read — distinct from "nothing there"
    }
  }));
  return out;
}

// ---- Pre-start checklist template -----------------------------------------
// Shape: { items: [{ id, label, type, imageUrl? }] }
//
// Flat, unlike the PM template's sections. A pre-start check is one short walk
// round the machine, and dividing seven items into headings would be structure
// for its own sake.
export function subscribePrestartTemplate(workspaceId, customerId, cb) {
  if (!workspaceId || !customerId) return () => {};
  return configDoc(workspaceId, customerId, PRESTART_TEMPLATE).onSnapshot(
    (snap) => cb(snap.exists ? (snap.data() || null) : null),
    (err) => { console.error('pre-start template subscription failed:', err); cb(null); }
  );
}

export async function savePrestartTemplate(workspaceId, customerId, items) {
  await configDoc(workspaceId, customerId, PRESTART_TEMPLATE).set({
    items: items || [],
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
