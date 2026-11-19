// Stats helpers for the gateway benchmark. Pure functions, no dependencies.

/**
 * Percentile with linear interpolation between closest ranks (numpy "linear").
 * @param {number[]} values  unsorted samples
 * @param {number} p         0..100
 * @returns {number} NaN for an empty sample
 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return percentileSorted(sorted, p);
}

export function percentileSorted(sorted, p) {
  if (sorted.length === 0) return NaN;
  const clamped = Math.min(100, Math.max(0, p));
  const rank = (clamped / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** Summary of one metric: count, min, mean, p50, p90, p99, max. Non-finite samples are dropped. */
export function summarize(values) {
  const clean = (values || []).filter((v) => Number.isFinite(v));
  if (clean.length === 0) {
    return { count: 0, min: NaN, mean: NaN, p50: NaN, p90: NaN, p99: NaN, max: NaN };
  }
  const sorted = [...clean].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    mean: sum / sorted.length,
    p50: percentileSorted(sorted, 50),
    p90: percentileSorted(sorted, 90),
    p99: percentileSorted(sorted, 99),
    max: sorted[sorted.length - 1],
  };
}

/** Least-squares slope of y over x (units of y per unit of x); NaN with <2 points. */
export function slope(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const d = n * sxx - sx * sx;
  return d === 0 ? NaN : (n * sxy - sx * sy) / d;
}

export function fmt(n, digits = 1) {
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}
