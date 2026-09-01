// Straightening a photographed RCU screen.
//
// A centerline goes to a customer, so a snapshot taken at arm's length over a
// machine has to come out looking like a screen capture. Given the four corners
// of the screen in the photo, this maps them onto a rectangle.
//
// Canvas 2D has no projective transform — setTransform is affine, which can
// skew a rectangle into a parallelogram but cannot converge two edges, so it
// cannot undo perspective. Splitting into triangles only approximates it, and
// the error shows up exactly where it matters: as curvature along the rows of
// values. So the homography is solved outright and applied per pixel.
//
// This is a port of tools/screen_crop.py. The Python one is for working against
// a folder of photos; this runs when an engineer drops one into the app.

/** Solve `A x = b` by Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error('corners are degenerate');
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c += 1) M[r][c] -= f * M[col][c];
    }
  }
  // Gauss-Jordan leaves a diagonal system: x[i] = rhs[i] / pivot[i].
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * The eight coefficients mapping an OUTPUT pixel back to a point in the photo.
 *
 * Deliberately the inverse direction: for every output pixel we need to know
 * where to sample, and going forwards would leave holes wherever the source is
 * stretched. `dest` is the output rectangle, `src` the quad in the photo.
 */
export function perspectiveCoeffs(dest, src) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i += 1) {
    const [dx, dy] = dest[i];
    const [sx, sy] = src[i];
    A.push([dx, dy, 1, 0, 0, 0, -dx * sx, -dy * sx]);
    b.push(sx);
    A.push([0, 0, 0, dx, dy, 1, -dx * sy, -dy * sy]);
    b.push(sy);
  }
  return solve(A, b);
}

/** Where an output pixel samples from in the photo. */
export const project = (coeffs, x, y) => {
  const [a, bb, c, d, e, f, g, h] = coeffs;
  const w = g * x + h * y + 1;
  return [(a * x + bb * y + c) / w, (d * x + e * y + f) / w];
};

/** Clockwise from the top-left, however the corners were clicked. */
export function orderCorners(points) {
  const sum = (p) => p[0] + p[1];
  const diff = (p) => p[1] - p[0];
  const by = (fn, cmp) => points.reduce((best, p) => (cmp(fn(p), fn(best)) ? p : best));
  return [
    by(sum, (a, b) => a < b),    // top-left:     smallest x+y
    by(diff, (a, b) => a < b),   // top-right:    smallest y-x
    by(sum, (a, b) => a > b),    // bottom-right: largest x+y
    by(diff, (a, b) => a > b),   // bottom-left:  largest y-x
  ];
}

export const SCREEN_W = 1024;
export const SCREEN_H = 768;   // the RCU is 4:3

/**
 * Warp the quad `corners` out of `source` into a straight-on canvas.
 *
 * Bilinear sampling, because nearest-neighbour turns the RCU's thin label text
 * into something an operator has to squint at, and the whole point is that the
 * page can be read against the live screen.
 */
export function straighten(source, corners, width = SCREEN_W, height = SCREEN_H) {
  const ordered = orderCorners(corners);
  const coeffs = perspectiveCoeffs(
    [[0, 0], [width, 0], [width, height], [0, height]],
    ordered,
  );

  const src = document.createElement('canvas');
  src.width = source.width;
  src.height = source.height;
  src.getContext('2d').drawImage(source, 0, 0);
  const sd = src.getContext('2d').getImageData(0, 0, source.width, source.height);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const od = out.getContext('2d').createImageData(width, height);

  const { data: S } = sd;
  const { data: O } = od;
  const sw = sd.width;
  const sh = sd.height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [fx, fy] = project(coeffs, x + 0.5, y + 0.5);
      const o = (y * width + x) * 4;
      if (fx < 0 || fy < 0 || fx >= sw - 1 || fy >= sh - 1) {
        O[o + 3] = 255;
        continue;
      }
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      for (let c = 0; c < 3; c += 1) {
        O[o + c] =
          S[i00 + c] * (1 - tx) * (1 - ty) +
          S[i10 + c] * tx * (1 - ty) +
          S[i01 + c] * (1 - tx) * ty +
          S[i11 + c] * tx * ty;
      }
      O[o + 3] = 255;
    }
  }
  out.getContext('2d').putImageData(od, 0, 0);
  return out;
}

/**
 * A starting guess at the screen: the brightest large region of the photo.
 *
 * Deliberately crude, and never trusted on its own — it exists to save the
 * engineer most of the dragging. A reflection on the bezel or a lit machine
 * behind the unit pulls a corner, and a corner out by a few percent skews
 * every value on the page, so the app always shows the handles.
 */
export function guessCorners(source, work = 160) {
  const scale = work / source.width;
  const h = Math.max(1, Math.round(source.height * scale));
  const c = document.createElement('canvas');
  c.width = work;
  c.height = h;
  c.getContext('2d').drawImage(source, 0, 0, work, h);
  const { data } = c.getContext('2d').getImageData(0, 0, work, h);

  const lum = new Float32Array(work * h);
  for (let i = 0; i < lum.length; i += 1) {
    lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  const sorted = Float32Array.from(lum).sort();
  const cut = sorted[Math.floor(sorted.length * 0.82)];

  const seen = new Uint8Array(lum.length);
  let best = null;
  for (let start = 0; start < lum.length; start += 1) {
    if (lum[start] <= cut || seen[start]) continue;
    const stack = [start];
    const blob = [];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop();
      blob.push(p);
      const x = p % work;
      const y = (p / work) | 0;
      const push = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= work || ny >= h) return;
        const n = ny * work + nx;
        if (seen[n] || lum[n] <= cut) return;
        seen[n] = 1;
        stack.push(n);
      };
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }
    if (!best || blob.length > best.length) best = blob;
  }
  if (!best) return null;

  const pts = best.map((p) => [(p % work) / scale, ((p / work) | 0) / scale]);
  return orderCorners(pts);
}
