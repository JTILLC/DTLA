import { describe, it, expect } from 'vitest';
import { manualQty, clampQty, asPicked, toStored, fromStored, partLines, qtyLabel } from './partLines.js';

describe('manualQty', () => {
  it('reads the plain cases the manuals mostly contain', () => {
    expect(manualQty({ qty: '10' })).toBe(10);
    expect(manualQty({ qty: 2 })).toBe(2);
  });

  it('digs a number out of a transcribed quantity', () => {
    expect(manualQty({ qty: '4 pcs' })).toBe(4);
  });

  it('treats an unreadable or absent quantity as no ceiling, not as zero', () => {
    // "AR" (as required) must not become a cap of 0 and block the entry.
    for (const qty of ['AR', '', '-', null, undefined, 0, '0']) {
      expect(manualQty({ qty })).toBeNull();
    }
    expect(manualQty(undefined)).toBeNull();
  });

  it('prefers an explicit manualQty over the catalog field it was derived from', () => {
    expect(manualQty({ manualQty: 3, qty: 99 })).toBe(3);
  });
});

describe('clampQty', () => {
  it('never returns less than one', () => {
    expect(clampQty(0, 10)).toBe(1);
    expect(clampQty(-5, 10)).toBe(1);
    expect(clampQty('', 10)).toBe(1);
    expect(clampQty(NaN, 10)).toBe(1);
  });

  it('caps at what the drawing shows', () => {
    expect(clampQty(20, 10)).toBe(10);
    expect(clampQty(2, 10)).toBe(2);
  });

  it('allows any count when the drawing quantity is unknown', () => {
    expect(clampQty(20, null)).toBe(20);
  });
});

describe('asPicked', () => {
  it('defaults to one, which is the only possible answer for a single-item part', () => {
    expect(asPicked({ partCode: 'X', qty: '1' })).toMatchObject({ manualQty: 1, qty: 1 });
  });

  it('defaults to one even when the drawing shows many', () => {
    expect(asPicked({ partCode: 'X', qty: '10' })).toMatchObject({ manualQty: 10, qty: 1 });
  });
});

describe('round trip', () => {
  it('survives store → reopen without drift', () => {
    const picked = { ...asPicked({ partCode: 'PC-1', partName: 'Screw', itemNo: '7', qty: '10' }), qty: 4 };
    const stored = toStored(picked);
    expect(stored).toMatchObject({ partNumber: 'PC-1', partName: 'Screw', itemNo: '7', qty: 4, manualQty: 10 });
    expect(fromStored(stored)).toMatchObject({ partCode: 'PC-1', qty: 4, manualQty: 10 });
  });

  it('clamps a stored count to the drawing rather than trusting the form', () => {
    const stored = toStored({ partCode: 'PC-1', qty: 99, manualQty: 10 });
    expect(stored.qty).toBe(10);
  });

  it('falls back to the item number when a part has no code', () => {
    expect(toStored({ itemNo: 12, qty: 1 }).partNumber).toBe('12');
  });
});

describe('partLines', () => {
  it('reads a multi-part entry', () => {
    const lines = partLines({ parts: [
      { partNumber: 'A', partName: 'Board', qty: 1 },
      { partNumber: 'B', partName: 'Screw', qty: 4, manualQty: 10 },
    ] });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ partNumber: 'B', qty: 4, manualQty: 10 });
  });

  it('still reads an entry written before multi-part support', () => {
    expect(partLines({ partNumber: 'OLD-1', partName: 'Load cell' }))
      .toEqual([{ partNumber: 'OLD-1', partName: 'Load cell', qty: 1, manualQty: null }]);
  });

  it('counts a part written before quantities existed as one', () => {
    expect(partLines({ parts: [{ partNumber: 'A' }] })[0].qty).toBe(1);
  });

  it('returns nothing for an entry with no parts at all', () => {
    expect(partLines({})).toEqual([]);
    expect(partLines(null)).toEqual([]);
  });
});

describe('qtyLabel', () => {
  it('stays quiet for a single part and speaks up for more', () => {
    expect(qtyLabel(1)).toBe('');
    expect(qtyLabel(undefined)).toBe('');
    expect(qtyLabel(4)).toBe('×4');
  });
});
