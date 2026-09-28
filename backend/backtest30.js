'use strict';

const storage = require('./storage');
const stats = require('./stats');
const dgcaBacktest = require('./dgcaBacktest');

/**
 * APIx 30-day back-test framework.
 * ---------------------------------------------------------------
 * Reconstructs the last 30 days of OBSERVED daily national_index values
 * from index_history.json (never fabricated), reports which days in that
 * window actually have a recorded entry, and — only if a genuine DGCA
 * reference file has been supplied (see dgcaBacktest.js) — computes
 * MAE / RMSE / MAPE between this project's route medians for months that
 * overlap the window and the corresponding DGCA reference figures.
 *
 * If there are zero recorded daily entries in the last 30 days, the
 * back-test is reported as unavailable rather than inventing a result.
 */

const WINDOW_DAYS = 30;

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function buildBacktest30() {
  const history = storage.getIndexHistory();
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 86400000);

  const inWindow = history.filter((e) => {
    const d = new Date(e.current_period);
    return !Number.isNaN(d.getTime()) && d >= windowStart && d <= now;
  });

  if (inWindow.length === 0) {
    return {
      status: 'INSUFFICIENT_DATA',
      message: '30-day back-test unavailable: insufficient historical data. No daily index snapshots have been recorded in the last 30 days.',
      window_days: WINDOW_DAYS,
      observed_daily_entries: 0,
    };
  }

  // Which calendar days in the window actually have a recorded entry.
  const recordedDayKeys = new Set(inWindow.map((e) => new Date(e.current_period).toISOString().slice(0, 10)));
  const missingDays = [];
  for (let i = 0; i <= WINDOW_DAYS; i += 1) {
    const day = new Date(windowStart.getTime() + i * 86400000);
    const key = day.toISOString().slice(0, 10);
    if (!recordedDayKeys.has(key)) missingDays.push(key);
  }

  const observedSeries = inWindow
    .slice()
    .sort((a, b) => new Date(a.current_period) - new Date(b.current_period))
    .map((e) => ({ date: e.current_period, national_index: e.index, coverage: e.coverage, observations: e.observations }));

  const coveragePct = Math.round((recordedDayKeys.size / (WINDOW_DAYS + 1)) * 10000) / 100;

  // Reference comparison, only when real DGCA data exists (never fabricated).
  const referenceComparison = dgcaBacktest.buildBacktest();
  let comparisonMetrics = null;

  if (referenceComparison.status === 'PARTIAL') {
    const pairs = referenceComparison.results.filter((r) => r.comparable);
    if (pairs.length > 0) {
      const errors = pairs.map((p) => p.project_median_fare_inr - p.dgca_average_fare_inr);
      const absErrors = errors.map(Math.abs);
      const sqErrors = errors.map((e) => e * e);
      const pctErrors = pairs
        .filter((p) => p.dgca_average_fare_inr)
        .map((p) => Math.abs((p.project_median_fare_inr - p.dgca_average_fare_inr) / p.dgca_average_fare_inr));

      comparisonMetrics = {
        paired_points: pairs.length,
        mae_inr: stats.round2(stats.mean(absErrors)),
        rmse_inr: stats.round2(Math.sqrt(stats.mean(sqErrors))),
        mape_pct: pctErrors.length ? stats.round2(stats.mean(pctErrors) * 100) : null,
        caveat: referenceComparison.comparability_caveat,
      };
    }
  }

  return {
    status: 'AVAILABLE',
    window_days: WINDOW_DAYS,
    window_start: windowStart.toISOString(),
    window_end: now.toISOString(),
    observed_daily_entries: inWindow.length,
    calendar_days_with_data: recordedDayKeys.size,
    calendar_days_missing: missingDays.length,
    coverage_pct: coveragePct,
    missing_days: missingDays,
    observed_series: observedSeries,
    reference_comparison:
      comparisonMetrics
        ? { status: 'COMPARED', ...comparisonMetrics }
        : { status: referenceComparison.status === 'NOT_CONFIGURED' ? 'DGCA_NOT_CONFIGURED' : 'NO_OVERLAPPING_REFERENCE', message: referenceComparison.message },
    note: 'observed_series values are genuinely recorded daily national_index entries, never reconstructed or interpolated. Metrics are only computed where a real DGCA reference value overlaps.',
  };
}

module.exports = { buildBacktest30, WINDOW_DAYS };
