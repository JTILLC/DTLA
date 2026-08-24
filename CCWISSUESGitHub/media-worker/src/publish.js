// Publishing the customer and job-number directories from the Worker.
//
// The dashboard has always done this from the browser (data-service.js,
// publishToTimesheet): copy the customer records and the open job numbers
// into the projects that cannot read them, because Firebase Auth is per
// project. That works, but only when somebody presses the button — and a
// directory nobody has republished is a directory quietly handing out last
// month's contacts and job numbers.
//
// So the same copy now also runs here, on the nightly cron and on demand at
// /admin/publish-directory. The dashboard's button stays: this is the floor
// under it, not a replacement. The document shapes are the client's, field
// for field — JobPicker, the CCW reserved-numbers list and the Jobs app all
// read these docs, and a shape that drifted between the two writers would be
// the exact split-truth problem the directory exists to prevent.
//
// The identity rules are imported from ../shared rather than re-implemented:
// which spellings are the same customer is a rule three apps already share,
// and this Worker must not grow its own opinion about it.
import { customerDefaults, missingDefaults } from '../../../shared/utils/customerDefaults.js';
import { matchCustomer } from '../../../shared/utils/customerMatch.js';
import { decodeFields, idOf, putObject } from './backup.js';

const FIRESTORE = 'https://firestore.googleapis.com/v1';
const DATASTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

async function api(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// JS values → Firestore REST values. Only what the directory docs actually
// carry: strings, numbers, booleans, arrays of those, and one level of map
// (`defaults`). Anything else is a shape change and should fail loudly here
// rather than write something the readers cannot decode.
export function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v) } };
  throw new Error(`Cannot encode a ${typeof v} for Firestore`);
}

export function encodeFields(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = encodeValue(v);
  return out;
}

const docsBase = (projectId) => `projects/${projectId}/databases/(default)/documents`;
const docName = (projectId, path, id) => `${docsBase(projectId)}/${path}/${id}`;

/** Every document in one (small) collection, paged. */
async function listAll(projectId, token, path, state, pageSize = 300) {
  const docs = [];
  let pageToken = '';
  do {
    state.requests += 1;
    const qs = `pageSize=${pageSize}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const out = await api(`${FIRESTORE}/${docsBase(projectId)}/${path}?${qs}`, token);
    (out.documents || []).forEach((d) => docs.push({ id: idOf(d.name), data: decodeFields(d.fields) }));
    pageToken = out.nextPageToken || '';
  } while (pageToken);
  return docs;
}

/** Apply writes in chunks under Firestore's 500-per-commit ceiling. */
async function commit(projectId, token, writes, state) {
  for (let i = 0; i < writes.length; i += 400) {
    state.requests += 1;
    await api(`${FIRESTORE}/${docsBase(projectId)}:commit`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: writes.slice(i, i + 400) }),
    });
  }
  return writes.length;
}

/** The customer records, in the same shape the dashboard reads them. */
const asRecord = ({ id, data }) => {
  const profile = data.profile || {};
  return {
    id,
    // The name lives on the profile in CCW; older docs kept it at the top.
    name: profile.name || data.name || '',
    profile: { address: '', cityState: '', contacts: [], invoiceEmails: [], aliases: [], notes: '', ...profile },
  };
};

/**
 * One publish run. Returns a manifest whether or not every project worked —
 * a run where the timesheet copy failed is exactly what somebody needs to
 * see, so per-project results carry ok/skip/error rather than throwing away
 * the successes.
 */
export async function publishDirectory(env, mintToken, { trigger = 'manual', now = new Date() } = {}) {
  const at = now.toISOString();
  const state = { requests: 0 };
  const manifest = { startedAt: at, trigger, results: [] };

  // --- Read the two sources of truth --------------------------------------
  state.requests += 1;
  const ccwToken = await mintToken(env.GCP_SA_EMAIL, env.GCP_SA_PRIVATE_KEY, DATASTORE_SCOPE);

  const records = (await listAll(env.FIREBASE_PROJECT_ID, ccwToken, `user_files/${env.WORKSPACE_UID}/customers`, state))
    .map(asRecord)
    .filter((r) => r.name);
  manifest.customers = records.length;

  // Jobs live in their own project; without its service account there is no
  // job list, and rather than publish HALF a directory (customers but stale
  // numbers) the whole run reports itself skipped.
  if (!env.PARTS_SA_EMAIL || !env.PARTS_SA_PRIVATE_KEY || !env.PARTS_PROJECT_ID) {
    manifest.results.push({ name: 'jobs read', ok: false, skipped: true, reason: 'no service account for the jobs project' });
    return manifest;
  }
  state.requests += 1;
  const jobsToken = await mintToken(env.PARTS_SA_EMAIL, env.PARTS_SA_PRIVATE_KEY, DATASTORE_SCOPE);

  // Same merge as the dashboard's fetchUnifiedJobs: per-job docs first,
  // legacy reservations (doc id = the number) filling in anything older.
  const bySr = new Map();
  (await listAll(env.PARTS_PROJECT_ID, jobsToken, 'jobs', state)).forEach(({ id, data }) => {
    const sr = String(data.sr || '').trim().toUpperCase();
    if (!sr) return;
    bySr.set(sr, { ...data, sr, id });
  });
  (await listAll(env.PARTS_PROJECT_ID, jobsToken, 'unified_jobs', state)).forEach(({ id, data }) => {
    const sr = String(id || '').trim().toUpperCase();
    if (!sr || bySr.has(sr)) return;
    bySr.set(sr, { ...data, sr, id, legacy: true });
  });
  const openJobs = [...bySr.values()].filter((j) => !j.closedAt);
  const openSrs = new Set(openJobs.map((j) => String(j.sr)));
  manifest.openJobs = openJobs.length;

  const customerIdFor = (j) => matchCustomer(j.customer, records)?.id || '';

  // --- The three copies ----------------------------------------------------
  // Documents are written whole (update with no mask = the client's setDoc),
  // and numbers no longer open are DELETED, not skipped — a closed number
  // left behind sits in the other app's picker forever.
  const targets = [];

  if (env.TIMESHEET_SA_EMAIL && env.TIMESHEET_SA_PRIVATE_KEY && env.TIMESHEET_PROJECT_ID) {
    targets.push({
      name: 'Timesheets',
      run: async () => {
        state.requests += 1;
        const token = await mintToken(env.TIMESHEET_SA_EMAIL, env.TIMESHEET_SA_PRIVATE_KEY, DATASTORE_SCOPE);
        const existing = await listAll(env.TIMESHEET_PROJECT_ID, token, 'sr_directory', state);
        const writes = [
          ...records.map((r) => ({
            update: {
              name: docName(env.TIMESHEET_PROJECT_ID, 'customer_directory', r.id),
              fields: encodeFields({
                id: r.id, name: r.name, aliases: r.profile.aliases || [],
                defaults: customerDefaults(r), missing: missingDefaults(r), updatedAt: at,
              }),
            },
          })),
          ...openJobs.map((j) => ({
            update: {
              name: docName(env.TIMESHEET_PROJECT_ID, 'sr_directory', String(j.sr)),
              fields: encodeFields({
                sr: String(j.sr), customer: j.customer || '',
                customerId: customerIdFor(j),
                date: j.date || '', dateStart: j.dateStart || j.date || '', dateEnd: j.dateEnd || '',
                address: j.address || '', city: j.city || '', state: j.state || '',
                description: j.description || '', updatedAt: at,
              }),
            },
          })),
          ...existing.filter((d) => !openSrs.has(String(d.id)))
            .map((d) => ({ delete: docName(env.TIMESHEET_PROJECT_ID, 'sr_directory', d.id) })),
        ];
        return commit(env.TIMESHEET_PROJECT_ID, token, writes, state);
      },
    });
  } else {
    manifest.results.push({ name: 'Timesheets', ok: false, skipped: true, reason: 'no service account for the timesheet project' });
  }

  targets.push({
    name: 'CCW reserved numbers',
    run: async () => {
      const path = `user_files/${env.WORKSPACE_UID}/sr_directory`;
      const existing = await listAll(env.FIREBASE_PROJECT_ID, ccwToken, path, state);
      const writes = [
        ...openJobs.map((j) => ({
          update: {
            name: docName(env.FIREBASE_PROJECT_ID, path, String(j.sr)),
            // No address here on purpose, exactly as the client publish says:
            // CCW knows its own customers, and postal details copied into it
            // would be a second, staler answer.
            fields: encodeFields({
              sr: String(j.sr), customer: j.customer || '',
              customerId: customerIdFor(j),
              date: j.date || '', dateStart: j.dateStart || j.date || '', dateEnd: j.dateEnd || '',
              description: j.description || '', updatedAt: at,
            }),
          },
        })),
        ...existing.filter((d) => !openSrs.has(String(d.id)))
          .map((d) => ({ delete: docName(env.FIREBASE_PROJECT_ID, path, d.id) })),
      ];
      return commit(env.FIREBASE_PROJECT_ID, ccwToken, writes, state);
    },
  });

  targets.push({
    name: 'Jobs customer directory',
    run: async () => {
      const writes = records.map((r) => ({
        update: {
          name: docName(env.PARTS_PROJECT_ID, 'customer_directory', r.id),
          fields: encodeFields({
            id: r.id, name: r.name, aliases: r.profile.aliases || [],
            defaults: customerDefaults(r), updatedAt: at,
          }),
        },
      }));
      return commit(env.PARTS_PROJECT_ID, jobsToken, writes, state);
    },
  });

  for (const t of targets) {
    try {
      const writes = await t.run();
      manifest.results.push({ name: t.name, ok: true, writes });
    } catch (err) {
      manifest.results.push({ name: t.name, ok: false, error: String(err?.message || err).slice(0, 300) });
    }
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.requests = state.requests;

  // Proof it ran, same pattern as the backups: the cron's copy has a name of
  // its own, because the on-demand route overwrites latest.json and only the
  // nightly file answers "did the schedule work".
  try {
    const bucket = env.BACKUP_BUCKET || env.STORAGE_BUCKET;
    const writeToken = await mintToken(env.GCP_SA_EMAIL, env.GCP_SA_PRIVATE_KEY, STORAGE_SCOPE);
    state.requests += 2;
    await putObject(bucket, 'publish/latest.json', writeToken, JSON.stringify(manifest, null, 2));
    if (trigger === 'nightly') {
      state.requests += 1;
      await putObject(bucket, 'publish/latest-nightly.json', writeToken, JSON.stringify(manifest, null, 2));
    }
  } catch (err) {
    manifest.manifestError = String(err?.message || err).slice(0, 200);
  }

  return manifest;
}

export default { publishDirectory, encodeValue, encodeFields };
