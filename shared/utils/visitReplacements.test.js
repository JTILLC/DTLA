// Deciding which parts belong on which visit's report. Too wide bills a
// customer for another call's work; too narrow prints a report with the parts
// missing, which is what day-matching did on real data.
import { describe, it, expect } from 'vitest';
import { visitWindow, replacementsForVisit, replacementRows } from './visitReplacements.js';

// Newest first, the order the app holds them in.
const VISITS = [
  { id: 'v3', date: '2026-08-14T08:00:00Z' },
  { id: 'v2', date: '2026-07-25T08:00:00Z' },
  { id: 'v1', date: '2026-04-17T08:00:00Z' },
];
const rep = (over = {}) => ({
  lineTitle: 'Line 2', performedAt: '2026-07-30T10:00:00Z',
  headNumber: 3, boardType: 'Load Cell Amplifier', reason: 'Water ingress',
  parts: [{ partNumber: 'AAA', partName: 'AMP', qty: 1 }], ...over,
});

describe('a visit\'s window', () => {
  it('runs from this visit to the next one', () => {
    expect(visitWindow(VISITS, 'v2')).toEqual({ from: '2026-07-25T08:00:00Z', to: '2026-08-14T08:00:00Z' });
  });

  it('stays open for the newest visit', () => {
    expect(visitWindow(VISITS, 'v3').to).toBeNull();
  });

  it('is nothing for a visit that is not there', () => {
    expect(visitWindow(VISITS, 'nope')).toBeNull();
    expect(visitWindow([], 'v1')).toBeNull();
  });
});

describe('what lands on the report', () => {
  const w = visitWindow(VISITS, 'v2');   // 25 Jul → 14 Aug

  it('includes a part fitted days into the visit', () => {
    // The case day-matching missed: visit opened the 25th, part on the 30th.
    expect(replacementsForVisit([rep()], { lineTitle: 'Line 2', window: w })).toHaveLength(1);
  });

  it('excludes the next visit\'s work', () => {
    const later = rep({ performedAt: '2026-08-20T10:00:00Z' });
    expect(replacementsForVisit([later], { lineTitle: 'Line 2', window: w })).toEqual([]);
  });

  it('excludes work from before this visit opened', () => {
    const earlier = rep({ performedAt: '2026-07-01T10:00:00Z' });
    expect(replacementsForVisit([earlier], { lineTitle: 'Line 2', window: w })).toEqual([]);
  });

  it('includes something logged at the very moment the visit opened', () => {
    expect(replacementsForVisit([rep({ performedAt: '2026-07-25T08:00:00Z' })],
      { lineTitle: 'Line 2', window: w })).toHaveLength(1);
  });

  it('gives the boundary to the NEWER visit', () => {
    // Logged exactly when the next visit opened: it belongs to that one.
    expect(replacementsForVisit([rep({ performedAt: '2026-08-14T08:00:00Z' })],
      { lineTitle: 'Line 2', window: w })).toEqual([]);
  });

  it('keeps to the line being reported', () => {
    expect(replacementsForVisit([rep({ lineTitle: 'Line 4' })],
      { lineTitle: 'Line 2', window: w })).toEqual([]);
  });

  it('prints nothing when no visit is open', () => {
    expect(replacementsForVisit([rep()], { lineTitle: 'Line 2', window: null })).toEqual([]);
  });

  it('runs to now for the newest visit', () => {
    const open = visitWindow(VISITS, 'v3');
    expect(replacementsForVisit([rep({ performedAt: '2026-08-22T10:00:00Z' })],
      { lineTitle: 'Line 2', window: open })).toHaveLength(1);
  });
});

describe('the rows it prints', () => {
  it('puts the head and reason on the first part only', () => {
    const entry = rep({ parts: [
      { partNumber: 'AAA', partName: 'AMP', qty: 2 },
      { partNumber: 'BBB', partName: 'GASKET', qty: 1 },
    ] });
    const rows = replacementRows(entry);
    expect(rows).toEqual([
      ['Head 3', 'Load Cell Amplifier', 'AAA · AMP', '2', 'Water ingress'],
      ['', '', 'BBB · GASKET', '1', ''],
    ]);
  });

  it('says Machine when no head was named', () => {
    expect(replacementRows(rep({ headNumber: null }))[0][0]).toBe('Machine');
  });

  it('leaves the board-type column empty for a non-board part', () => {
    expect(replacementRows(rep({ boardType: 'Part (not a board)' }))[0][1]).toBe('');
  });

  it('still prints a row for an entry with no part number', () => {
    const rows = replacementRows({ headNumber: 1, boardType: 'I/O Board', reason: 'Failed' });
    expect(rows).toEqual([['Head 1', 'I/O Board', '—', '', 'Failed']]);
  });
});
