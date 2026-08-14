// The parts of the nightly backup that decide what data means and what gets
// deleted.
//
// A decode bug here does not fail — it writes a backup that looks fine and is
// wrong, discovered during a recovery, which is the worst possible moment.
import { describe, it, expect } from 'vitest';
import { decodeValue, decodeFields, idOf, isExpiredBackup, backupTargets, docPathSegments, placeDoc, rotate } from './backup.js';

describe('decodeValue', () => {
  it('reads every scalar Firestore actually stores', () => {
    expect(decodeValue({ stringValue: 'Flagstone' })).toBe('Flagstone');
    expect(decodeValue({ booleanValue: false })).toBe(false);
    expect(decodeValue({ doubleValue: 42.5 })).toBe(42.5);
    expect(decodeValue({ timestampValue: '2026-08-14T10:00:00Z' })).toBe('2026-08-14T10:00:00Z');
    expect(decodeValue({ nullValue: null })).toBeNull();
  });

  it('turns an integer back into a number, not a string', () => {
    // Firestore sends integers as STRINGS. Left alone, every count and every
    // head number in a restored visit would come back as text and compare wrong.
    expect(decodeValue({ integerValue: '7' })).toBe(7);
    expect(decodeValue({ integerValue: '0' })).toBe(0);
  });

  it('keeps false and 0 rather than losing them to a falsy check', () => {
    expect(decodeFields({ fixed: { booleanValue: false }, count: { integerValue: '0' } }))
      .toEqual({ fixed: false, count: 0 });
  });

  it('descends into arrays and maps', () => {
    const fields = {
      lines: {
        arrayValue: {
          values: [
            { mapValue: { fields: { title: { stringValue: 'Line 1' }, heads: { integerValue: '14' } } } },
            { stringValue: 'plain' },
          ],
        },
      },
    };
    expect(decodeFields(fields)).toEqual({ lines: [{ title: 'Line 1', heads: 14 }, 'plain'] });
  });

  it('handles an empty array and an empty map', () => {
    expect(decodeValue({ arrayValue: {} })).toEqual([]);
    expect(decodeValue({ mapValue: {} })).toEqual({});
  });

  it('does not silently drop a type it does not know', () => {
    // Recorded rather than thrown away, so a restore can still see something
    // was there.
    expect(decodeValue({ referenceValue: 'projects/p/documents/c/d' })).toEqual({ __ref: 'projects/p/documents/c/d' });
    expect(decodeValue({ geoPointValue: { latitude: 1, longitude: 2 } })).toEqual({ __geo: { latitude: 1, longitude: 2 } });
  });

  it('survives nothing', () => {
    expect(decodeValue(null)).toBeNull();
    expect(decodeFields()).toEqual({});
  });
});

describe('idOf', () => {
  it('takes the last segment of a resource name', () => {
    expect(idOf('projects/p/databases/(default)/documents/user_files/abc/customers/xyz')).toBe('xyz');
    expect(idOf('')).toBe('');
  });
});

describe('isExpiredBackup', () => {
  const cutoff = new Date('2026-08-14T00:00:00Z').getTime();

  it('expires our own older files', () => {
    expect(isExpiredBackup('backups/2026-07-01/downtimelogger-a96fb.json', cutoff)).toBe(true);
    expect(isExpiredBackup('backups/2026-07-01/manifest.json', cutoff)).toBe(true);
  });

  it('reaches the streamed chunks, which are the bulk of a night', () => {
    // These sit a level deeper. An earlier pattern demanded a single segment
    // and so exempted exactly the biggest files, which is retention that
    // never reclaims anything.
    expect(isExpiredBackup('backups/2026-07-01/jobs-data-17ee4/parts-viewer-diagrams-0.json', cutoff)).toBe(true);
  });

  it('keeps anything newer than the cutoff', () => {
    expect(isExpiredBackup('backups/2026-08-14/x.json', cutoff)).toBe(false);
    expect(isExpiredBackup('backups/2026-09-01/x.json', cutoff)).toBe(false);
  });

  it('REFUSES anything that is not one of ours', () => {
    // This function is the only thing standing between retention and deleting
    // customer data, so everything unrecognised survives.
    [
      'user_files/abc/visit.pdf',
      'backups/latest.json',
      'backups/notadate/x.json',
      'my-backups/2026-07-01/x.json',
      '',
      null,
    ].forEach((n) => expect(isExpiredBackup(n, cutoff)).toBe(false));
  });
});

describe('backupTargets', () => {
  const env = {
    FIREBASE_PROJECT_ID: 'downtimelogger-a96fb', GCP_SA_EMAIL: 'a@b', GCP_SA_PRIVATE_KEY: 'k',
    PARTS_PROJECT_ID: 'jobs-data-17ee4', PARTS_SA_EMAIL: 'c@d', PARTS_SA_PRIVATE_KEY: 'k',
  };

  it('marks a project with credentials as ready', () => {
    const t = backupTargets(env);
    expect(t.find((x) => x.name === 'CCW Issues').ready).toBe(true);
    expect(t.find((x) => x.name === 'Jobs and packets').ready).toBe(true);
  });

  it('REPORTS a project it cannot reach instead of omitting it', () => {
    // An incomplete backup that looks complete is worse than none: the whole
    // value of this is knowing which data is actually covered.
    const t = backupTargets(env).find((x) => x.name === 'Timesheets');
    expect(t.ready).toBe(false);
    expect(t.reason).toMatch(/no project id|no service account/);
  });

  it('needs BOTH halves of a service account', () => {
    const half = backupTargets({ ...env, PARTS_SA_PRIVATE_KEY: '' }).find((x) => x.name === 'Jobs and packets');
    expect(half.ready).toBe(false);
    expect(half.reason).toMatch(/no service account/);
  });
});

describe('docPathSegments / placeDoc', () => {
  const NAME = 'projects/p/databases/(default)/documents/user_files/U1/customers/C1/visits/V1';

  it('reads the structure out of a resource name', () => {
    expect(docPathSegments(NAME)).toEqual(['user_files', 'U1', 'customers', 'C1', 'visits', 'V1']);
  });

  it('returns nothing for a name it does not recognise', () => {
    expect(docPathSegments('nonsense')).toEqual([]);
    expect(docPathSegments()).toEqual([]);
  });

  it('rebuilds the tree a collection-group query flattened', () => {
    const tree = {};
    placeDoc(tree, docPathSegments(NAME), { date: '2026-08-01' });
    expect(tree.user_files.U1.customers.C1.visits.V1).toEqual({ date: '2026-08-01' });
  });

  it('creates parents that have not arrived yet', () => {
    // `visits` is fetched in its own query and may well land before the
    // `customers` it belongs to.
    const tree = {};
    placeDoc(tree, docPathSegments(NAME), { date: '2026-08-01' });
    placeDoc(tree, ['user_files', 'U1', 'customers', 'C1'], { profile: { name: 'Flagstone' } });
    expect(tree.user_files.U1.customers.C1.profile.name).toBe('Flagstone');
    expect(tree.user_files.U1.customers.C1.visits.V1.date).toBe('2026-08-01');
  });

  it('does not lose children when the parent document arrives after them', () => {
    const tree = {};
    placeDoc(tree, ['a', '1', 'b', '2'], { x: 1 });
    placeDoc(tree, ['a', '1'], { y: 2 });
    expect(tree.a['1'].b['2']).toEqual({ x: 1 });
    expect(tree.a['1'].y).toBe(2);
  });

  it('ignores a malformed path rather than corrupting the tree', () => {
    const tree = {};
    placeDoc(tree, ['orphan'], { x: 1 });     // odd length: no id
    placeDoc(tree, [], { x: 1 });
    expect(tree).toEqual({});
  });
});

describe('rotate', () => {
  it('moves the starting point each day', () => {
    const l = ['a', 'b', 'c'];
    const d0 = rotate(l, new Date('2026-08-14T00:00:00Z'));
    const d1 = rotate(l, new Date('2026-08-15T00:00:00Z'));
    expect(d0).not.toEqual(d1);
    expect([...d0].sort()).toEqual(['a', 'b', 'c']);   // same set, different order
  });

  it('is stable within a day', () => {
    expect(rotate(['a', 'b', 'c'], new Date('2026-08-14T01:00:00Z')))
      .toEqual(rotate(['a', 'b', 'c'], new Date('2026-08-14T23:00:00Z')));
  });

  it('covers every position over enough days', () => {
    const l = ['a', 'b', 'c'];
    const firsts = new Set();
    for (let i = 0; i < 3; i += 1) {
      firsts.add(rotate(l, new Date(Date.UTC(2026, 7, 14 + i)))[0]);
    }
    expect(firsts.size).toBe(3);
  });

  it('copes with short lists', () => {
    expect(rotate([], new Date())).toEqual([]);
    expect(rotate(['only'], new Date())).toEqual(['only']);
  });
});
