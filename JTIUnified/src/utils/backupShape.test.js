// The round trip a real recovery depends on.
//
// The restore half of this system was written, never run, and did not work.
// These tests are the substitute for having found that out during an actual
// recovery — which is the only other way anyone would have.
import { describe, it, expect } from 'vitest';
import { ccwCustomerNode, ccwCustomerSplit, planRestore, describePlan, deepSame } from './backupShape.js';
import { SANDBOX_UID } from '../backup-service.js';

describe('CCW customer round trip', () => {
  // Exactly the shape Firestore holds: the document IS { profile: {...} }.
  const docData = {
    profile: { name: 'Flagstone Foods', city: 'Robersonville', invoiceEmails: ['ap@example.com'] },
  };
  const visits = {
    v1: { date: '2026-08-01', lines: [{ title: 'Line 1' }] },
    v2: { date: '2026-08-09', lines: [] },
  };

  it('comes back exactly as it went in', () => {
    expect(ccwCustomerSplit(ccwCustomerNode(docData, visits))).toEqual({ docData, visits });
  });

  it('does NOT double-wrap the profile', () => {
    // The actual bug: restoring wrote { profile: { profile: {...} } }, which
    // breaks every read of that customer and looks like the record emptying.
    const { docData: out } = ccwCustomerSplit(ccwCustomerNode(docData, visits));
    expect(out.profile.profile).toBeUndefined();
    expect(out.profile.name).toBe('Flagstone Foods');
  });

  it('survives a customer with no visits', () => {
    expect(ccwCustomerSplit(ccwCustomerNode(docData)).visits).toEqual({});
    expect(ccwCustomerSplit({ profile: { name: 'X' } }).visits).toEqual({});
  });

  it('does not mistake a junk visits value for visits', () => {
    expect(ccwCustomerSplit({ profile: {}, visits: 'nonsense' }).visits).toEqual({});
  });

  it('keeps fields stored beside the profile', () => {
    // Older documents kept a name at the top level; a restore must not eat it.
    const legacy = { name: 'Old Style', profile: { city: 'Y' } };
    expect(ccwCustomerSplit(ccwCustomerNode(legacy, {})).docData).toEqual(legacy);
  });

  it('survives nothing at all', () => {
    expect(() => ccwCustomerSplit()).not.toThrow();
    expect(() => ccwCustomerSplit(null)).not.toThrow();
  });
});

describe('planRestore', () => {
  const ccw = {
    app: 'CCW Issues',
    timestamp: new Date().toISOString(),
    data: { uid1: { customers: { c1: { profile: {}, visits: { v1: {}, v2: {} } }, c2: { profile: {} } } } },
  };

  it('counts what would be written, without writing it', () => {
    const p = planRestore(ccw);
    expect(p.valid).toBe(true);
    expect(p.writes).toEqual([{ what: 'customers', n: 2 }, { what: 'visits', n: 2 }]);
  });

  it('warns that a Shearers restore replaces everything', () => {
    // set() at the tree root deletes anything not in the file.
    const p = planRestore({ app: 'Shearers Downtime Logger', timestamp: new Date().toISOString(), data: { a: {}, b: {} } });
    expect(p.warnings.join(' ')).toMatch(/REPLACES the whole downtime tree/);
  });

  it('warns that jobs years are replaced whole', () => {
    const p = planRestore({ app: 'JTI Jobs Tracker', timestamp: new Date().toISOString(), data: { 2026: [{}, {}], 2025: [{}] } });
    expect(p.writes).toContainEqual({ what: 'jobs', n: 3 });
    // Per-job documents: what is in the file is overwritten, the rest survives.
    expect(p.warnings.join(' ')).toMatch(/left alone/);
  });

  it('says how old the file is, once that starts to matter', () => {
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    expect(planRestore({ ...ccw, timestamp: old }).warnings.join(' ')).toMatch(/40 days old/);
    expect(planRestore(ccw).warnings.join(' ')).not.toMatch(/days old/);
  });

  it('refuses a file that is not a backup', () => {
    expect(planRestore({ hello: 'world' }).valid).toBe(false);
    expect(planRestore(null).valid).toBe(false);
    expect(planRestore({ app: 'Something Else', data: { a: 1 } }).valid).toBe(false);
  });

  it('refuses an empty backup — restoring one would just wipe things', () => {
    const p = planRestore({ app: 'Timesheet', timestamp: new Date().toISOString(), data: {} });
    expect(p.valid).toBe(false);
    expect(p.warnings.join(' ')).toMatch(/no records/);
  });
});

describe('describePlan', () => {
  it('reads as a sentence a person can approve', () => {
    const p = planRestore({ app: 'Timesheet', timestamp: new Date().toISOString(), data: { a: {}, b: {} } });
    expect(describePlan(p)).toBe('Timesheet: 2 timesheets');
  });

  it('leads with the reason when it cannot be restored', () => {
    expect(describePlan(planRestore({ hello: 1 }))).toMatch(/not a backup/i);
  });
});

// The comparison the restore verification rests on.
//
// A false "identical" is the worst outcome available here: it would certify a
// restore that silently lost data, which is worse than never checking.

describe('deepSame', () => {
  it('ignores key order, which Firestore does not preserve', () => {
    expect(deepSame({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepSame({ p: { x: 1, y: 2 } }, { p: { y: 2, x: 1 } })).toBe(true);
  });

  it('notices a value that changed', () => {
    expect(deepSame({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepSame({ profile: { city: 'X' } }, { profile: { city: 'Y' } })).toBe(false);
  });

  it('notices a field that went missing', () => {
    // The double-wrap bug lost fields exactly like this.
    expect(deepSame({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(deepSame({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('does NOT treat a wrapped object as the same as an unwrapped one', () => {
    // The restore bug this whole exercise started from.
    expect(deepSame({ profile: { name: 'X' } }, { profile: { profile: { name: 'X' } } })).toBe(false);
  });

  it('respects array order, which is meaningful for lines and heads', () => {
    expect(deepSame({ lines: [1, 2] }, { lines: [2, 1] })).toBe(false);
    expect(deepSame({ lines: [1, 2] }, { lines: [1, 2] })).toBe(true);
  });

  it('separates 0, false, null and absent', () => {
    expect(deepSame({ n: 0 }, { n: false })).toBe(false);
    expect(deepSame({ n: null }, {})).toBe(false);
  });
});

// The sandbox the restore verification writes into.
describe('SANDBOX_UID', () => {
  it('is not a reserved Firestore id', () => {
    // Firestore rejects any id matching __…__ outright, which is how the first
    // verification attempt failed — after the backup had already been read.
    expect(/^__.*__$/.test(SANDBOX_UID)).toBe(false);
  });

  it('cannot collide with a real Firebase account', () => {
    // Real uids are 28 characters of alphanumeric; this is neither.
    expect(/^[A-Za-z0-9]{28}$/.test(SANDBOX_UID)).toBe(false);
    expect(SANDBOX_UID).toMatch(/-/);
  });

  it('is a legal Firestore document id', () => {
    expect(SANDBOX_UID.length).toBeGreaterThan(0);
    expect(SANDBOX_UID.length).toBeLessThanOrEqual(1500);
    expect(SANDBOX_UID).not.toContain('/');
    expect(SANDBOX_UID).not.toBe('.');
    expect(SANDBOX_UID).not.toBe('..');
  });
});
