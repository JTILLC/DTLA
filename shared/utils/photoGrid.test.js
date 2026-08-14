// Grid placement, shared by every report that embeds photos.
//
// These live here rather than in one app because all three had the same fault
// and now share the same fix: a guard that only runs in the app you happen to
// be working in is a guard that does not run.
import { describe, it, expect } from 'vitest';
import { layoutGrid, fitInCell } from './photoGrid.js';

// Grid placement. Photos used to run one per row down the page because each
// line/head group got its own heading and most groups hold a single photo.
// These pin the arithmetic: a cell one row too low is invisible in review and
// obvious here.
describe('layoutGrid', () => {
  const opts = { x: 14, y: 20, cols: 3, cellW: 58, imgH: 40, captionH: 5, gap: 4, pageTop: 20, pageBottom: 282 };

  it('fills across before it moves down', () => {
    const cells = layoutGrid(3, opts);
    expect(cells.map((c) => c.col)).toEqual([0, 1, 2]);
    expect(new Set(cells.map((c) => c.y)).size).toBe(1);      // one row
    expect(cells.map((c) => c.x)).toEqual([14, 76, 138]);     // x + col*(58+4)
  });

  it('wraps to a new row after the last column', () => {
    const cells = layoutGrid(4, opts);
    expect(cells[3].col).toBe(0);
    expect(cells[3].x).toBe(14);
    expect(cells[3].y).toBeGreaterThan(cells[0].y);
    expect(cells[3].y - cells[0].y).toBe(49);                 // imgH + captionH + gap
  });

  it('breaks the page before a row would run off the bottom', () => {
    // Five rows of 49 from y=20 reaches 265; the sixth would end past 282.
    const cells = layoutGrid(21, opts);
    const broken = cells.filter((c) => c.newPage);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken[0].index).toBeGreaterThan(0);
  });

  it('restarts columns from the left after a page break', () => {
    // The cell after a break must not inherit the column it would have had.
    const cells = layoutGrid(21, opts);
    const b = cells.findIndex((c) => c.newPage);
    expect(cells[b].col).toBe(0);
    expect(cells[b].x).toBe(14);
    if (cells[b + 1]) {
      expect(cells[b + 1].col).toBe(1);
      expect(cells[b + 1].y).toBe(cells[b].y);                // same row
    }
  });

  it('handles one photo, and none', () => {
    expect(layoutGrid(1, opts)).toHaveLength(1);
    expect(layoutGrid(0, opts)).toEqual([]);
  });
});

describe('fitInCell', () => {
  it('scales a wide photo to the cell width', () => {
    const { w, h } = fitInCell(1000, 500, 58, 40);
    expect(w).toBeCloseTo(58, 1);
    expect(h).toBeCloseTo(29, 1);
  });

  it('scales a tall photo to the cell height, so it cannot overflow', () => {
    const { w, h } = fitInCell(500, 1000, 58, 40);
    expect(h).toBeCloseTo(40, 1);
    expect(w).toBeCloseTo(20, 1);
  });

  it('keeps the aspect ratio in both cases', () => {
    const a = fitInCell(1600, 1200, 58, 40);
    expect(a.w / a.h).toBeCloseTo(1600 / 1200, 2);
  });
});
