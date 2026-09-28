'use strict';

const express = require('express');
const config = require('./config');
const storage = require('./storage');
const indexEngine = require('./indexEngine');
const collector = require('./collector');
const quality = require('./quality');
const dgcaBacktest = require('./dgcaBacktest');
const mospiReference = require('./mospiReference');
const scheduler = require('./scheduler');
const airlineAnalysis = require('./airlineAnalysis');
const heatmap = require('./heatmap');
const coverage = require('./coverage');
const indexAggregation = require('./indexAggregation');
const backtest30 = require('./backtest30');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------
router.get('/health', (req, res) => {
  const latestRun = storage.getLatestCollectionRun();
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    total_observations: storage.getObservations().length,
    last_collection_at: latestRun ? latestRun.finished_at : null,
    last_collection_status: latestRun ? latestRun.status : 'NEVER_RUN',
  });
});

// ---------------------------------------------------------------------------
// GET /api/observations?route=DEL-BOM&window=T%2B7&limit=200
// ---------------------------------------------------------------------------
router.get('/observations', (req, res) => {
  let observations = storage.getObservations();
  const { route, window, limit } = req.query;

  if (route) observations = observations.filter((o) => o.route === route);
  if (window) observations = observations.filter((o) => o.booking_window === window);

  const cap = Math.min(Number(limit) || 500, 5000);
  const sliced = observations.slice(-cap); // most recent first when reversed client-side

  res.json({ count: observations.length, returned: sliced.length, observations: sliced });
});

// ---------------------------------------------------------------------------
// GET /api/index
// ---------------------------------------------------------------------------
router.get('/index', (req, res) => {
  const latest = storage.getLatestIndexEntry();
  if (!latest) {
    return res.json({ status: 'INSUFFICIENT_DATA', message: 'No successful collection run yet. Trigger ingestion first.' });
  }
  res.json(latest);
});

// ---------------------------------------------------------------------------
// GET /api/corridors
// ---------------------------------------------------------------------------
router.get('/corridors', (req, res) => {
  const observations = storage.getObservations();

  const corridors = config.ROUTES.map((route) => {
    const routeObs = observations.filter((o) => o.route === route.route_label);
    const fares = routeObs.map((o) => o.total_fare).filter((f) => Number.isFinite(f));
    const medianFare = indexEngine.median(fares);

    const windows = config.BOOKING_WINDOWS.map((windowLabel) => {
      const windowFares = routeObs.filter((o) => o.booking_window === windowLabel).map((o) => o.total_fare);
      return {
        window: windowLabel,
        median_fare: indexEngine.median(windowFares),
        observation_count: windowFares.length,
      };
    });

    return {
      route: route.route_label,
      origin: route.origin,
      destination: route.destination,
      traffic_weight: route.traffic_weight,
      median_fare: medianFare,
      observation_count: routeObs.length,
      windows,
    };
  });

  res.json({ corridors });
});

// ---------------------------------------------------------------------------
// GET /api/lead-time?route=DEL-BOM
// ---------------------------------------------------------------------------
router.get('/lead-time', (req, res) => {
  const { route } = req.query;
  let observations = storage.getObservations();
  if (route) observations = observations.filter((o) => o.route === route);

  const windows = config.BOOKING_WINDOWS.map((windowLabel) => {
    const fares = observations.filter((o) => o.booking_window === windowLabel).map((o) => o.total_fare);
    return { window: windowLabel, median_fare: indexEngine.median(fares), observation_count: fares.length };
  });

  res.json({ route: route || 'ALL', windows });
});

// ---------------------------------------------------------------------------
// GET /api/collector/status
// ---------------------------------------------------------------------------
router.get('/collector/status', (req, res) => {
  const latest = storage.getLatestCollectionRun();
  if (!latest) {
    return res.json({ status: 'NEVER_RUN', message: 'No collection has been run yet.' });
  }
  res.json(latest);
});

// ---------------------------------------------------------------------------
// POST /api/collector/run  — the ONE ingestion path used by "Trigger Ingestion"
// ---------------------------------------------------------------------------
router.post('/collector/run', async (req, res) => {
  try {
    const run = await collector.runCollection();
    res.json(run);
  } catch (err) {
    // Defensive: collector.runCollection() already catches its own errors,
    // but the server must never crash regardless.
    res.status(500).json({ status: 'FAILED', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/provenance
// ---------------------------------------------------------------------------
router.get('/provenance', (req, res) => {
  const observations = storage.getObservations();
  const sample = observations.slice(-100).map((o) => ({
    id: o.id,
    route: o.route,
    travel_date: o.travel_date,
    booking_window: o.booking_window,
    collection_date: o.collection_date,
    source: o.source,
    collected_at: o.collected_at,
    total_fare_only: o.total_fare_only,
  }));
  res.json({ source: config.SOURCE_NAME, total_observations: observations.length, sample });
});

// ---------------------------------------------------------------------------
// GET /api/quality — data quality report (Phase 2 requirement). Read-only:
// flags issues/outliers, never deletes or mutates stored observations.
// ---------------------------------------------------------------------------
router.get('/quality', (req, res) => {
  res.json(quality.buildReport());
});

// ---------------------------------------------------------------------------
// GET /api/dgca-backtest — compares project medians against official DGCA
// figures IF a data/dgca_reference.json file has been supplied. Never
// fabricates a result when that file is absent.
// ---------------------------------------------------------------------------
router.get('/dgca-backtest', (req, res) => {
  res.json(dgcaBacktest.buildBacktest());
});

// ---------------------------------------------------------------------------
// GET /api/mospi-airfare-reference — official MoSPI airfare CPI reference
// series imported from the supplied CPI API/export workbook. This is an
// INDEX series, not a rupee fare level, so it is kept separate from the
// DGCA fare-level back-test module.
// ---------------------------------------------------------------------------
router.get('/mospi-airfare-reference', (req, res) => {
  res.json(mospiReference.buildReference());
});

// ---------------------------------------------------------------------------
// GET /api/scheduler/status — truthfully reports whether daily scheduled
// collection is enabled/started, and when it last/next runs.
// ---------------------------------------------------------------------------
router.get('/scheduler/status', (req, res) => {
  res.json(scheduler.getStatus());
});

// ---------------------------------------------------------------------------
// GET /api/index-history — full index_history.json, for historical charts.
// Returns only genuinely recorded snapshots; never interpolated.
// ---------------------------------------------------------------------------
router.get('/index-history', (req, res) => {
  const history = storage.getIndexHistory();
  res.json({ count: history.length, history });
});

// ---------------------------------------------------------------------------
// GET /api/airlines — alias for /api/airline-analysis (same data), kept for
// naming-convention flexibility per the project spec.
// GET /api/airline-analysis — descriptive per-airline statistics. Never
// ranks airlines as "best"/"worst"; small samples are flagged, not hidden.
// ---------------------------------------------------------------------------
router.get('/airlines', (req, res) => {
  res.json(airlineAnalysis.buildAirlineList());
});
router.get('/airline-analysis', (req, res) => {
  res.json(airlineAnalysis.buildAirlineList());
});

// ---------------------------------------------------------------------------
// GET /api/heatmap — route x booking-window median/mean fare matrix.
// Cells with no data are explicitly marked insufficient_data, never
// fabricated or interpolated.
// ---------------------------------------------------------------------------
router.get('/heatmap', (req, res) => {
  res.json(heatmap.buildHeatmap());
});

// ---------------------------------------------------------------------------
// GET /api/coverage — data coverage dashboard: observations by route,
// booking window, airline, route x window matrix, and the latest
// collection run's search success/failure counts.
// ---------------------------------------------------------------------------
router.get('/coverage', (req, res) => {
  res.json(coverage.buildCoverageReport());
});

// ---------------------------------------------------------------------------
// GET /api/index/daily — full recorded daily index history (alias of
// /api/index-history, kept under /api/index/* for naming consistency).
// GET /api/index/weekly — ISO-week mean of recorded daily indices.
// GET /api/index/monthly — calendar-month mean of recorded daily indices.
// None of these interpolate missing days; see methodology for each.
// ---------------------------------------------------------------------------
router.get('/index/daily', (req, res) => {
  const history = storage.getIndexHistory();
  res.json({ count: history.length, history });
});
router.get('/index/weekly', (req, res) => {
  res.json(indexAggregation.buildWeekly());
});
router.get('/index/monthly', (req, res) => {
  res.json(indexAggregation.buildMonthly());
});

// ---------------------------------------------------------------------------
// GET /api/backtest-30day — 30-day back-test framework. Reports observed
// (never reconstructed-from-nothing) daily index entries in the last 30
// days, missing-day coverage, and MAE/RMSE/MAPE against DGCA reference
// data ONLY if that reference data has been supplied. Reports
// INSUFFICIENT_DATA plainly instead of fabricating a result.
// ---------------------------------------------------------------------------
router.get('/backtest-30day', (req, res) => {
  res.json(backtest30.buildBacktest30());
});

// ---------------------------------------------------------------------------
// GET /api/methodology
// ---------------------------------------------------------------------------
router.get('/methodology', (req, res) => {
  res.json({
    source: config.SOURCE_NAME,
    routes: config.ROUTES,
    booking_windows: config.BOOKING_WINDOWS,
    fare_rule: 'Only observed TOTAL fare is used. base_fare and taxes_fees are always null (never estimated) because SerpApi does not reliably expose that split. These are "total-fare-only" observations.',
    index_methodology: [
      '1. For each of the 6 basket routes, take the median total_fare across all stored observations for that route.',
      '2. The first successful collection run establishes the base period; each route median becomes its base_median, and the national index is defined as 100.0.',
      '3. On every later run, relative_index = (current_median / base_median) * 100 for each route.',
      '4. national_index = sum(relative_index_route * traffic_weight_route), normalized by the combined weight of routes that currently have data.',
      '5. A route with no observations yet is excluded from the weighted sum and from the coverage percentage. Nothing is fabricated.',
    ],
    weekly_monthly_methodology: [
      'Weekly and monthly APIx (GET /api/index/weekly, GET /api/index/monthly) are the arithmetic MEAN of the already-computed recorded daily national_index values (from index_history.json) that fall in each period.',
      'Week = ISO-8601 week (Monday start, UTC). Month = calendar month (UTC).',
      'Missing days are never interpolated or invented — a period is built only from whatever daily entries genuinely exist, and daily_count on each period shows exactly how many that was.',
      'Any period with fewer than 3 daily entries is marked low_confidence: true.',
    ],
    airline_analysis_note: 'GET /api/airlines and /api/airline-analysis provide descriptive per-airline statistics only (median/mean fare, route and booking-window distribution). Airlines are never ranked as best/worst.',
    heatmap_note: 'GET /api/heatmap returns a route x booking-window median/mean fare matrix. Cells with no observations are marked insufficient_data: true rather than left blank or fabricated.',
    backtest_30day_note: 'GET /api/backtest-30day reports the last 30 days of genuinely recorded daily index entries plus missing-day coverage, and computes MAE/RMSE/MAPE against DGCA reference data only if data/dgca_reference.json exists. The imported MoSPI airfare reference is an index series and is intentionally not converted into rupee fare levels for this metric.',
    no_fake_data_policy: 'This project never fabricates flights, fares, historical data, availability, or collection counts. Where real data is insufficient, endpoints report INSUFFICIENT_DATA rather than inventing values.',
    official_status_disclaimer: 'This is an experimental, student-built weighted relative-price index. It is NOT an official statistic and carries no NSO/RBI/DGCA endorsement. It also does not claim national representativeness (only 6 corridors), complete airline/OTA coverage, or causal booking-window elasticity.',
    dgca_backtest_note: 'A DGCA back-test module exists at GET /api/dgca-backtest but only produces a comparison once official DGCA route-month average-fare figures are supplied. MoSPI airfare CPI reference data is available separately at GET /api/mospi-airfare-reference and is an index series, not a rupee fare series.',
  });
});

module.exports = router;
