/**
 * Statistical analysis for ablation study.
 *
 * - Paired t-test (within-subjects: same task across conditions)
 * - Bootstrap confidence intervals
 * - Bonferroni correction for multiple comparisons
 * - Cohen's d effect size
 */

// --- Basic stats ---

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function std(arr: number[]): number {
  if (arr.length <= 1) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// --- Paired t-test ---

export interface TTestResult {
  t: number;
  p: number;
  df: number;
  d: number;       // Cohen's d effect size
  meanDiff: number;
  ci95: [number, number]; // 95% CI of the mean difference
}

/**
 * Two-tailed paired t-test.
 * Tests H0: mean(a) == mean(b) for paired observations.
 */
export function pairedTTest(a: number[], b: number[]): TTestResult {
  if (a.length !== b.length) throw new Error('Arrays must have equal length');
  const n = a.length;
  if (n < 2) return { t: 0, p: 1, df: 0, d: 0, meanDiff: 0, ci95: [0, 0] };

  const diffs = a.map((v, i) => v - b[i]);
  const meanDiff = mean(diffs);
  const sdDiff = std(diffs);
  const se = sdDiff / Math.sqrt(n);
  // If all diffs are identical (sd=0), result is deterministic:
  // meanDiff != 0 → infinitely significant; meanDiff == 0 → no difference
  if (se === 0) {
    const p = meanDiff === 0 ? 1 : 0;
    const d = meanDiff === 0 ? 0 : Infinity;
    return { t: meanDiff === 0 ? 0 : Infinity, p, df: n - 1, d, meanDiff, ci95: [meanDiff, meanDiff] };
  }
  const t = meanDiff / se;
  const df = n - 1;

  // Two-tailed p-value approximation using t-distribution
  // Using the regularized incomplete beta function approximation
  const p = tDistPValue(Math.abs(t), df);

  // Cohen's d (paired)
  const d = sdDiff === 0 ? 0 : meanDiff / sdDiff;

  // 95% CI
  const tCrit = tCriticalValue(0.025, df); // two-tailed 95%
  const ci95: [number, number] = [meanDiff - tCrit * se, meanDiff + tCrit * se];

  return { t, p, df, d, meanDiff, ci95 };
}

// --- Bootstrap CI ---

/**
 * Bootstrap 95% confidence interval for the mean.
 * Uses percentile method with 10,000 resamples.
 */
export function bootstrapCI(
  data: number[],
  alpha = 0.05,
  nResamples = 10_000,
): [number, number] {
  if (data.length === 0) return [0, 0];
  const n = data.length;
  const means: number[] = [];

  for (let i = 0; i < nResamples; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += data[Math.floor(Math.random() * n)];
    }
    means.push(sum / n);
  }

  means.sort((a, b) => a - b);
  const lo = means[Math.floor((alpha / 2) * nResamples)];
  const hi = means[Math.floor((1 - alpha / 2) * nResamples)];
  return [lo, hi];
}

// --- Multiple comparison correction ---

/**
 * Bonferroni correction: multiply p-values by number of comparisons.
 */
export function bonferroniCorrection(pValues: number[], k?: number): number[] {
  const nComparisons = k ?? pValues.length;
  return pValues.map(p => Math.min(p * nComparisons, 1.0));
}

// --- Bootstrap permutation test ---

/**
 * Permutation test for difference in means.
 * More robust than t-test for small samples and non-normal data.
 */
export function permutationTest(
  a: number[],
  b: number[],
  nPermutations = 10_000,
): { p: number; observedDiff: number } {
  const observedDiff = mean(a) - mean(b);
  const combined = [...a, ...b];
  const n = a.length;
  let extremeCount = 0;

  for (let i = 0; i < nPermutations; i++) {
    // Shuffle combined array
    for (let j = combined.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [combined[j], combined[k]] = [combined[k], combined[j]];
    }
    const permDiff = mean(combined.slice(0, n)) - mean(combined.slice(n));
    if (Math.abs(permDiff) >= Math.abs(observedDiff)) extremeCount++;
  }

  return { p: extremeCount / nPermutations, observedDiff };
}

// --- t-distribution helpers ---

/** Approximate two-tailed p-value from t-distribution. */
function tDistPValue(t: number, df: number): number {
  // Use approximation: p ≈ 2 * (1 - Φ(t * sqrt(df / (df + t²))))
  // Good for df > 4
  if (df <= 0) return 1;
  const x = t * Math.sqrt(df / (df + t * t));
  return 2 * (1 - normalCDF(x));
}

/** Approximate critical value for t-distribution. */
function tCriticalValue(alpha: number, df: number): number {
  // Approximation using inverse normal + correction for df
  const z = inverseNormalCDF(1 - alpha);
  // Cornish-Fisher expansion for small df correction
  return z + (z * z * z + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df);
}

/** Standard normal CDF approximation (Abramowitz & Stegun). */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

/** Inverse normal CDF approximation (Beasley-Springer-Moro). */
function inverseNormalCDF(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  const a = [
    -3.969683028665376e+01, 2.209460984245205e+02,
    -2.759285104469687e+02, 1.383577518672690e+02,
    -3.066479806614716e+01, 2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01, 1.615858368580409e+02,
    -1.556989798598866e+02, 6.680131188771972e+01,
    -1.328068155288572e+01,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((a[0] * q + a[1]) * q + a[2]) * q + a[3]) * q + a[4]) * q + a[5]) /
           ((((b[0] * q + b[1]) * q + b[2]) * q + b[3]) * q + b[4] * q + 1);
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((a[0] * q + a[1]) * q + a[2]) * q + a[3]) * q + a[4]) * q + a[5]) /
          ((((b[0] * q + b[1]) * q + b[2]) * q + b[3]) * q + b[4] * q + 1);
}

// --- Significance formatting ---

export function sigStars(p: number): string {
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return '';
}

export function formatCI(ci: [number, number], decimals = 2): string {
  return `[${ci[0].toFixed(decimals)}, ${ci[1].toFixed(decimals)}]`;
}
