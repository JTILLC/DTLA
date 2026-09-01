import { describe, it, expect } from 'vitest';
import { perspectiveCoeffs, project, orderCorners } from './perspective';

const near = (a, b, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('perspectiveCoeffs / project', () => {
  const rect = [[0, 0], [100, 0], [100, 75], [0, 75]];

  it('is the identity when the quad is already the rectangle', () => {
    const c = perspectiveCoeffs(rect, rect);
    for (const [x, y] of [[0, 0], [50, 40], [100, 75]]) {
      const [px, py] = project(c, x, y);
      near(px, x); near(py, y);
    }
  });

  it('maps each output corner onto the photo corner it came from', () => {
    // The property the whole crop rests on. If this is out, every value on the
    // page sits slightly wrong.
    const quad = [[10, 20], [190, 5], [205, 160], [25, 150]];
    const c = perspectiveCoeffs(rect, quad);
    rect.forEach(([x, y], i) => {
      const [px, py] = project(c, x, y);
      near(px, quad[i][0], 1e-6);
      near(py, quad[i][1], 1e-6);
    });
  });

  it('handles real converging edges, not just a skew', () => {
    // A photo taken from below: the top edge is shorter than the bottom. An
    // affine transform cannot represent this at all.
    const quad = [[40, 10], [160, 10], [200, 150], [0, 150]];
    const c = perspectiveCoeffs(rect, quad);
    const [mx, my] = project(c, 50, 37.5);
    // The centre of the output must land inside the quad, and NOT at the
    // average of the corners — that is what makes it projective.
    expect(mx).toBeGreaterThan(0);
    expect(mx).toBeLessThan(200);
    expect(my).toBeGreaterThan(10);
    expect(my).toBeLessThan(150);
    expect(Math.abs(my - 80)).toBeGreaterThan(1);
  });

  it('refuses degenerate corners rather than returning nonsense', () => {
    expect(() => perspectiveCoeffs(rect, [[0, 0], [0, 0], [0, 0], [0, 0]]))
      .toThrowError(/degenerate/);
  });
});

describe('orderCorners', () => {
  it('puts corners clockwise from the top-left whatever order they arrive in', () => {
    const tl = [10, 20]; const tr = [190, 5]; const br = [205, 160]; const bl = [25, 150];
    for (const order of [[tl, tr, br, bl], [br, bl, tl, tr], [bl, br, tr, tl]]) {
      expect(orderCorners(order)).toEqual([tl, tr, br, bl]);
    }
  });
});
