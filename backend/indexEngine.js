'use strict';

const { ROUTES } = require('./config');
const storage = require('./storage');

/**
 * APIx National Airfare Price Index — methodology
 * ------------------------------------------------
 * This is a simple, transparent weighted relative-price index (not a
 * Laspeyres/Jevons/Dutot implementation — the original project did not
 * have one correctly implemented, so per the project's own instructions
 * we use a plain, documented weighted relative-price calculation instead).
 *
 * 1. For each of the 6 basket routes, take the median of all currently
 *    stored total_fare observations for that route (across all booking
 *    windows collected so far).
 * 2. The FIRST successful collection run establishes the base period:
 *    each route's median fare at that point becomes base_median, and the
 *    national index is defined as 100.0.
 * 3. On every later run, each route's relative index is
 *      relative_index = (current_median / base_median) * 100
 * 4. The national index is the traffic-weight-weighted sum of the route
 *    relative indices:
 *      national_index = sum(relative_index_route * traffic_weight_route)
 * 5. A route with no observations yet is excluded from the weighted sum
 *    and its weight is excluded from the coverage percentage — nothing is
 *    fabricated for missing routes.
 *
 * No historical data is ever fabricated. If there are fewer than 2
 * collection runs, only a base index (100.0) can be reported.
 */

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function currentRouteMedians() {
  const observations = storage.getObservations();
  const byRoute = new Map();
  for (const obs of observations) {
    if (!Number.isFinite(obs.total_fare) || obs.total_fare <= 0) continue;
    if (!byRoute.has(obs.route)) byRoute.set(obs.route, []);
    byRoute.get(obs.route).push(obs.total_fare);
  }
  const medians = {};
  for (const route of ROUTES) {
    const fares = byRoute.get(route.route_label) || [];
    medians[route.route_label] = { median: median(fares), observation_count: fares.length };
  }
  return medians;
}

/** Recomputes the national index from everything currently in storage and
 * appends a new entry to index_history.json. Returns the new entry. */
function recompute() {
  const currentMedians = currentRouteMedians();
  const firstEntry = storage.getFirstIndexEntry();
  const totalObservations = storage.getObservations().length;
  const now = new Date().toISOString();

  // No base period yet -> this run establishes it.
  if (!firstEntry) {
    const routesWithData = ROUTES.filter((r) => currentMedians[r.route_label].median !== null);
    const coverage = routesWithData.reduce((sum, r) => sum + r.traffic_weight, 0) * 100;

    const entry = {
      index: 100.0,
      base_period: now,
      current_period: now,
      observations: totalObservations,
      coverage: Math.round(coverage * 100) / 100,
      routes: ROUTES.map((r) => ({
        route: r.route_label,
        weight: r.traffic_weight,
        base_median: currentMedians[r.route_label].median,
        current_median: currentMedians[r.route_label].median,
        relative_index: currentMedians[r.route_label].median !== null ? 100.0 : null,
        observation_count: currentMedians[r.route_label].observation_count,
      })),
    };
    return storage.addIndexEntry(entry);
  }

  // Base period already exists — compute relative index against it.
  const baseByRoute = new Map(firstEntry.routes.map((r) => [r.route, r.base_median]));
  let weightedSum = 0;
  let coverageWeight = 0;

  const routeEntries = ROUTES.map((r) => {
    const baseMedian = baseByRoute.get(r.route_label);
    const currentMedian = currentMedians[r.route_label].median;
    let relativeIndex = null;

    if (baseMedian !== null && baseMedian !== undefined && currentMedian !== null) {
      relativeIndex = (currentMedian / baseMedian) * 100;
      weightedSum += relativeIndex * r.traffic_weight;
      coverageWeight += r.traffic_weight;
    }

    return {
      route: r.route_label,
      weight: r.traffic_weight,
      base_median: baseMedian ?? null,
      current_median: currentMedian,
      relative_index: relativeIndex !== null ? Math.round(relativeIndex * 100) / 100 : null,
      observation_count: currentMedians[r.route_label].observation_count,
    };
  });

  const nationalIndex = coverageWeight > 0 ? weightedSum / coverageWeight : null;

  const entry = {
    index: nationalIndex !== null ? Math.round(nationalIndex * 100) / 100 : null,
    base_period: firstEntry.base_period,
    current_period: now,
    observations: totalObservations,
    coverage: Math.round(coverageWeight * 100 * 100) / 100,
    routes: routeEntries,
  };
  return storage.addIndexEntry(entry);
}

module.exports = { recompute, currentRouteMedians, median };
