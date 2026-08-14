// src/backup.js
//
// A nightly copy of the Firestore data, written to Cloud Storage.
//
// The apps were good at capturing data and had no way to get it back. There was
// a backup module in the dashboard that nothing called, and its restore half was
// broken — so the honest state was: no backups. Six days of timesheet work were
// lost to a Reset in August and recovered only because the timesheet app happened
// to keep a local list.
//
// This runs on a cron in the Worker that already holds the service accounts, so
// it needs no new billing and no new place to put credentials.
//
// What it deliberately does NOT do:
//   - It does not delete anything, ever, unless BACKUP_RETAIN_DAYS is set. A
//     backup system whose first act is a delete is not reassuring.
//   - It does not stop at the first failure. Four projects, four independent
//     results, one manifest that says which worked — the whole point is to know,
//     and a run that dies on project one tells you nothing about the rest.

const FIRESTORE = 'https://firestore.googleapis.com/v1';
const UPLOAD = 'https://storage.googleapis.com/upload/storage/v1/b';
const STORAGE = 'https://storage.googleapis.com/storage/v1/b';

// The point at which a run stops and SAYS it stopped, rather than silently
// writing a partial backup that looks complete. Depth is no longer a limit:
// collection-group queries reach every level in one request, so nothing is
// walked and there is no depth to bound.
const MAX_DOCS = 20000;

// A Worker gets a fixed slice of memory, and being killed for exceeding it is
// not an exception JavaScript can catch — the request simply dies, Cloudflare
// answers with a CORS-less error page, and the browser says only "failed to
// fetch". Some documents hold base64 images, so a single collection can be
// hundreds of megabytes. These caps exist to stop BEFORE that, because stopping
// with a message beats dying without one.
// Sized against the Worker's 128 MB, not guessed conservatively. The first
// numbers here were so cautious they cut `visits` — the core CCW data, the
// service reports themselves — which is a worse outcome than the crash they
// prevented. A backup that drops the main table to stay safe is not a backup.
const MAX_BYTES = 45_000_000;          // whole run
const MAX_COLLECTION_BYTES = 35_000_000;

/** Firestore's typed values back into plain JSON. */
export function decodeValue(v) {
  if (v == null) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('stringValue' in v) return v.stringValue;
  if ('bytesValue' in v) return { __bytes: v.bytesValue };
  if ('referenceValue' in v) return { __ref: v.referenceValue };
  if ('geoPointValue' in v) return { __geo: v.geoPointValue };
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

export function decodeFields(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

/** The document id from a Firestore resource name. */
export const idOf = (name = '') => String(name).split('/').pop();

async function api(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/**
 * Where a document sits, as [collection, id, collection, id, ...].
 *
 * Firestore returns a full resource name; everything before /documents/ is
 * addressing, not structure.
 */
export function docPathSegments(name = '') {
  const marker = '/documents/';
  const i = String(name).indexOf(marker);
  return i === -1 ? [] : String(name).slice(i + marker.length).split('/').filter(Boolean);
}

/**
 * Put a document into the tree at its own path, creating parents as needed.
 *
 * A collection-group query returns documents from every level at once, so this
 * is what turns a flat list back into the shape the data actually has. Parents
 * are created empty when their own document has not arrived yet — `visits` may
 * well be fetched before the `customers` they belong to.
 */
export function placeDoc(tree, segments, data) {
  if (segments.length < 2 || segments.length % 2 !== 0) return tree;
  let node = tree;
  for (let i = 0; i < segments.length - 2; i += 2) {
    const col = segments[i], id = segments[i + 1];
    node[col] = node[col] || {};
    node[col][id] = node[col][id] || {};
    node = node[col][id];
  }
  const col = segments[segments.length - 2];
  const id = segments[segments.length - 1];
  node[col] = node[col] || {};
  node[col][id] = { ...(node[col][id] || {}), ...data };
  return tree;
}

/**
 * Every document of one collection name, anywhere in the database.
 *
 * This replaced walking the tree document by document. Discovering
 * subcollections per document cost one request each, and a Worker is allowed
 * only so many per invocation — the first run died on "Too many subrequests"
 * having read a few hundred documents out of several thousand.
 *
 * `allDescendants` asks Firestore to do that walk instead, and it answers a
 * whole collection group in one request. Paged by document name because
 * runQuery has no page token: the last name on a page is the cursor for the
 * next, and __name__ is the only field guaranteed to exist and be unique.
 */
/**
 * @param {function} [onPage] - when given, each page is handed over and NOT
 *   kept. That is the difference between a collection that fits in memory and
 *   one that does not.
 */
async function collectionGroup(projectId, token, collectionId, state, pageSize = 50, onPage = null) {
  const url = `${FIRESTORE}/projects/${projectId}/databases/(default)/documents:runQuery`;
  let after = null;
  let bytes = 0;
  const docs = [];

  for (;;) {
    if (state.requests >= state.budget) { state.truncated = 'requests'; break; }
    const structuredQuery = {
      from: [{ collectionId, allDescendants: true }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: pageSize,
      ...(after ? { startAt: { values: [{ referenceValue: after }], before: false } } : {}),
    };
    state.requests += 1;
    const rows = await api(url, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery }),
    });

    const page = (rows || []).map((r) => r.document).filter(Boolean);
    if (!page.length) break;

    // Measured per page, not per collection: by the time a whole collection is
    // in memory it is already too late to decide it was too big.
    const pageBytes = JSON.stringify(page).length;
    if (onPage) {
      // Streamed: written out and released, so the caps below do not apply —
      // they exist to bound what is HELD, and this holds one page.
      state.bytes += pageBytes;
      state.count += page.length;
      await onPage(page);
      if (page.length < pageSize) break;
      after = page[page.length - 1].name;
      continue;
    }
    if (bytes + pageBytes > MAX_COLLECTION_BYTES || state.bytes + pageBytes > MAX_BYTES) {
      state.truncated = 'bytes';
      // Recorded with the size it reached, so "too large" is a number somebody
      // can act on rather than a verdict.
      state.oversized.push(`${collectionId} (over ${Math.round((bytes + pageBytes) / 1e6)}MB)`);
      break;
    }
    bytes += pageBytes;
    state.bytes += pageBytes;

    docs.push(...page);
    state.count += page.length;
    if (state.count >= MAX_DOCS) { state.truncated = 'size'; break; }
    if (page.length < pageSize) break;
    after = page[page.length - 1].name;
  }

  return docs;
}

/** Root collection names, so a collection nobody configured is still noticed. */
async function rootCollectionIds(projectId, token, state) {
  state.requests += 1;
  const res = await api(
    `${FIRESTORE}/projects/${projectId}/databases/(default)/documents:listCollectionIds`,
    token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return res.collectionIds || [];
}

/**
 * Back up one project.
 *
 * `collections` names every collection to fetch, nested ones included — a
 * collection-group query does not care where a collection lives, so
 * "user_files, customers, visits" gathers the whole CCW tree in three requests
 * rather than one per customer.
 *
 * `budget` is the Worker's subrequest allowance for this project. Reaching it
 * stops the run and SAYS so, rather than throwing away everything read so far.
 */
export async function exportProject({
  projectId, token, collections, state, checkUnconfigured = true,
  streamed = [], onChunk = null, streamPageSize = 50,
}) {
  const data = {};
  const failed = [];
  const startedAt = state.count;

  for (const c of collections) {
    try {
      const docs = await collectionGroup(projectId, token, c, state);
      docs.forEach((d) => placeDoc(data, docPathSegments(d.name), decodeFields(d.fields)));
    } catch (err) {
      failed.push(`${c}: ${err.message}`);
    }
    if (state.truncated === 'requests') break;
  }

  // Collections whose documents are big enough that a page of the usual size
  // would not fit in memory. Firestore allows a megabyte per document, so fifty
  // of them is fifty megabytes in one go — these go out in small pages, each
  // written to its own file and released.
  const chunks = {};
  for (const c of streamed) {
    if (state.truncated === 'requests') break;
    try {
      let seq = 0;
      // Fifty, not ten. Ten was chosen for a document size that turned out to
      // be wrong: these average about 0.2 MB, so a page of fifty is around
      // eleven megabytes — comfortable — while ten meant seventeen pages and
      // thirty-four subrequests, which exhausted the run's allowance and left
      // the collection possibly unfinished. Requests are the scarce resource
      // here, not memory.
      await collectionGroup(projectId, token, c, state, streamPageSize, async (page) => {
        const tree = {};
        page.forEach((d) => placeDoc(tree, docPathSegments(d.name), decodeFields(d.fields)));
        state.requests += 1;
        await onChunk(c, seq, tree);
        seq += 1;
      });
      chunks[c] = seq;
    } catch (err) {
      failed.push(`${c}: ${err.message}`);
    }
  }

  // Anything at the root nobody listed. Reported, not fetched: a collection
  // silently missing from a backup is the failure this exists to prevent.
  let unconfigured = [];
  try {
    if (checkUnconfigured && state.requests < state.budget) {
      unconfigured = (await rootCollectionIds(projectId, token, state))
        .filter((id) => !collections.includes(id));
    }
  } catch { /* not fatal — what was read above is still good */ }

  return {
    project: projectId,
    takenAt: new Date().toISOString(),
    documents: state.count - startedAt,
    megabytes: Math.round(state.bytes / 1e5) / 10,
    requests: state.requests,
    truncated: state.truncated,
    oversized: [...new Set(state.oversized)],
    chunks,
    failed,
    unconfigured,
    data,
  };
}

/** Write a JSON object into a bucket. */
export async function putObject(bucket, objectPath, token, body) {
  const url = `${UPLOAD}/${encodeURIComponent(bucket)}/o`
    + `?uploadType=media&name=${encodeURIComponent(objectPath)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/**
 * Delete backups older than `days`.
 *
 * Only ever under the `backups/` prefix, and only names this system writes.
 * Retention is off unless BACKUP_RETAIN_DAYS is set: a scheduled job that
 * deletes by default is one misconfiguration away from being the thing that
 * loses the data.
 */
/**
 * Whether an object is one of ours AND older than the cutoff.
 *
 * Separated out because it is the only part of pruning that decides to DELETE,
 * and the consequence of getting it wrong is deleting something that is not a
 * backup. Anything not matching the exact name this system writes is left alone.
 */
export function isExpiredBackup(name, cutoffMs) {
  const m = /^backups\/(\d{4}-\d{2}-\d{2})\/[^/]+$/.exec(String(name || ''));
  if (!m) return false;
  const t = new Date(`${m[1]}T00:00:00Z`).getTime();
  return Number.isFinite(t) && t < cutoffMs;
}

export async function prune(bucket, token, days, now = Date.now()) {
  if (!Number.isFinite(days) || days <= 0) return { deleted: 0, skipped: 'retention not configured' };
  const cutoff = now - days * 86400000;
  let pageToken = '';
  let deleted = 0;

  do {
    const list = await api(
      `${STORAGE}/${encodeURIComponent(bucket)}/o?prefix=backups/&maxResults=500`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''), token);

    for (const item of list.items || []) {
      if (!isExpiredBackup(item.name, cutoff)) continue;
      const res = await fetch(`${STORAGE}/${encodeURIComponent(bucket)}/o/${encodeURIComponent(item.name)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) deleted += 1;
    }
    pageToken = list.nextPageToken || '';
  } while (pageToken);

  return { deleted };
}

/**
 * Which projects this Worker can actually back up.
 *
 * Credentials are per project. Two are already here for other reasons; the rest
 * need their own service account before they can be included. A project without
 * one is REPORTED as skipped rather than quietly left out — an incomplete backup
 * that looks complete is worse than no backup.
 */
export function backupTargets(env) {
  const targets = [
    {
      name: 'CCW Issues',
      projectId: env.FIREBASE_PROJECT_ID,
      email: env.GCP_SA_EMAIL,
      key: env.GCP_SA_PRIVATE_KEY,
      // Nested names listed too: a collection-group query fetches `visits`
      // wherever they live, so the tree returns without being walked.
      collections: [
        'user_files', 'customers', 'visits', 'shared_visits', 'shared_customers',
        // Everything else this project holds. The first complete run reported
        // all of these as present and unasked-for, which is exactly what that
        // check exists to catch.
        'app_roles', 'customer_secrets', 'jti_templates', 'user_signatures',
        'metal_validations', 'xray_validations',
      ],
    },
    {
      name: 'Jobs and packets',
      projectId: env.PARTS_PROJECT_ID,
      email: env.PARTS_SA_EMAIL,
      key: env.PARTS_SA_PRIVATE_KEY,
      // manual_reports and job_customer_overrides were WRONG — the collections
      // are named unified_*, so those two reported success while fetching
      // nothing. A backup that silently contains none of a collection it claims
      // to cover is the exact failure this system was built to prevent, and it
      // was found only because the unconfigured check named the real ones.
      collections: [
        'unified_jobs', 'unified_job_packets', 'unified_manual_reports',
        'unified_job_customer_overrides', 'customer_directory',
        'quotes', 'service_quotes', 'service_quotes_customers',
        'customer_shares', 'jobsData', 'settings',
      ],
      // Its documents carry the parts mappings and hotspot coordinates — the
      // images themselves went to Storage years ago, so this is structured data
      // with no other copy, and it is thirty-six megabytes of it.
      streamed: ['parts-viewer-diagrams'],
    },
    {
      name: 'Timesheets',
      projectId: env.TIMESHEET_PROJECT_ID,
      email: env.TIMESHEET_SA_EMAIL,
      key: env.TIMESHEET_SA_PRIVATE_KEY,
      // `drafts` is the unsaved-work store — the thing that made the six days
      // lost to a Reset in August recoverable at all. Of everything here it is
      // the least replaceable, and it was not being backed up.
      collections: ['timesheets', 'drafts', 'timesheet_data', 'customer_directory', 'sr_directory'],
    },
  ];
  return targets.map((t) => ({
    streamed: [],
    ...t,
    ready: !!(t.projectId && t.email && t.key),
    reason: !t.projectId ? 'no project id configured'
      : !t.email || !t.key ? 'no service account for this project' : null,
  }));
}

/**
 * Shearers, which is a Realtime Database rather than Firestore.
 *
 * Read with a service-account token when one is configured, and without when
 * one is not — the tree is currently world-readable, which is a security
 * finding of its own and not something to depend on. Which route was used is
 * reported, so the day that rule is tightened this says "unauthenticated read
 * refused" rather than quietly stopping.
 */
export async function exportRealtimeDb({ url, path, token }) {
  const target = `${url.replace(/\/$/, '')}/${path}.json`;
  const res = await fetch(target, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  if (!res.ok) throw new Error(`${res.status} reading ${path}${token ? '' : ' (unauthenticated)'}`);
  const data = await res.json();
  return {
    project: 'shearers-4c4b4',
    takenAt: new Date().toISOString(),
    documents: data && typeof data === 'object' ? Object.keys(data).length : 0,
    authenticated: !!token,
    data: data ?? {},
  };
}

/**
 * The order to attempt projects in, rotated by day.
 *
 * The subrequest allowance is per INVOCATION and shared by every project, so a
 * run that runs out always runs out on whichever project is last. Rotating
 * moves the shortfall: over a few days everything gets a full copy, instead of
 * one project never being backed up at all.
 */
export function rotate(list, day = new Date()) {
  const n = list.length;
  if (n < 2) return [...list];
  const d = Math.floor((day instanceof Date ? day : new Date(day)).getTime() / 86400000);
  const k = ((d % n) + n) % n;
  return [...list.slice(k), ...list.slice(0, k)];
}

/** Run the whole thing. Returns a manifest describing what happened. */
export async function runBackup(env, mintToken, { date = new Date(), only = '' } = {}) {
  const day = date.toISOString().slice(0, 10);
  const bucket = env.BACKUP_BUCKET || env.STORAGE_BUCKET;
  // Shared across every project: Cloudflare counts subrequests per invocation,
  // and the first version budgeted per project, so four modest budgets added up
  // to more than the Worker was allowed and the whole run died.
  // Roughly one request per collection, plus a token and an upload per project.
  // With every collection now listed that is around forty, so the default sits
  // just under the free plan's fifty. On the Workers paid plan the ceiling is a
  // thousand — set BACKUP_MAX_REQUESTS higher and the headroom stops mattering.
  const budget = Number(env.BACKUP_MAX_REQUESTS) || 48;
  const state = { count: 0, requests: 0, bytes: 0, oversized: [], truncated: null, budget };
  const manifest = { startedAt: new Date().toISOString(), day, bucket, budget, results: [] };

  // Reading and writing need DIFFERENT accounts.
  //
  // A service account can read its own project's Firestore and write its own
  // project's bucket — and every dump goes to one bucket, so the account that
  // read the Jobs project has no business writing to the CCW one. It was
  // refused, correctly, with a 403 after a successful read.
  //
  // So: each project is read by its own account, and everything is written by
  // whoever owns the bucket.
  let writer = null;
  const writeToken = async () => {
    if (writer) return writer;
    state.requests += 1;
    writer = await mintToken(env.GCP_SA_EMAIL, env.GCP_SA_PRIVATE_KEY,
      'https://www.googleapis.com/auth/devstorage.read_write');
    return writer;
  };

  // `only` narrows the run to one project. The nightly cron takes them all —
  // it has no client waiting on it — but a browser asking for four projects at
  // once is asking for more subrequests than one invocation is allowed.
  const chosen = rotate(backupTargets(env), date)
    .filter((t) => !only || t.projectId === only || t.name === only);

  let first = true;
  for (const t of chosen) {
    if (!t.ready) {
      manifest.results.push({ name: t.name, ok: false, skipped: true, reason: t.reason });
      continue;
    }
    try {
      state.requests += 1;   // the token mint is a subrequest too
      const token = await mintToken(t.email, t.key, 'https://www.googleapis.com/auth/datastore');
      const dump = await exportProject({
        projectId: t.projectId, token, collections: t.collections, state,
        streamed: t.streamed,
        streamPageSize: Number(env.BACKUP_STREAM_PAGE) || 50,
        onChunk: async (collectionId, seq, tree) => putObject(
          bucket, `backups/${day}/${t.projectId}/${collectionId}-${seq}.json`,
          await writeToken(), JSON.stringify({ project: t.projectId, collection: collectionId, seq, data: tree })),
        // Only the day's first project is asked what else it holds. It is a
        // request per project and rotation covers them all within a few days —
        // a new collection is worth finding, not worth finding four times.
        checkUnconfigured: first,
      });
      first = false;
      const objectPath = `backups/${day}/${t.projectId}.json`;
      state.requests += 1;
      await putObject(bucket, objectPath, await writeToken(), JSON.stringify(dump));
      manifest.results.push({
        name: t.name, ok: true, path: objectPath,
        documents: dump.documents, megabytes: dump.megabytes,
        chunks: dump.chunks,
        truncated: dump.truncated, failed: dump.failed,
        // Named so an oversized collection is a decision to make rather than a
        // silent hole in the backup.
        oversized: dump.oversized,
        // Collections that exist and were not fetched. The whole point of this
        // system is knowing what is covered, so a collection nobody listed has
        // to surface rather than be absent from a file that looks complete.
        unconfigured: dump.unconfigured,
      });
    } catch (err) {
      manifest.results.push({ name: t.name, ok: false, error: String(err.message || err) });
    }
  }

  // Shearers last, because it is the odd one out and its failure mode differs.
  const wantShearers = !only || only === 'shearers-4c4b4' || only === 'Shearers downtime';
  if (wantShearers && env.SHEARERS_DB_URL) {
    try {
      const token = env.SHEARERS_SA_EMAIL && env.SHEARERS_SA_PRIVATE_KEY
        ? await mintToken(env.SHEARERS_SA_EMAIL, env.SHEARERS_SA_PRIVATE_KEY,
            'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email')
        : null;
      const dump = await exportRealtimeDb({
        url: env.SHEARERS_DB_URL,
        path: env.SHEARERS_DB_PATH || 'jti-downtime/main-logger/data',
        token,
      });
      const objectPath = `backups/${day}/shearers-4c4b4.json`;
      state.requests += 1;
      await putObject(bucket, objectPath, await writeToken(), JSON.stringify(dump));
      manifest.results.push({
        name: 'Shearers downtime', ok: true, path: objectPath,
        documents: dump.documents, authenticated: dump.authenticated,
      });
    } catch (err) {
      manifest.results.push({ name: 'Shearers downtime', ok: false, error: String(err.message || err) });
    }
  } else if (wantShearers) {
    manifest.results.push({ name: 'Shearers downtime', ok: false, skipped: true, reason: 'no database url configured' });
  }

  // The manifest goes next to the dumps. A run where every project failed still
  // records that it ran, which is the case somebody most needs to see.
  try {
    const wToken = await writeToken();
    manifest.finishedAt = new Date().toISOString();
    manifest.requests = state.requests;
    manifest.retention = await prune(bucket, wToken, Number(env.BACKUP_RETAIN_DAYS));
    await putObject(bucket, `backups/${day}/manifest.json`, wToken, JSON.stringify(manifest, null, 2));
    await putObject(bucket, 'backups/latest.json', wToken, JSON.stringify(manifest, null, 2));
  } catch (err) {
    manifest.manifestError = String(err.message || err);
  }

  return manifest;
}

export default { runBackup, rotate, backupTargets, exportProject, exportRealtimeDb, docPathSegments, placeDoc, decodeFields, decodeValue, prune, putObject, idOf, isExpiredBackup };
