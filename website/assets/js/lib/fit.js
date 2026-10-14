// Least-squares polynomial fit (normal equations + Gaussian elimination). Enough for the
// straight line and the parabola the flight analysis needs.

/** Coefficients [c0, c1, ..., cd] of the degree-d polynomial that best fits (xs, ys). */
export function polyfit(xs, ys, degree) {
  const n = degree + 1;
  const A = Array.from({ length: n }, () => new Array(n).fill(0)), b = new Array(n).fill(0);
  xs.forEach((x, k) => {
    const powers = Array.from({ length: n }, (_, i) => x ** i);
    for (let i = 0; i < n; i++) {
      b[i] += powers[i] * ys[k];
      for (let j = 0; j < n; j++) A[i][j] += powers[i] * powers[j];
    }
  });
  for (let i = 0; i < n; i++) {                                // eliminate, with partial pivoting
    let pivot = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r;
    [A[i], A[pivot]] = [A[pivot], A[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const coef = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let c = i + 1; c < n; c++) sum -= A[i][c] * coef[c];
    coef[i] = sum / A[i][i];
  }
  return coef;
}

/** Evaluate a polynomial with coefficients [c0, c1, ...] at x. */
export const polyval = (coef, x) => coef.reduce((sum, c, i) => sum + c * x ** i, 0);

/**
 * The projectile fit: height y(t) = y0 + vy·t − ½g·t² (g left free, as a check) and forward
 * position x(t) = x0 + vx·t, from tracked points [{ t, x, y }].
 */
export function fitFlight(points, gStandard = 9.81) {
  const ts = points.map((p) => p.t);
  const [y0, vy, c2] = polyfit(ts, points.map((p) => p.y), 2);
  const [x0, vx] = polyfit(ts, points.map((p) => p.x), 1);
  const g = -2 * c2;
  const rms = Math.sqrt(points.reduce((s, p) => s + (p.y - (y0 + vy * p.t + c2 * p.t * p.t)) ** 2, 0) / points.length);
  return {
    y0, vy, g, x0, vx, rms,
    speed: Math.hypot(vx, vy),
    angle: (Math.atan2(vy, vx) * 180) / Math.PI,
    peak: (vy * vy) / (2 * gStandard),
    height: (t) => y0 + vy * t + c2 * t * t,
  };
}
