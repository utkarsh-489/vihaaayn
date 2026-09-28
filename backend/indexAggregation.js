'use strict';

const storage = require('./storage');
const stats = require('./stats');

/**
 * APIx weekly / monthly index aggregation.
 * ---------------------------------------------------------------
 * Methodology (documented here and surfaced via /api/methodology):
 *
 *  - The underlying unit of truth is the DAILY index_history.json — one
 *    entry per completed collection run that produced/refreshed the
 *    national index. Nothing here re-derives fares; it only aggregates
 *    already-computed daily national_index values.
 *  - Week definition: ISO-8601 week (Monday start), keyed as "YYYY-Www"
 *    in UTC, computed from each entry's current_period timestamp.
 *  - Month definition: calendar month in UTC, keyed as "YYYY-MM".
 *  - Aggregation method: the arithmetic MEAN of the daily national_index
 *    values recorded within that week/month. This is a plain average of
 *    whatever real daily snapshots exist — NOT a re-weighted recompute
 *    against route data, and not an interpolation.
 *  - Missing-day behavior: a week/month is built ONLY from days that
 *    actually have a recorded index entry. Missing days are neither
 *    invented nor treated as "index unchanged" — they are simply absent,
 *    and daily_count / expected_days_in_period make that visible.
 *  - Minimum coverage: a week/month is still reported even with just one
 *    daily entry, but daily_count is always shown so a one-day "weekly"
 *    figure is never mistaken for a full week's average. Callers should
 *    treat any period with daily_count < 3 as low-confidence.
 */

function isoWeekKey(date) {
  // ISO week: Thursday of the week determines the week-year.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function aggregateBy(entries, keyFn) {
  const groups = new Map();
  for (const entry of entries) {
    if (entry.index === null || entry.index === undefined) continue;
    const date = new Date(entry.current_period);
    if (Number.isNaN(date.getTime())) continue;
    const key = keyFn(date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const periods = [];
  for (const [key, groupEntries] of groups) {
    const indexValues = groupEntries.map((e) => e.index);
    periods.push({
      period: key,
      index_avg: stats.round2(stats.mean(indexValues)),
      index_min: Math.min(...indexValues),
      index_max: Math.max(...indexValues),
      daily_count: groupEntries.length,
      low_confidence: groupEntries.length < 3,
      first_recorded_at: groupEntries[0].current_period,
      last_recorded_at: groupEntries[groupEntries.length - 1].current_period,
    });
  }
  periods.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  return periods;
}

function buildWeekly() {
  const history = storage.getIndexHistory();
  const periods = aggregateBy(history, isoWeekKey);
  return {
    methodology: 'Arithmetic mean of recorded daily national_index values within each ISO-8601 (Mon-start, UTC) week. No interpolation of missing days.',
    period_type: 'iso_week',
    period_count: periods.length,
    periods,
  };
}

function buildMonthly() {
  const history = storage.getIndexHistory();
  const periods = aggregateBy(history, monthKey);
  return {
    methodology: 'Arithmetic mean of recorded daily national_index values within each UTC calendar month. No interpolation of missing days.',
    period_type: 'calendar_month',
    period_count: periods.length,
    periods,
  };
}

module.exports = { buildWeekly, buildMonthly, isoWeekKey, monthKey };
