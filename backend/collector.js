'use strict';

const crypto = require('crypto');
const core = require('../scripts/serpapi_core.cjs');
const config = require('./config');
const storage = require('./storage');
const indexEngine = require('./indexEngine');

const VALID_ROUTES = new Set(config.ROUTES.map((r) => r.route_label));
const VALID_WINDOWS = new Set(config.BOOKING_WINDOWS);

// Module-level guard so a scheduled run and a manual "Trigger Ingestion"
// click can never execute concurrently and race on data/*.json writes.
let running = false;
function isRunning() {
  return running;
}

function isValidDate(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

/** Normalizes one raw SerpApi flight into the project's observation schema.
 * base_fare / taxes_fees are ALWAYS null — SerpApi only reliably gives a
 * total fare, and this project never invents a base/tax split. */
function normalize(routeLabel, origin, destination, windowLabel, travelDate, quoteDate, collectedAt, flight) {
  return {
    id: crypto.randomUUID(),
    route: routeLabel,
    origin,
    destination,
    airline: flight.airline || null,
    flight_numbers: flight.flight_numbers || [],
    departure: flight.departure_time || null,
    arrival: flight.arrival_time || null,
    stops: flight.stops ?? null,
    booking_window: windowLabel,
    travel_date: travelDate,
    collection_date: quoteDate,
    total_fare: flight.total_fare,
    base_fare: null,
    taxes_fees: null,
    total_fare_only: true, // this is a total-fare-only observation; no component breakup available
    source: config.SOURCE_NAME,
    collected_at: collectedAt,
  };
}

/** Only valid observations may enter storage / the index. Nothing missing
 * is ever manufactured — invalid observations are simply dropped. */
function isValid(obs) {
  if (!Number.isFinite(obs.total_fare) || obs.total_fare <= 0) return false;
  if (!VALID_ROUTES.has(obs.route)) return false;
  if (!VALID_WINDOWS.has(obs.booking_window)) return false;
  if (!isValidDate(obs.travel_date)) return false;
  return true;
}

/**
 * Runs the ONE collection pipeline used by both the "Trigger Ingestion"
 * button (POST /api/collector/run) and any future scheduler: SerpApi
 * search -> normalize -> validate -> dedupe -> store -> recompute index.
 * Never throws — always returns a structured summary so the API route can
 * return a clean JSON response even on partial or total failure.
 */
async function runCollection({ triggeredBy = 'manual' } = {}) {
  if (running) {
    // Never silently queue or overlap runs — report this plainly instead.
    return {
      run_id: null,
      status: 'REJECTED',
      run_type: triggeredBy,
      error: 'A collection run is already in progress. Try again once it finishes.',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    };
  }
  running = true;
  const startedAt = new Date().toISOString();

  let result;
  try {
    result = await core.runFullCollection();
  } catch (err) {
    const run = {
      run_id: crypto.randomUUID(),
      run_type: triggeredBy,
      status: 'FAILED',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - new Date(startedAt).getTime(),
      routes: config.ROUTES.length,
      windows: config.BOOKING_WINDOWS.length,
      searches: 0,
      successful_searches: 0,
      failed_searches: 0,
      observations_added: 0,
      error: err.message,
    };
    storage.addCollectionRun(run);
    running = false;
    return run;
  }

  // Flatten every route/window's flights into normalized observations.
  const rawObservations = [];
  for (const route of result.routes) {
    for (const win of route.windows) {
      for (const flight of win.flights) {
        rawObservations.push(
          normalize(route.route_label, route.origin, route.destination, win.window, win.travel_date, result.quoteDate, result.collectedAt, flight)
        );
      }
    }
  }

  const validObservations = rawObservations.filter(isValid);
  const { added, duplicates } = storage.addObservations(validObservations);

  const indexEntry = added > 0 || !storage.getFirstIndexEntry() ? indexEngine.recompute() : storage.getLatestIndexEntry();

  // Distinguish the three cases the project must never conflate:
  //   1. total API failure (all searches failed)              -> status FAILED
  //   2. success, but every observation was already known      -> ZERO_NEW
  //   3. success with genuinely new data                        -> SUCCESS
  let status;
  if (result.failedSearches === result.searchCount) {
    status = 'FAILED';
  } else if (added === 0) {
    status = 'ZERO_NEW';
  } else {
    status = 'SUCCESS';
  }

  const finishedAt = new Date().toISOString();
  const run = {
    run_id: crypto.randomUUID(),
    run_type: triggeredBy,
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    routes: config.ROUTES.length,
    windows: config.BOOKING_WINDOWS.length,
    searches: result.searchCount,
    successful_searches: result.successfulSearches,
    failed_searches: result.failedSearches,
    observations_found: rawObservations.length,
    observations_valid: validObservations.length,
    observations_added: added,
    observations_duplicate: duplicates,
    index_after_run: indexEntry ? indexEntry.index : null,
    last_error:
      result.collectionLog.filter((e) => e.status === 'FAILED')[0]?.error_message || null,
  };

  storage.addCollectionRun(run);
  running = false;
  return run;
}

module.exports = { runCollection, isRunning };
