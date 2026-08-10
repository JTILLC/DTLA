// The stale-write guard, exercised against a fake Firestore.
//
// One document now has two authors: JTI plotting a plant's floor, and the plant
// adjusting it afterwards. "Last write wins" would quietly cost somebody an
// afternoon of plotting, so a save carries the timestamp it was working from
// and refuses when the stored copy has moved on.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// A Firestore just real enough: one document, plus a transaction that reads it
// and may write it.
const db = { doc: null };

vi.mock('firebase/compat/firestore', () => ({}));
vi.mock('firebase/compat/app', () => {
  // Every node answers collection/doc/get/set, so the real chain
  // (collection → doc → collection → doc) resolves whatever its shape.
  const chain = {
    collection: () => chain,
    doc: () => chain,
    get: async () => ({ docs: [], exists: !!db.doc, data: () => db.doc }),
    set: async (data) => { db.doc = { ...data }; },
  };
  const firestore = () => ({
    collection: () => chain,
    runTransaction: async (fn) => fn({
      get: async () => ({ exists: !!db.doc, data: () => db.doc }),
      set: (_r, data) => { db.doc = { ...data }; },
    }),
  });
  return { default: { firestore } };
});

const { saveLayout } = await import('./LayoutStorage.js');

const drawing = (n = 1) => ({ lineBoxes: [{ id: n, lineId: n, x: n, y: n }], walls: [], labels: [] });

beforeEach(() => { db.doc = null; });

describe('saveLayout', () => {
  it('records who plotted it', async () => {
    const res = await saveLayout('u', 'c', drawing(), { author: 'JTI' });
    expect(res.ok).toBe(true);
    expect(db.doc.updatedBy).toBe('JTI');
    expect(db.doc.updatedAt).toBeTruthy();
    expect(db.doc.rev).toBe(1);
  });

  it('the revision counter climbs, so two saves in one millisecond still differ', async () => {
    await saveLayout('u', 'c', drawing(1), { author: 'JTI' });
    const first = db.doc.rev;
    await saveLayout('u', 'c', drawing(2), { author: 'JTI', force: true });
    expect(db.doc.rev).toBe(first + 1);
  });

  it('writes when nobody has saved since — the ordinary case', async () => {
    await saveLayout('u', 'c', drawing(1), { author: 'JTI' });
    const base = db.doc.rev;
    const res = await saveLayout('u', 'c', drawing(2), { author: 'JTI', baseRev: base });
    expect(res.ok).toBe(true);
    expect(db.doc.lineBoxes[0].id).toBe(2);
  });

  it('refuses, and hands back theirs, when the stored copy has moved on', async () => {
    await saveLayout('u', 'c', drawing(1), { author: 'JTI' });
    const staleBase = db.doc.rev;
    // The plant saves in the meantime.
    await saveLayout('u', 'c', drawing(9), { author: 'Test Customer' });

    const res = await saveLayout('u', 'c', drawing(2), { author: 'JTI', baseRev: staleBase });
    expect(res.ok).toBe(false);
    expect(res.conflict).toBe(true);
    expect(res.theirs.updatedBy).toBe('Test Customer');
    // The plant's work is still the stored one — nothing was overwritten.
    expect(db.doc.lineBoxes[0].id).toBe(9);
  });

  it('force overwrites, for when the person has been asked and chose to', async () => {
    await saveLayout('u', 'c', drawing(9), { author: 'Test Customer' });
    const res = await saveLayout('u', 'c', drawing(2), { author: 'JTI', force: true });
    expect(res.ok).toBe(true);
    expect(db.doc.lineBoxes[0].id).toBe(2);
    expect(db.doc.updatedBy).toBe('JTI');
  });

  it('never stores the bookkeeping fields it was handed', async () => {
    await saveLayout('u', 'c', { ...drawing(), updatedAt: 'stale', updatedBy: 'ghost', _isVisitSpecific: true },
      { author: 'JTI' });
    expect(db.doc.updatedBy).toBe('JTI');
    expect(db.doc.updatedAt).not.toBe('stale');
    expect(db.doc._isVisitSpecific).toBeUndefined();
  });
});
