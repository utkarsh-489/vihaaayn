'use strict';

const { ROUTES, BOOKING_WINDOWS, SOURCE_NAME } = require('./config');
const storage = require('./storage');
const stats = require('./stats');
const quality = require('./quality');

/**
 * APIx data coverage module.
 * ---------------------------------------------------------------
 * Aggregates what has actually been collected: observation counts by
 * route, by booking window, by airline, route x window coverage, and the
 * latest collection run's search success/failure counts. Everything here
 * is derived from data already in storage — nothing is estimated.
 */

function buildCoverageReport() {
  const observations = storage.getObservations();
  const runs = storage.getCollectionRuns();
  const latestRun = runs.length ? runs[runs.length - 1] : null;
  const qualityReport = quality.buildReport();

  const byRoute = ROUTES.map((route) => {
    const routeObs = observations.filter((o) => o.route === route.route_label);
    return { route: route.route_label, traffic_weight: route.traffic_weight, observation_count: routeObs.length };
  });

  const byWindow = BOOKING_WINDOWS.map((windowLabel) => {
    const windowObs = observations.filter((o) => o.booking_window === windowLabel);
    return { booking_window: windowLabel, observation_count: windowObs.length };
  });

  const withAirline = observations.map((o) => o.airline || 'Unknown');
  const airlineCounts = new Map();
  for (const a of withAirline) airlineCounts.set(a, (airlineCounts.get(a) || 0) + 1);
  const byAirline = [...airlineCounts.entries()]
    .map(([airline, observation_count]) => ({ airline, observation_count }))
    .sort((a, b) => b.observation_count - a.observation_count);

  return {
    generated_at: new Date().toISOString(),
    source: SOURCE_NAME,
    total_observations: observations.length,
    total_collection_runs: runs.length,
    by_route: byRoute,
    by_booking_window: byWindow,
    by_airline: byAirline,
    route_window_matrix: qualityReport.coverage.detail,
    route_window_coverage_pct: qualityReport.coverage.coverage_pct,
    latest_collection_run: latestRun
      ? {
          run_id: latestRun.run_id,
          status: latestRun.status,
          run_type: latestRun.run_type,
          finished_at: latestRun.finished_at,
          searches: latestRun.searches,
          successful_searches: latestRun.successful_searches,
          failed_searches: latestRun.failed_searches,
          observations_added: latestRun.observations_added,
          observations_duplicate: latestRun.observations_duplicate,
        }
      : null,
    quality_summary: {
      total_issue_count: qualityReport.total_issue_count,
      outliers_flagged: qualityReport.outliers.flagged_count,
    },
  };
}

module.exports = { buildCoverageReport };
