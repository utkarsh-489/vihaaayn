'use strict';

const { ROUTES, BOOKING_WINDOWS } = require('./config');
const storage = require('./storage');

/**
 * APIx data quality report.
 * ---------------------------------------------------------------
 * This module NEVER deletes or mutates observations. It only reports
 * on what is already stored, so a bad record is flagged and visible
 * rather than silently dropped. Deletion/cleaning of raw storage is
 * out of scope for the MVP — invalid records are already excluded
 * from collector.js's `isValid()` gate before they can be stored, so
 * anything flagged here is either (a) a defect that slipped past that
 * gate, e.g. from data that was hand-edited or migrated from an older
 * schema, or (b) a soft "worth a second look" signal such as a
 * statistical outlier — outliers are FLAGGED, never removed, per the
 * project's outlier policy documented below.
 *
 * Outlier policy (documented, not hidden): a fare is flagged as a
 * possible outlier if it falls outside [Q1 - 3*IQR, Q3 + 3*IQR] for its
 * own route+window group (a wide 3xIQR fence, deliberately conservative
 * so normal fare variation is not flagged). This project does NOT infer
 * cancellations, sold-out status, or "bad data" from a fare alone —
 * there is no signal in a total_fare-only record that supports that
 * inference, so outliers are reported as "unusually high/low", nothing
 * stronger.
 */

const VALID_ROUTES = new Set(ROUTES.map((r) => r.route_label));
const VALID_WINDOWS = new Set(BOOKING_WINDOWS);

function isValidDateString(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function quartiles(sortedValues) {
  if (sortedValues.length === 0) return { q1: null, q3: null, iqr: null };
  const percentile = (p) => {
    const idx = (sortedValues.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sortedValues[lo];
    return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
  };
  const q1 = percentile(0.25);
  const q3 = percentile(0.75);
  return { q1, q3, iqr: q3 - q1 };
}

/**
 * Builds a full data-quality report over everything currently in
 * storage. Read-only: does not modify observations.json.
 */
function buildReport() {
  const observations = storage.getObservations();

  const issues = {
    missing_fields: [],
    invalid_fare: [],
    invalid_date: [],
    unsupported_currency: [],
    unknown_route: [],
    unknown_window: [],
    duplicate_id: [],
  };

  const seenIds = new Set();
  const REQUIRED_FIELDS = ['id', 'route', 'origin', 'destination', 'booking_window', 'travel_date', 'collection_date', 'total_fare', 'source', 'collected_at'];

  for (const obs of observations) {
    const missing = REQUIRED_FIELDS.filter((f) => obs[f] === undefined || obs[f] === null || obs[f] === '');
    if (missing.length) issues.missing_fields.push({ id: obs.id || null, missing });

    if (!Number.isFinite(obs.total_fare) || obs.total_fare <= 0) {
      issues.invalid_fare.push({ id: obs.id || null, total_fare: obs.total_fare ?? null });
    }
    if (!isValidDateString(obs.travel_date)) {
      issues.invalid_date.push({ id: obs.id || null, field: 'travel_date', value: obs.travel_date ?? null });
    }
    if (!isValidDateString(obs.collection_date)) {
      issues.invalid_date.push({ id: obs.id || null, field: 'collection_date', value: obs.collection_date ?? null });
    }
    if (obs.currency && obs.currency !== 'INR') {
      issues.unsupported_currency.push({ id: obs.id || null, currency: obs.currency });
    }
    if (obs.route && !VALID_ROUTES.has(obs.route)) {
      issues.unknown_route.push({ id: obs.id || null, route: obs.route });
    }
    if (obs.booking_window && !VALID_WINDOWS.has(obs.booking_window)) {
      issues.unknown_window.push({ id: obs.id || null, booking_window: obs.booking_window });
    }
    if (obs.id) {
      if (seenIds.has(obs.id)) issues.duplicate_id.push({ id: obs.id });
      seenIds.add(obs.id);
    }
  }

  // -------------------------------------------------------------
  // Outlier flags, computed per route+window group. Reported only —
  // never removed from storage.
  // -------------------------------------------------------------
  const groups = new Map();
  for (const obs of observations) {
    if (!Number.isFinite(obs.total_fare) || obs.total_fare <= 0) continue;
    const key = `${obs.route}::${obs.booking_window}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(obs);
  }

  const outliers = [];
  for (const [key, groupObs] of groups) {
    if (groupObs.length < 4) continue; // too few points for a meaningful IQR fence
    const fares = groupObs.map((o) => o.total_fare).sort((a, b) => a - b);
    const { q1, q3, iqr } = quartiles(fares);
    if (iqr === null || iqr === 0) continue;
    const lowFence = q1 - 3 * iqr;
    const highFence = q3 + 3 * iqr;
    for (const obs of groupObs) {
      if (obs.total_fare < lowFence || obs.total_fare > highFence) {
        outliers.push({
          id: obs.id,
          route: obs.route,
          booking_window: obs.booking_window,
          total_fare: obs.total_fare,
          fence: { low: Math.round(lowFence * 100) / 100, high: Math.round(highFence * 100) / 100 },
          direction: obs.total_fare < lowFence ? 'unusually_low' : 'unusually_high',
        });
      }
    }
  }

  // -------------------------------------------------------------
  // Route/window coverage: which of the 30 combinations have data,
  // and how much.
  // -------------------------------------------------------------
  const coverage = [];
  for (const route of ROUTES) {
    for (const windowLabel of BOOKING_WINDOWS) {
      const count = observations.filter((o) => o.route === route.route_label && o.booking_window === windowLabel).length;
      coverage.push({ route: route.route_label, booking_window: windowLabel, observation_count: count, has_data: count > 0 });
    }
  }
  const combinationsWithData = coverage.filter((c) => c.has_data).length;

  const totalIssueCount = Object.values(issues).reduce((sum, arr) => sum + arr.length, 0);

  return {
    generated_at: new Date().toISOString(),
    total_observations: observations.length,
    total_issue_count: totalIssueCount,
    issues,
    outliers: {
      policy: 'Fences are Q1 - 3*IQR / Q3 + 3*IQR computed per route+window group (min 4 observations). Flag only, never deleted. No cancellation/sold-out status is inferred.',
      flagged_count: outliers.length,
      flagged: outliers,
    },
    coverage: {
      expected_combinations: ROUTES.length * BOOKING_WINDOWS.length,
      combinations_with_data: combinationsWithData,
      coverage_pct: Math.round((combinationsWithData / (ROUTES.length * BOOKING_WINDOWS.length)) * 10000) / 100,
      detail: coverage,
    },
  };
}

module.exports = { buildReport, quartiles };
