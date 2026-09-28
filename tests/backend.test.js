'use strict';

/**
 * APIx backend test suite.
 * ---------------------------------------------------------------
 * Uses Node's built-in test runner (node:test) and assert — no new
 * npm dependencies are introduced just to run tests.
 *
 * Run with:  npm test
 * (equivalent to: node --test tests/)
 *
 * CRITICAL: these tests point storage at a throwaway temp directory
 * via APIX_DATA_DIR, set BEFORE any backend module is required below.
 * This guarantees the test suite can never read, modify, or delete
 * the user's real data/observations.json.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apix-test-'));
process.env.APIX_DATA_DIR = tmpDir;

const config = require('../backend/config');
const storage = require('../backend/storage');
const indexEngine = require('../backend/indexEngine');
const quality = require('../backend/quality');
const collector = require('../backend/collector');

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Basket / config
// ---------------------------------------------------------------------------
test('route weights sum to exactly 100%', () => {
  const total = config.ROUTES.reduce((sum, r) => sum + r.traffic_weight, 0);
  assert.ok(Math.abs(total - 1.0) < 1e-9, `weights summed to ${total}, expected 1.0`);
});

test('basket has exactly 6 routes and 5 booking windows (30 combinations)', () => {
  assert.equal(config.ROUTES.length, 6);
  assert.equal(config.BOOKING_WINDOWS.length, 5);
  assert.equal(config.ROUTES.length * config.BOOKING_WINDOWS.length, 30);
});

// ---------------------------------------------------------------------------
// Storage: dedupe + atomic writes
// ---------------------------------------------------------------------------
test('storage: addObservations dedupes exact repeats but keeps distinct ones', () => {
  storage.ensureStorage();
  const base = {
    route: 'DEL-BOM',
    travel_date: '2026-10-05',
    booking_window: 'T+7',
    airline: 'Air India',
    flight_numbers: ['AI101'],
    departure: '10:00',
    arrival: '12:00',
    total_fare: 5000,
  };
  const r1 = storage.addObservations([base]);
  assert.equal(r1.added, 1);
  assert.equal(r1.duplicates, 0);

  // Exact repeat -> should be deduped, not double-counted.
  const r2 = storage.addObservations([base]);
  assert.equal(r2.added, 0);
  assert.equal(r2.duplicates, 1);

  // Same route/window but a different fare (e.g. collected at a later time)
  // is a genuinely distinct observation and must NOT be erased.
  const r3 = storage.addObservations([{ ...base, total_fare: 5300 }]);
  assert.equal(r3.added, 1, 'a distinct fare for the same route/window must be kept, not deduped away');

  assert.equal(storage.getObservations().length, 2);
});

test('storage: writeJSON pattern leaves no partial file if interrupted (atomic rename)', () => {
  // We can't easily simulate a mid-write crash, but we can assert the
  // temp-file-then-rename pattern is actually in use by checking the file
  // exists and is valid JSON immediately after a write, and no .tmp file
  // is left behind.
  storage.ensureStorage();
  storage.addObservations([]);
  const tmpFile = `${storage.OBSERVATIONS_FILE}.tmp`;
  assert.equal(fs.existsSync(tmpFile), false, 'no leftover .tmp file after a successful write');
  const parsed = JSON.parse(fs.readFileSync(storage.OBSERVATIONS_FILE, 'utf8'));
  assert.ok(Array.isArray(parsed));
});

// ---------------------------------------------------------------------------
// Index engine — hand-calculable known datasets
// ---------------------------------------------------------------------------
test('index engine: first run with all routes present establishes base index 100', () => {
  process.env.APIX_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'apix-test-idx1-'));
  delete require.cache[require.resolve('../backend/config')];
  delete require.cache[require.resolve('../backend/storage')];
  delete require.cache[require.resolve('../backend/indexEngine')];
  const freshConfig = require('../backend/config');
  const freshStorage = require('../backend/storage');
  const freshEngine = require('../backend/indexEngine');

  freshStorage.ensureStorage();
  const fixedFare = 5000;
  const obs = freshConfig.ROUTES.map((r) => ({
    route: r.route_label,
    travel_date: '2026-10-05',
    booking_window: 'T+7',
    total_fare: fixedFare,
  }));
  freshStorage.addObservations(obs);

  const entry = freshEngine.recompute();
  assert.equal(entry.index, 100.0);
  assert.equal(entry.coverage, 100);
  for (const r of entry.routes) {
    assert.equal(r.relative_index, 100.0);
    assert.equal(r.base_median, fixedFare);
  }
});

test('index engine: a single route price change moves the national index by exactly its weight', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apix-test-idx2-'));
  process.env.APIX_DATA_DIR = dir;
  delete require.cache[require.resolve('../backend/config')];
  delete require.cache[require.resolve('../backend/storage')];
  delete require.cache[require.resolve('../backend/indexEngine')];
  const freshConfig = require('../backend/config');
  const freshStorage = require('../backend/storage');
  const freshEngine = require('../backend/indexEngine');

  freshStorage.ensureStorage();
  // Base period: every route at fare 1000.
  freshStorage.addObservations(freshConfig.ROUTES.map((r) => ({
    route: r.route_label, travel_date: '2026-10-05', booking_window: 'T+7', total_fare: 1000,
  })));
  freshEngine.recompute(); // establishes base period, index = 100

  // Now simulate a later collection where the CURRENT stored median fare
  // for DEL-BOM (weight 0.26) has become 2000, and every other route's
  // current median is unchanged. We write observations.json directly
  // (rather than via addObservations, which would ACCUMULATE with the
  // base-period rows and blend the median) because the index engine's own
  // documented behaviour is "the median of all currently stored
  // observations" -- this direct write isolates the recompute() formula
  // itself against a known, exact pair of (base_median, current_median).
  fs.writeFileSync(
    freshStorage.OBSERVATIONS_FILE,
    JSON.stringify(freshConfig.ROUTES.map((r) => ({
      route: r.route_label,
      travel_date: '2026-10-05',
      booking_window: 'T+7',
      total_fare: r.route_label === 'DEL-BOM' ? 2000 : 1000,
    }))),
    'utf8'
  );
  const entry = freshEngine.recompute();

  // Hand calculation: DEL-BOM relative_index = 200, all others = 100.
  // national_index = 200*0.26 + 100*(1-0.26) = 52 + 74 = 126.0
  assert.equal(entry.index, 126.0);

  const delBom = entry.routes.find((r) => r.route === 'DEL-BOM');
  assert.equal(delBom.relative_index, 200.0);
});

test('index engine: a route with zero observations is excluded from the weighted sum and coverage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apix-test-idx3-'));
  process.env.APIX_DATA_DIR = dir;
  delete require.cache[require.resolve('../backend/config')];
  delete require.cache[require.resolve('../backend/storage')];
  delete require.cache[require.resolve('../backend/indexEngine')];
  const freshConfig = require('../backend/config');
  const freshStorage = require('../backend/storage');
  const freshEngine = require('../backend/indexEngine');

  freshStorage.ensureStorage();
  // Only 5 of 6 routes get data (BLR-HYD, weight 0.08, is missing).
  const routesWithData = freshConfig.ROUTES.filter((r) => r.route_label !== 'BLR-HYD');
  freshStorage.addObservations(routesWithData.map((r) => ({
    route: r.route_label, travel_date: '2026-10-05', booking_window: 'T+7', total_fare: 1000,
  })));

  const entry = freshEngine.recompute();
  assert.equal(entry.index, 100.0); // base period, everyone present at their own base
  assert.equal(entry.coverage, 92); // 100% - 8% missing weight
  const missingRoute = entry.routes.find((r) => r.route === 'BLR-HYD');
  assert.equal(missingRoute.relative_index, null);
  assert.equal(missingRoute.base_median, null);
});

test('index engine: median() handles even and odd counts correctly', () => {
  assert.equal(indexEngine.median([10, 20, 30]), 20);
  assert.equal(indexEngine.median([10, 20, 30, 40]), 25);
  assert.equal(indexEngine.median([]), null);
});

// ---------------------------------------------------------------------------
// Data quality module
// ---------------------------------------------------------------------------
test('quality: flags invalid fare, missing field, bad currency, and unknown route', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apix-test-quality-'));
  process.env.APIX_DATA_DIR = dir;
  delete require.cache[require.resolve('../backend/config')];
  delete require.cache[require.resolve('../backend/storage')];
  delete require.cache[require.resolve('../backend/quality')];
  const freshStorage = require('../backend/storage');
  const freshQuality = require('../backend/quality');

  freshStorage.ensureStorage();
  fs.writeFileSync(
    freshStorage.OBSERVATIONS_FILE,
    JSON.stringify([
      { id: '1', route: 'DEL-BOM', origin: 'DEL', destination: 'BOM', booking_window: 'T+7', travel_date: '2026-10-05', collection_date: '2026-09-28', total_fare: 5000, source: 'x', collected_at: '2026-09-28T00:00:00Z', currency: 'INR' },
      { id: '2', route: 'DEL-BOM', origin: 'DEL', destination: 'BOM', booking_window: 'T+7', travel_date: '2026-10-05', collection_date: '2026-09-28', total_fare: -50, source: 'x', collected_at: '2026-09-28T00:00:00Z', currency: 'INR' },
      { id: '3', route: 'ZZZ-ZZZ', origin: 'ZZZ', destination: 'ZZZ', booking_window: 'T+7', travel_date: '2026-10-05', collection_date: '2026-09-28', total_fare: 5000, source: 'x', collected_at: '2026-09-28T00:00:00Z', currency: 'USD' },
      { id: null, route: 'DEL-BOM', origin: 'DEL', destination: 'BOM', booking_window: 'T+7', travel_date: 'not-a-date', collection_date: '2026-09-28', total_fare: 5000, source: 'x', collected_at: '2026-09-28T00:00:00Z' },
    ]),
    'utf8'
  );

  const report = freshQuality.buildReport();
  assert.equal(report.total_observations, 4);
  assert.equal(report.issues.invalid_fare.length, 1);
  assert.equal(report.issues.unknown_route.length, 1);
  assert.equal(report.issues.unsupported_currency.length, 1);
  assert.equal(report.issues.invalid_date.length, 1);
  assert.ok(report.total_issue_count >= 4);
});

// ---------------------------------------------------------------------------
// Collector: overlap protection
// ---------------------------------------------------------------------------
test('collector: isRunning() reports false when idle', () => {
  assert.equal(collector.isRunning(), false);
});

// ---------------------------------------------------------------------------
// Statistics module
// ---------------------------------------------------------------------------
const stats = require('../backend/stats');

test('stats: mean, median, percentile on a known dataset', () => {
  const values = [10, 20, 30, 40];
  assert.equal(stats.mean(values), 25);
  assert.equal(stats.median(values), 25);
  assert.equal(stats.percentile(values, 0), 10);
  assert.equal(stats.percentile(values, 1), 40);
});

test('stats: summarizeFares flags low sample and returns null for empty input', () => {
  const empty = stats.summarizeFares([]);
  assert.equal(empty.observation_count, 0);
  assert.equal(empty.median_fare, null);

  const small = stats.summarizeFares([100, 200, 300]);
  assert.equal(small.observation_count, 3);
  assert.equal(small.low_sample, true);

  const big = stats.summarizeFares([100, 200, 300, 400, 500, 600]);
  assert.equal(big.low_sample, false);
});

test('stats: groupSummary buckets observations by key correctly', () => {
  const obs = [
    { route: 'A', total_fare: 100 },
    { route: 'A', total_fare: 200 },
    { route: 'B', total_fare: 300 },
  ];
  const groups = stats.groupSummary(obs, (o) => o.route);
  const a = groups.find((g) => g.key === 'A');
  const b = groups.find((g) => g.key === 'B');
  assert.equal(a.observation_count, 2);
  assert.equal(a.median_fare, 150);
  assert.equal(b.observation_count, 1);
});

// ---------------------------------------------------------------------------
// Airline analysis module
// ---------------------------------------------------------------------------
test('airlineAnalysis: groups by airline, treats missing airline as Unknown, never ranks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apix-test-airlines-'));
  process.env.APIX_DATA_DIR = dir;
  delete require.cache[require.resolve('../backend/config')];
  delete require.cache[require.resolve('../backend/storage')];
  delete require.cache[require.resolve('../backend/airlineAnalysis')];
  const freshStorage = require('../backend/storage');
  const freshAirlines = require('../backend/airlineAnalysis');

  freshStorage.ensureStorage();
  fs.writeFileSync(
    freshStorage.OBSERVATIONS_FILE,
    JSON.stringify([
      { route: 'DEL-BOM', booking_window: 'T+7', airline: 'IndiGo', total_fare: 5000 },
      { route: 'DEL-BOM', booking_window: 'T+7', airline: 'IndiGo', total_fare: 5200 },
      { route: 'DEL-BLR', booking_window: 'T+1', airline: null, total_fare: 6000 },
    ]),
    'utf8'
  );

  const report = freshAirlines.buildAirlineList();
  assert.equal(report.airline_count, 2);
  const indigo = report.airlines.find((a) => a.airline === 'IndiGo');
  const unknown = report.airlines.find((a) => a.airline === 'Unknown');
  assert.equal(indigo.observation_count, 2);
  assert.equal(unknown.observation_count, 1);
  assert.ok(report.disclaimer.toLowerCase().includes('not ranked'));
});

// ---------------------------------------------------------------------------
// Heatmap module
// ---------------------------------------------------------------------------
test('heatmap: marks empty cells insufficient_data and never fabricates a fare', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apix-test-heatmap-'));
  process.env.APIX_DATA_DIR = dir;
  delete require.cache[require.resolve('../backend/config')];
  delete require.cache[require.resolve('../backend/storage')];
  delete require.cache[require.resolve('../backend/heatmap')];
  const freshStorage = require('../backend/storage');
  const freshHeatmap = require('../backend/heatmap');

  freshStorage.ensureStorage();
  freshStorage.addObservations([{ route: 'DEL-BOM', travel_date: '2026-10-05', booking_window: 'T+7', total_fare: 7000 }]);

  const report = freshHeatmap.buildHeatmap();
  const delBom = report.rows.find((r) => r.route === 'DEL-BOM');
  const filledCell = delBom.cells.find((c) => c.booking_window === 'T+7');
  const emptyCell = delBom.cells.find((c) => c.booking_window === 'T+1');
  assert.equal(filledCell.insufficient_data, false);
  assert.equal(filledCell.median_fare, 7000);
  assert.equal(emptyCell.insufficient_data, true);
  assert.equal(emptyCell.median_fare, null);
});

// ---------------------------------------------------------------------------
// Weekly / monthly index aggregation
// ---------------------------------------------------------------------------
test('indexAggregation: groups recorded daily entries into ISO weeks/months without interpolation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apix-test-agg-'));
  process.env.APIX_DATA_DIR = dir;
  delete require.cache[require.resolve('../backend/config')];
  delete require.cache[require.resolve('../backend/storage')];
  delete require.cache[require.resolve('../backend/indexAggregation')];
  const freshStorage = require('../backend/storage');
  const freshAgg = require('../backend/indexAggregation');

  freshStorage.ensureStorage();
  freshStorage.addIndexEntry({ index: 100, current_period: '2026-09-01T00:00:00Z', coverage: 100, observations: 10 });
  freshStorage.addIndexEntry({ index: 110, current_period: '2026-09-02T00:00:00Z', coverage: 100, observations: 12 });
  freshStorage.addIndexEntry({ index: 120, current_period: '2026-10-01T00:00:00Z', coverage: 100, observations: 14 });

  const monthly = freshAgg.buildMonthly();
  assert.equal(monthly.period_count, 2);
  const sept = monthly.periods.find((p) => p.period === '2026-09');
  assert.equal(sept.daily_count, 2);
  assert.equal(sept.index_avg, 105);
  assert.equal(sept.low_confidence, true); // fewer than 3 daily entries
});

// ---------------------------------------------------------------------------
// 30-day back-test
// ---------------------------------------------------------------------------
test('backtest30: reports INSUFFICIENT_DATA when no recent index history exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apix-test-backtest-'));
  process.env.APIX_DATA_DIR = dir;
  delete require.cache[require.resolve('../backend/config')];
  delete require.cache[require.resolve('../backend/storage')];
  delete require.cache[require.resolve('../backend/dgcaBacktest')];
  delete require.cache[require.resolve('../backend/backtest30')];
  const freshStorage = require('../backend/storage');
  const freshBacktest = require('../backend/backtest30');

  freshStorage.ensureStorage();
  const report = freshBacktest.buildBacktest30();
  assert.equal(report.status, 'INSUFFICIENT_DATA');
  assert.ok(report.message.includes('insufficient historical data'));
});

test('backtest30: reports AVAILABLE with observed series when recent history exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apix-test-backtest2-'));
  process.env.APIX_DATA_DIR = dir;
  delete require.cache[require.resolve('../backend/config')];
  delete require.cache[require.resolve('../backend/storage')];
  delete require.cache[require.resolve('../backend/dgcaBacktest')];
  delete require.cache[require.resolve('../backend/backtest30')];
  const freshStorage = require('../backend/storage');
  const freshBacktest = require('../backend/backtest30');

  freshStorage.ensureStorage();
  freshStorage.addIndexEntry({ index: 100, current_period: new Date().toISOString(), coverage: 100, observations: 10 });
  const report = freshBacktest.buildBacktest30();
  assert.equal(report.status, 'AVAILABLE');
  assert.equal(report.observed_series.length, 1);
  assert.equal(report.reference_comparison.status, 'DGCA_NOT_CONFIGURED');
});
