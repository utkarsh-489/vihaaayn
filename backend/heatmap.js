'use strict';

const { ROUTES, BOOKING_WINDOWS } = require('./config');
const storage = require('./storage');
const stats = require('./stats');

/**
 * APIx heatmap module.
 * ---------------------------------------------------------------
 * Rows = the 6 basket routes, columns = the 5 booking windows. Each cell
 * carries median fare, mean fare, and observation count. A cell with no
 * observations is marked insufficient_data: true — its fare fields are
 * null, never fabricated or interpolated from neighboring cells.
 */

const MIN_CELL_OBSERVATIONS = 1;

function buildHeatmap() {
  const observations = storage.getObservations();

  const rows = ROUTES.map((route) => {
    const routeObs = observations.filter((o) => o.route === route.route_label);

    const cells = BOOKING_WINDOWS.map((windowLabel) => {
      const cellObs = routeObs.filter((o) => o.booking_window === windowLabel);
      const fares = cellObs.map((o) => o.total_fare);
      const summary = stats.summarizeFares(fares);
      return {
        booking_window: windowLabel,
        observation_count: summary.observation_count,
        median_fare: summary.median_fare,
        mean_fare: summary.mean_fare,
        insufficient_data: summary.observation_count < MIN_CELL_OBSERVATIONS,
      };
    });

    return {
      route: route.route_label,
      origin: route.origin,
      destination: route.destination,
      traffic_weight: route.traffic_weight,
      cells,
    };
  });

  const totalCells = ROUTES.length * BOOKING_WINDOWS.length;
  const filledCells = rows.reduce((sum, r) => sum + r.cells.filter((c) => !c.insufficient_data).length, 0);

  return {
    generated_at: new Date().toISOString(),
    routes: ROUTES.map((r) => r.route_label),
    booking_windows: BOOKING_WINDOWS,
    coverage: { total_cells: totalCells, filled_cells: filledCells, coverage_pct: Math.round((filledCells / totalCells) * 10000) / 100 },
    rows,
  };
}

module.exports = { buildHeatmap };
