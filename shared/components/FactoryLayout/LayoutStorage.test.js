// Making the layout permanent means no longer reading the per-visit documents.
// The risk in that is somebody's floor plan appearing to have been deleted, so
// the adoption rules are the part worth testing.
import { describe, it, expect } from 'vitest';
import { isEmptyLayout, pickAdoptableLayout } from './LayoutStorage.js';

const drawn = (over = {}) => ({
  lineBoxes: [{ id: 1, lineId: 7, x: 10, y: 10 }], walls: [], labels: [], ...over,
});

describe('isEmptyLayout', () => {
  it('is empty with nothing drawn on it', () => {
    expect(isEmptyLayout({ lineBoxes: [], walls: [], labels: [] })).toBe(true);
    expect(isEmptyLayout({})).toBe(true);
    expect(isEmptyLayout(null)).toBe(true);
  });

  it('a wall or a label alone still counts as a drawing', () => {
    expect(isEmptyLayout({ lineBoxes: [], walls: [{ id: 1 }], labels: [] })).toBe(false);
    expect(isEmptyLayout({ lineBoxes: [], walls: [], labels: [{ id: 1 }] })).toBe(false);
    expect(isEmptyLayout(drawn())).toBe(false);
  });
});

describe('pickAdoptableLayout', () => {
  it('takes the most recently updated visit layout', () => {
    const picked = pickAdoptableLayout([
      { id: 'visit_a', data: drawn({ updatedAt: '2026-01-01T00:00:00Z' }) },
      { id: 'visit_b', data: drawn({ updatedAt: '2026-08-01T00:00:00Z' }) },
      { id: 'visit_c', data: drawn({ updatedAt: '2026-03-01T00:00:00Z' }) },
    ]);
    expect(picked.id).toBe('visit_b');
  });

  it('never adopts the plant\'s own document — that is the one being replaced', () => {
    expect(pickAdoptableLayout([
      { id: 'default', data: drawn({ updatedAt: '2026-08-01T00:00:00Z' }) },
    ])).toBeNull();
  });

  it('skips empty visit layouts — an empty canvas is not work to rescue', () => {
    const picked = pickAdoptableLayout([
      { id: 'visit_new', data: { lineBoxes: [], walls: [], labels: [], updatedAt: '2026-08-09T00:00:00Z' } },
      { id: 'visit_old', data: drawn({ updatedAt: '2026-02-01T00:00:00Z' }) },
    ]);
    expect(picked.id).toBe('visit_old');
  });

  it('copes with a missing or unreadable timestamp rather than dropping the layout', () => {
    const picked = pickAdoptableLayout([
      { id: 'visit_undated', data: drawn() },
      { id: 'visit_broken', data: drawn({ updatedAt: 'not a date' }) },
    ]);
    expect(picked).not.toBeNull();
  });

  it('has nothing to adopt when there is nothing there', () => {
    expect(pickAdoptableLayout([])).toBeNull();
    expect(pickAdoptableLayout()).toBeNull();
  });
});
