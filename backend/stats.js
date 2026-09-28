'use strict';

/**
 * APIx price statistics module.
 * ---------------------------------------------------------------
 * Pure, reusable functions over arrays of observations. This module does
 * NOT replace the median-based index methodology in indexEngine.js — it
 * provides additional descriptive statistics (mean, percentiles, group
 * breakdowns) consumed by the analytical endpoints (airlines, heatmap,
 * coverage, etc).
 *
 * Every summary returned here includes an explicit observation_count so
 * callers/UI can decide whether a statistic is backed by enough data to
 * be meaningful. Nothing here hides or discards a small sample — it is
 * reported plainly with its count attached.
 */

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function round2(n) {
  return n === null || n === undefined ? null : Math.round(n * 100) / 100;
}

/** Minimum sample size below which a statistic is flagged as low-confidence.
 * The number itself is still reported — this only adds a transparency flag. */
const LOW_SAMPLE_THRESHOLD = 5;

/**
 * Builds a full descriptive summary for a set of fares. Returns nulls
 * (never zeros or fabricated values) when there is no data.
 */
function summarizeFares(fares) {
  const valid = fares.filter((f) => Number.isFinite(f) && f > 0);
  return {
    observation_count: valid.length,
    low_sample: valid.length > 0 && valid.length < LOW_SAMPLE_THRESHOLD,
    mean_fare: round2(mean(valid)),
    median_fare: round2(median(valid)),
    p25_fare: round2(percentile(valid, 0.25)),
    p75_fare: round2(percentile(valid, 0.75)),
    min_fare: valid.length ? Math.min(...valid) : null,
    max_fare: valid.length ? Math.max(...valid) : null,
  };
}

/** Groups observations by a key function and summarizes fares per group. */
function groupSummary(observations, keyFn) {
  const groups = new Map();
  for (const obs of observations) {
    const key = keyFn(obs);
    if (key === null || key === undefined) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(obs);
  }
  const result = [];
  for (const [key, groupObs] of groups) {
    const fares = groupObs.map((o) => o.total_fare);
    result.push({ key, observation_count: groupObs.length, ...summarizeFares(fares) });
  }
  return result;
}

module.exports = {
  median,
  mean,
  percentile,
  round2,
  summarizeFares,
  groupSummary,
  LOW_SAMPLE_THRESHOLD,
};
