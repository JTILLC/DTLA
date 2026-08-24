// Ringing a day's work on one drawing. Over-ringing claims a part was replaced
// when it was not, which is worse than ringing too little.
import { describe, it, expect } from 'vitest';
import { sameDayItemsOnDiagram, diagramLabel } from './dayDiagramItems.js';

const at = (iso) => new Date(iso).toISOString();
const entry = (over = {}) => ({
  lineTitle: 'Line 2',
  performedAt: at('2026-08-23T09:00:00'),
  partDiagramId: 'd1',
  parts: [{ itemNo: '7', partNumber: 'AAA', diagramId: 'd1' }],
  headNumber: 3,
  ...over,
});

describe('what gets ringed', () => {
  it('rings the clicked entry on its own', () => {
    const e = entry();
    expect(sameDayItemsOnDiagram([e], e).map((p) => p.itemNo)).toEqual(['7']);
  });

  it('rings the rest of the day on the same drawing and line', () => {
    const e = entry();
    const later = entry({ performedAt: at('2026-08-23T14:30:00'), headNumber: 9,
      parts: [{ itemNo: '15', partNumber: 'BBB', diagramId: 'd1' }] });
    expect(sameDayItemsOnDiagram([e, later], e).map((p) => p.itemNo)).toEqual(['7', '15']);
  });

  it('puts the clicked part first, whatever order the log is in', () => {
    const e = entry();
    const earlier = entry({ performedAt: at('2026-08-23T07:00:00'),
      parts: [{ itemNo: '2', partNumber: 'CCC', diagramId: 'd1' }] });
    expect(sameDayItemsOnDiagram([earlier, e], e)[0].itemNo).toBe('7');
  });

  it('leaves out another day', () => {
    const e = entry();
    const yesterday = entry({ performedAt: at('2026-08-22T09:00:00'),
      parts: [{ itemNo: '15', partNumber: 'BBB', diagramId: 'd1' }] });
    expect(sameDayItemsOnDiagram([e, yesterday], e).map((p) => p.itemNo)).toEqual(['7']);
  });

  it('leaves out another line, even on the same drawing', () => {
    // Two lines can be the same machine. Ringing Line 3's part on Line 2's
    // drawing says work happened on a machine it did not.
    const e = entry();
    const otherLine = entry({ lineTitle: 'Line 3',
      parts: [{ itemNo: '15', partNumber: 'BBB', diagramId: 'd1' }] });
    expect(sameDayItemsOnDiagram([e, otherLine], e).map((p) => p.itemNo)).toEqual(['7']);
  });

  it('leaves out parts on a different drawing', () => {
    const e = entry();
    const other = entry({ parts: [{ itemNo: '15', partNumber: 'BBB', diagramId: 'd2' }] });
    expect(sameDayItemsOnDiagram([e, other], e).map((p) => p.itemNo)).toEqual(['7']);
  });

  it('rings one balloon once even if two entries name it', () => {
    const e = entry();
    const again = entry({ headNumber: 9 });   // same item 7, different head
    expect(sameDayItemsOnDiagram([e, again], e)).toHaveLength(1);
  });

  it('reads an entry written before multi-part logs existed', () => {
    const legacy = { lineTitle: 'Line 2', performedAt: at('2026-08-23T09:00:00'),
      partDiagramId: 'd1', partItemNo: '4', partNumber: 'OLD' };
    expect(sameDayItemsOnDiagram([legacy], legacy).map((p) => p.itemNo)).toEqual(['4']);
  });

  it('never rings the assembly itself', () => {
    const e = entry({ parts: [{ itemNo: '*', partNumber: 'UNIT', diagramId: 'd1' }] });
    expect(sameDayItemsOnDiagram([e], e)).toEqual([]);
  });

  it('is empty when there is no drawing to ring on', () => {
    expect(sameDayItemsOnDiagram([], null)).toEqual([]);
    expect(sameDayItemsOnDiagram([], { partDiagramId: '' })).toEqual([]);
  });
});

describe('what the viewer is titled', () => {
  it('counts them when there are several', () => {
    expect(diagramLabel([{ itemNo: '7' }, { itemNo: '9' }])).toBe('2 parts on this drawing');
  });

  it('names the part when there is one', () => {
    expect(diagramLabel([{ itemNo: '7', partNumber: 'AAA' }])).toBe('AAA');
  });

  it('falls back to whatever the entry called it', () => {
    expect(diagramLabel([], 'ZZZ')).toBe('ZZZ');
  });
});
