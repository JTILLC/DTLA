// Rebuilding a plant's lines from its own history. The risks are quiet ones:
// carrying last month's faults onto a fresh log, giving two lines the same id,
// or renaming a line so it loses the head history matched to its title.
import { describe, it, expect } from 'vitest';
import { linesFromHistory, lineTitlesFromHistory } from './linesFromHistory.js';

const head = (id, over = {}) => ({ id, status: 'active', error: 'None', fixed: 'na', issues: [], notes: '', ...over });
const line = (title, heads = 14, over = {}) => ({
  id: 99, title, running: true, heads: Array.from({ length: heads }, (_, i) => head(i + 1)), ...over,
});
const visit = (date, lines, over = {}) => ({ id: `v-${date}`, date, lines, ...over });

describe('linesFromHistory', () => {
  it('takes one entry per line name', () => {
    const out = linesFromHistory([
      visit('2026-01-01', [line('Line 1'), line('Line 2')]),
      visit('2026-02-01', [line('Line 1'), line('Line 2')]),
    ]);
    expect(out.map((l) => l.title)).toEqual(['Line 1', 'Line 2']);
  });

  it('keeps the head count the line had most recently', () => {
    const out = linesFromHistory([
      visit('2025-01-01', [line('Line 1', 10)]),
      visit('2026-01-01', [line('Line 1', 16)]),
    ]);
    expect(out[0].heads).toHaveLength(16);
  });

  it('keeps a line that only appears in an older record', () => {
    const out = linesFromHistory([
      visit('2026-01-01', [line('Line 1')]),
      visit('2024-01-01', [line('Old Line')]),
    ]);
    expect(out.map((l) => l.title)).toEqual(['Line 1', 'Old Line']);
  });

  it('follows the newest record for order', () => {
    const out = linesFromHistory([
      visit('2025-01-01', [line('A'), line('B'), line('C')]),
      visit('2026-01-01', [line('C'), line('A'), line('B')]),
    ]);
    expect(out.map((l) => l.title)).toEqual(['C', 'A', 'B']);
  });

  it('does NOT carry last month\'s faults onto a fresh log', () => {
    const dirty = line('Line 1', 2);
    dirty.heads[0] = head(1, { status: 'offline', issues: [{ type: 'Load cell', fixed: 'not_fixed' }], notes: 'seized' });
    const out = linesFromHistory([visit('2026-01-01', [dirty])]);
    expect(out[0].heads[0].status).toBe('active');
    expect(out[0].heads[0].issues).toEqual([]);
    expect(out[0].heads[0].notes).toBe('');
  });

  it('gives every line its own id', () => {
    // The originals came from different records and can collide; two lines
    // sharing an id cannot be edited independently.
    const out = linesFromHistory([
      visit('2026-01-01', [{ ...line('A'), id: 5 }]),
      visit('2025-01-01', [{ ...line('B'), id: 5 }]),
    ]);
    expect(new Set(out.map((l) => l.id)).size).toBe(out.length);
  });

  it('copies names EXACTLY — history is matched on the title', () => {
    const out = linesFromHistory([visit('2026-01-01', [line('PPI-3 (HT)')])]);
    expect(out[0].title).toBe('PPI-3 (HT)');
  });

  it('ignores deleted records and untitled lines', () => {
    const out = linesFromHistory([
      visit('2026-01-01', [line('Keep')]),
      visit('2026-02-01', [line('Gone')], { deleted: true }),
      visit('2026-03-01', [{ id: 1, heads: [] }]),
    ]);
    expect(out.map((l) => l.title)).toEqual(['Keep']);
  });

  it('survives nothing to go on', () => {
    expect(linesFromHistory()).toEqual([]);
    expect(linesFromHistory([])).toEqual([]);
    expect(linesFromHistory([visit('2026-01-01', [])])).toEqual([]);
  });

  it('lineTitlesFromHistory matches what would be built', () => {
    const visits = [visit('2026-01-01', [line('Line 1'), line('Line 2')])];
    expect(lineTitlesFromHistory(visits)).toEqual(linesFromHistory(visits).map((l) => l.title));
  });
});
