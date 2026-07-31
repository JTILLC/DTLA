import { describe, it, expect } from 'vitest';
import {
  manualQty, clampQty, asPicked, toStored, fromStored,
  partLines, qtyLabel, mergeParts, isAssembly,
} from './partLines.js';

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

  it('never mistakes a REPLACED count for the drawing count', () => {
    // The bug this guards: on a picked part `qty` is how many were replaced.
    // Falling through from an empty manualQty to qty read "1 replaced" as "the
    // drawing shows 1" and locked the quantity control at 1 — which is exactly
    // what "there is no way to change the quantity" looked like.
    expect(manualQty({ manualQty: null, qty: 1 })).toBeNull();
    expect(manualQty({ manualQty: '', qty: 5 })).toBeNull();
    expect(manualQty({ manualQty: undefined, qty: 3 })).toBeNull();
  });

  it('still reads a raw catalog part, whose qty IS the drawing count', () => {
    expect(manualQty({ partCode: 'X', qty: '10' })).toBe(10);   // no manualQty key
  });
});

describe('mergeParts', () => {
  const p = (code, diagram = 'd1', item = '1') => ({ partCode: code, diagramId: diagram, itemNo: item });

  it('adds to the list instead of replacing it', () => {
    // The reported bug: picking again wiped everything already chosen.
    const existing = [p('A', 'd1', '1')];
    expect(mergeParts(existing, [p('B', 'd1', '2')]).map((x) => x.partCode))
      .toEqual(['A', 'B']);
  });

  it('does not add a part that is already on the replacement', () => {
    const existing = [p('A')];
    expect(mergeParts(existing, [p('A'), p('B', 'd1', '2')]).map((x) => x.partCode))
      .toEqual(['A', 'B']);
  });

  it('does not duplicate the primary part into the extras', () => {
    const primary = p('A');
    expect(mergeParts([], [p('A'), p('B', 'd1', '2')], primary).map((x) => x.partCode))
      .toEqual(['B']);
  });

  it('treats the same code on a different drawing as a different part', () => {
    expect(mergeParts([p('A', 'd1')], [p('A', 'd2')])).toHaveLength(2);
  });

  it('survives empty input', () => {
    expect(mergeParts()).toEqual([]);
    expect(mergeParts([p('A')], [])).toHaveLength(1);
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

  it('records what was replaced even when it exceeds the drawing', () => {
    // The drawing count is guidance, not a limit. Clamping it silently
    // rewrote the number someone entered, which makes the log lie about the
    // job — and made every part the manual lists once un-editable.
    const stored = toStored({ partCode: 'PC-1', qty: 99, manualQty: 10 });
    expect(stored.qty).toBe(99);
    expect(stored.manualQty).toBe(10);   // still recorded, for context
  });

  it('keeps an over-count when the entry is reopened', () => {
    expect(fromStored({ partNumber: 'PC-1', qty: 4, manualQty: 1 }))
      .toMatchObject({ qty: 4, manualQty: 1 });
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
      .toEqual([{ partNumber: 'OLD-1', partName: 'Load cell', itemNo: '', qty: 1, manualQty: null }]);
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

describe('isAssembly', () => {
  it('recognises the drawing-level unit row', () => {
    expect(isAssembly({ itemNo: '*' })).toBe(true);
    expect(isAssembly({ itemNo: ' * ' })).toBe(true);
    expect(isAssembly({ itemNo: '' })).toBe(true);      // no balloon number at all
    expect(isAssembly({})).toBe(true);
  });

  it('does not mistake a real part for one', () => {
    expect(isAssembly({ itemNo: '1' })).toBe(false);
    expect(isAssembly({ itemNo: 61 })).toBe(false);
    expect(isAssembly({ itemNo: '10A' })).toBe(false);
  });
});

describe('partLines item numbers', () => {
  it('carries the balloon number through for the log', () => {
    const [line] = partLines({ parts: [{ partNumber: 'A', itemNo: 61, qty: 2 }] });
    expect(line).toMatchObject({ partNumber: 'A', itemNo: '61', qty: 2 });
  });

  it('is blank rather than "undefined" when a part has no item number', () => {
    expect(partLines({ parts: [{ partNumber: 'A' }] })[0].itemNo).toBe('');
    expect(partLines({ partNumber: 'OLD' })[0].itemNo).toBe('');
  });
});
