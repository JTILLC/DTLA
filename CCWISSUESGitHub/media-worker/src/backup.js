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

// A document tree can be deep and a Worker has a wall clock. These are the
// limits at which a run stops walking and SAYS it stopped, rather than silently
// writing a partial backup that looks complete.
const MAX_DOCS = 20000;
const MAX_DEPTH = 6;

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
 * Every document under a collection, and everything beneath them.
 *
 * Firestore's REST list does not descend, so subcollections are discovered per
 * document. That is a request per document, which is why the caps above exist.
 */
async function walk(projectId, token, parentPath, collectionId, state, depth = 0) {
  const docs = {};
  if (depth >= MAX_DEPTH) { state.truncated = 'depth'; return docs; }

  let pageToken = '';
  do {
    const base = `${FIRESTORE}/projects/${projectId}/databases/(default)/documents`;
    const url = `${base}${parentPath}/${encodeURIComponent(collectionId)}`
      + `?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const page = await api(url, token);

    for (const d of page.documents || []) {
      if (state.count >= MAX_DOCS) { state.truncated = 'size'; return docs; }
      const id = idOf(d.name);
      state.count += 1;
      const node = { ...decodeFields(d.fields) };

      // Subcollections, if any. A document with none is the common case and
      // costs one extra call; the alternative is not knowing they exist.
      const subs = await api(
        `${FIRESTORE}/projects/${projectId}/databases/(default)/documents${parentPath}/${encodeURIComponent(collectionId)}/${encodeURIComponent(id)}:listCollectionIds`,
        token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

      for (const sub of subs.collectionIds || []) {
        node[sub] = await walk(
          projectId, token,
          `${parentPath}/${encodeURIComponent(collectionId)}/${encodeURIComponent(id)}`,
          sub, state, depth + 1);
      }
      docs[id] = node;
    }
    pageToken = page.nextPageToken || '';
  } while (pageToken);

  return docs;
}

/** Back up one project's named root collections. */
export async function exportProject({ projectId, token, collections }) {
  const state = { count: 0, truncated: null };
  const data = {};
  const failed = [];

  for (const c of collections) {
    try {
      data[c] = await walk(projectId, token, '', c, state);
    } catch (err) {
      // One unreadable collection must not lose the others.
      failed.push(`${c}: ${err.message}`);
    }
  }

  return {
    project: projectId,
    takenAt: new Date().toISOString(),
    documents: state.count,
    truncated: state.truncated,
    failed,
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
      collections: ['user_files', 'shared_visits'],
    },
    {
      name: 'Jobs and packets',
      projectId: env.PARTS_PROJECT_ID,
      email: env.PARTS_SA_EMAIL,
      key: env.PARTS_SA_PRIVATE_KEY,
      collections: ['unified_jobs', 'unified_job_packets', 'manual_reports',
                    'customer_directory', 'job_customer_overrides'],
    },
    {
      name: 'Timesheets',
      projectId: env.TIMESHEET_PROJECT_ID,
      email: env.TIMESHEET_SA_EMAIL,
      key: env.TIMESHEET_SA_PRIVATE_KEY,
      collections: ['timesheets', 'customer_directory', 'sr_directory'],
    },
  ];
  return targets.map((t) => ({
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

/** Run the whole thing. Returns a manifest describing what happened. */
export async function runBackup(env, mintToken, { date = new Date() } = {}) {
  const day = date.toISOString().slice(0, 10);
  const bucket = env.BACKUP_BUCKET || env.STORAGE_BUCKET;
  const manifest = { startedAt: new Date().toISOString(), day, bucket, results: [] };

  for (const t of backupTargets(env)) {
    if (!t.ready) {
      manifest.results.push({ name: t.name, ok: false, skipped: true, reason: t.reason });
      continue;
    }
    try {
      const token = await mintToken(t.email, t.key,
        'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/devstorage.read_write');
      const dump = await exportProject({ projectId: t.projectId, token, collections: t.collections });
      const objectPath = `backups/${day}/${t.projectId}.json`;
      await putObject(bucket, objectPath, token, JSON.stringify(dump));
      manifest.results.push({
        name: t.name, ok: true, path: objectPath,
        documents: dump.documents, truncated: dump.truncated, failed: dump.failed,
      });
    } catch (err) {
      manifest.results.push({ name: t.name, ok: false, error: String(err.message || err) });
    }
  }

  // Shearers last, because it is the odd one out and its failure mode differs.
  if (env.SHEARERS_DB_URL) {
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
      const writer = backupTargets(env).find((t) => t.ready);
      const wToken = await mintToken(writer.email, writer.key,
        'https://www.googleapis.com/auth/devstorage.read_write');
      const objectPath = `backups/${day}/shearers-4c4b4.json`;
      await putObject(bucket, objectPath, wToken, JSON.stringify(dump));
      manifest.results.push({
        name: 'Shearers downtime', ok: true, path: objectPath,
        documents: dump.documents, authenticated: dump.authenticated,
      });
    } catch (err) {
      manifest.results.push({ name: 'Shearers downtime', ok: false, error: String(err.message || err) });
    }
  } else {
    manifest.results.push({ name: 'Shearers downtime', ok: false, skipped: true, reason: 'no database url configured' });
  }

  // The manifest goes next to the dumps, using whichever account can write —
  // the one that just succeeded. A run where every project failed still records
  // that it ran, which is the case somebody most needs to see.
  try {
    const writer = backupTargets(env).find((t) => t.ready);
    if (writer) {
      const token = await mintToken(writer.email, writer.key,
        'https://www.googleapis.com/auth/devstorage.read_write');
      manifest.finishedAt = new Date().toISOString();
      manifest.retention = await prune(bucket, token, Number(env.BACKUP_RETAIN_DAYS));
      await putObject(bucket, `backups/${day}/manifest.json`, token, JSON.stringify(manifest, null, 2));
      await putObject(bucket, 'backups/latest.json', token, JSON.stringify(manifest, null, 2));
    }
  } catch (err) {
    manifest.manifestError = String(err.message || err);
  }

  return manifest;
}

export default { runBackup, backupTargets, exportProject, exportRealtimeDb, decodeFields, decodeValue, prune, putObject, idOf, isExpiredBackup };
