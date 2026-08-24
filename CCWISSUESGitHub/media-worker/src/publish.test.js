// The nightly directory publish, run against a faked Firestore.
//
// A publish bug does not fail loudly — it writes a directory that looks fine
// and is stale or half-empty, discovered when a timesheet fills in last
// month's contact. So the whole flow runs here: read customers and jobs,
// write the three copies, delete the closed numbers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publishDirectory, encodeValue, encodeFields } from './publish.js';
import { decodeValue, decodeFields } from './backup.js';

const env = {
  FIREBASE_PROJECT_ID: 'ccw-p',
  PARTS_PROJECT_ID: 'jobs-p',
  TIMESHEET_PROJECT_ID: 'ts-p',
  WORKSPACE_UID: 'WS',
  GCP_SA_EMAIL: 'sa@ccw', GCP_SA_PRIVATE_KEY: 'k',
  PARTS_SA_EMAIL: 'sa@jobs', PARTS_SA_PRIVATE_KEY: 'k',
  TIMESHEET_SA_EMAIL: 'sa@ts', TIMESHEET_SA_PRIVATE_KEY: 'k',
  BACKUP_BUCKET: 'bucket',
};
const mintToken = vi.fn(async () => 'tok');

const doc = (path, fields) => ({ name: `projects/x/databases/(default)/documents/${path}`, fields });
const str = (s) => ({ stringValue: s });

// One customer whose record carries a former spelling as an alias, one open
// job filed under that former spelling, one closed job, one legacy
// reservation that never became a job.
const customersPage = {
  documents: [doc('user_files/WS/customers/oasis_date', {
    profile: { mapValue: { fields: {
      name: str('Oasis Date'),
      cityState: str('Yuma, AZ'),
      aliases: { arrayValue: { values: [str('DatePac')] } },
    } } },
  })],
};
const jobsPage = {
  documents: [
    doc('jobs/j1', { sr: str('2026030'), customer: str('DatePac'), date: str('2026-08-01') }),
    doc('jobs/j2', { sr: str('2026001'), customer: str('Oasis Date'), closedAt: str('2026-02-01') }),
  ],
};
const legacyPage = { documents: [doc('unified_jobs/2025099', { customer: str('Somebody Else') })] };
const tsExisting = { documents: [doc('sr_directory/2026001', { sr: str('2026001') })] };

describe('encodeValue', () => {
  it('round-trips through the backup decoder', () => {
    const cases = ['a', 7, 1.5, true, null, ['x', 'y'], { a: '1', b: ['2'] }];
    cases.forEach((v) => expect(decodeValue(encodeValue(v))).toEqual(v));
  });
  it('refuses what the directory never stores, loudly', () => {
    expect(() => encodeFields({ f: () => {} })).toThrow();
  });
});

describe('publishDirectory', () => {
  let commits, puts;

  beforeEach(() => {
    commits = [];
    puts = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const u = String(url);
      const ok = (body) => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) });
      if (u.includes(':commit')) {
        commits.push({ url: u, writes: JSON.parse(init.body).writes });
        return ok({});
      }
      if (u.includes('storage.googleapis.com')) { puts.push(u); return ok({}); }
      if (u.includes('/ccw-p/') && u.includes('/customers?')) return ok(customersPage);
      if (u.includes('/jobs-p/') && u.includes('/documents/jobs?')) return ok(jobsPage);
      if (u.includes('/jobs-p/') && u.includes('/unified_jobs?')) return ok(legacyPage);
      if (u.includes('/ts-p/') && u.includes('/sr_directory?')) return ok(tsExisting);
      if (u.includes('/ccw-p/') && u.includes('/sr_directory?')) return ok({ documents: [] });
      throw new Error(`Unexpected fetch: ${u}`);
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('publishes all three copies, joins by id, and deletes closed numbers', async () => {
    const manifest = await publishDirectory(env, mintToken, { trigger: 'nightly', now: new Date('2026-08-20T08:30:00Z') });

    expect(manifest.customers).toBe(1);
    // The closed job is not open; the legacy reservation still is.
    expect(manifest.openJobs).toBe(2);
    expect(manifest.results.map((r) => [r.name, r.ok])).toEqual([
      ['Timesheets', true], ['CCW reserved numbers', true], ['Jobs customer directory', true],
    ]);

    const byProject = (p) => commits.filter((c) => c.url.includes(`/${p}/`)).flatMap((c) => c.writes);
    const ts = byProject('ts-p');

    // The customer copy, defaults computed from the record.
    const custWrite = ts.find((w) => w.update?.name.endsWith('customer_directory/oasis_date'));
    const cust = decodeFields(custWrite.update.fields);
    expect(cust.name).toBe('Oasis Date');
    expect(cust.aliases).toEqual(['DatePac']);
    expect(cust.defaults.city).toBe('Yuma');

    // The open job, filed under the FORMER spelling, still joins to the
    // record's id — that is the entire point of publishing customerId.
    const srWrite = ts.find((w) => w.update?.name.endsWith('sr_directory/2026030'));
    expect(decodeFields(srWrite.update.fields).customerId).toBe('oasis_date');

    // Closed number deleted, not skipped.
    expect(ts.some((w) => w.delete?.endsWith('sr_directory/2026001'))).toBe(true);

    // CCW gets the numbers but, on purpose, no postal details.
    const ccw = byProject('ccw-p');
    const ccwSr = ccw.find((w) => w.update?.name.endsWith('sr_directory/2026030'));
    expect(ccwSr.update.name).toContain('user_files/WS/sr_directory');
    expect(Object.keys(decodeFields(ccwSr.update.fields))).not.toContain('address');

    // The Jobs project gets the customer directory too.
    const jobs = byProject('jobs-p');
    expect(jobs.some((w) => w.update?.name.endsWith('customer_directory/oasis_date'))).toBe(true);

    // Proof-it-ran files: latest.json always, the nightly copy for the cron.
    expect(puts.length).toBe(2);
  });

  it('reports a missing service account as a skip, not a crash', async () => {
    const manifest = await publishDirectory({ ...env, TIMESHEET_SA_EMAIL: '' }, mintToken, { trigger: 'manual' });
    const ts = manifest.results.find((r) => r.name === 'Timesheets');
    expect(ts.skipped).toBe(true);
    // The other two copies still went out.
    expect(manifest.results.filter((r) => r.ok).length).toBe(2);
  });
});
