'use strict';

const fs = require('fs');
const path = require('path');

/**
 * APIx — SerpApi / Google Flights collector core.
 *
 * This module is the SINGLE SOURCE OF TRUTH for talking to SerpApi /
 * Google Flights. Both the standalone CLI script
 * (scripts/serpapi_google_flights_collector.cjs) and the backend
 * (backend/collector.js, used by POST /api/collector/run) import and
 * call the SAME functions from here. There is no second, competing
 * collector implementation anywhere in this project.
 *
 * Behaviour (unchanged from the original proven collector):
 *   - 6 DGCA basket routes x 5 exact booking windows (T+1..T+45) = 30 searches
 *   - Travel dates are computed dynamically from "today" (UTC) — never hard-coded
 *   - Google Flights via SerpApi, India/localized (gl=in), INR, one-way, economy
 *   - Controlled retries with exponential backoff for transient failures
 *     (timeouts, 429, 5xx). Fatal errors (bad API key) fail fast for that call.
 *   - One failed route/window is isolated and never aborts the rest of the run
 *   - Only observed TOTAL fare is used. base_fare / taxes_fees are always null
 *     because SerpApi does not reliably expose that split. Nothing is invented.
 *   - The verbatim SerpApi response is archived to data/raw/ for provenance.
 */

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const RAW_RESPONSE_DIR = path.join(DATA_DIR, 'raw');

// ---------------------------------------------------------------------------
// Fixed basket: 6 routes with official traffic weights (sum to 100%). Do not
// change these — they are specified by the project requirements.
// ---------------------------------------------------------------------------
const ROUTES = [
  { route_label: 'DEL-BOM', origin: 'DEL', destination: 'BOM', traffic_weight: 0.26 },
  { route_label: 'DEL-BLR', origin: 'DEL', destination: 'BLR', traffic_weight: 0.22 },
  { route_label: 'BOM-BLR', origin: 'BOM', destination: 'BLR', traffic_weight: 0.18 },
  { route_label: 'DEL-CCU', origin: 'DEL', destination: 'CCU', traffic_weight: 0.14 },
  { route_label: 'MAA-DEL', origin: 'MAA', destination: 'DEL', traffic_weight: 0.12 },
  { route_label: 'BLR-HYD', origin: 'BLR', destination: 'HYD', traffic_weight: 0.08 },
];

// ---------------------------------------------------------------------------
// Fixed set of 5 booking windows. Travel dates are always computed relative
// to "today" at call time — nothing here is a hard-coded date.
// ---------------------------------------------------------------------------
const BOOKING_WINDOW_DAYS = {
  'T+1': 1,
  'T+7': 7,
  'T+15': 15,
  'T+30': 30,
  'T+45': 45,
};
const BOOKING_WINDOWS = Object.keys(BOOKING_WINDOW_DAYS);

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function travelDateFor(windowLabel, quoteDate) {
  const days = BOOKING_WINDOW_DAYS[windowLabel];
  if (!days) throw new Error(`Unknown booking window: ${windowLabel}`);
  const base = quoteDate ? new Date(`${quoteDate}T00:00:00Z`).getTime() : Date.now();
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

function calculateLeadDays(quoteDate, travelDate) {
  const q = new Date(`${quoteDate}T00:00:00Z`);
  const t = new Date(`${travelDate}T00:00:00Z`);
  return Math.round((t.getTime() - q.getTime()) / (1000 * 60 * 60 * 24));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getConfig() {
  return {
    apiKey: process.env.SERPAPI_KEY,
    maxRetries: Number(process.env.SERPAPI_MAX_RETRIES || 3),
    retryBaseDelayMs: Number(process.env.SERPAPI_RETRY_BASE_DELAY_MS || 2000),
    retryMaxDelayMs: Number(process.env.SERPAPI_RETRY_MAX_DELAY_MS || 30000),
    requestDelayMs: Number(process.env.SERPAPI_REQUEST_DELAY_MS || 1200),
    requestTimeoutMs: Number(process.env.SERPAPI_TIMEOUT_MS || 30000),
    travelClass: process.env.SERPAPI_TRAVEL_CLASS || '1', // 1 = Economy
    adults: process.env.SERPAPI_ADULTS || '1',
    currency: process.env.SERPAPI_CURRENCY || 'INR',
    gl: process.env.SERPAPI_GL || 'in',
    hl: process.env.SERPAPI_HL || 'en',
    deepSearch: process.env.SERPAPI_DEEP_SEARCH || 'false',
  };
}

// ---------------------------------------------------------------------------
// Response classification / retry policy
// ---------------------------------------------------------------------------
function classifyResponse(status, bodyText) {
  if (status === 429) {
    return { retryable: true, fatal: false, error: 'SerpApi rate limit (HTTP 429)' };
  }
  if (status >= 500 && status <= 599) {
    return { retryable: true, fatal: false, error: `SerpApi server error (HTTP ${status})` };
  }
  if (status === 401 || status === 403) {
    return {
      retryable: false,
      fatal: true,
      error: `SerpApi authentication failure (HTTP ${status}). Check SERPAPI_KEY.`,
    };
  }
  if (status !== 200) {
    return { retryable: false, fatal: false, error: `SerpApi HTTP ${status}` };
  }

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    return { retryable: true, fatal: false, error: 'SerpApi returned a non-JSON body' };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      retryable: false,
      fatal: false,
      error: 'SerpApi returned an unexpected response structure (JSON root is not an object)',
    };
  }

  if (data.error) {
    const errL = String(data.error).toLowerCase();
    if (
      errL.includes('invalid api key') ||
      errL.includes('api key') ||
      errL.includes('unauthorized') ||
      errL.includes('forbidden')
    ) {
      return { retryable: false, fatal: true, error: `SerpApi error: ${data.error}` };
    }
    if (
      errL.includes('rate limit') ||
      errL.includes('too many requests') ||
      errL.includes('timeout') ||
      errL.includes('timed out') ||
      errL.includes('temporarily') ||
      errL.includes('try again')
    ) {
      return { retryable: true, fatal: false, error: `SerpApi error: ${data.error}` };
    }
    return { retryable: false, fatal: false, error: `SerpApi error: ${data.error}` };
  }

  return { retryable: false, fatal: false, error: null };
}

async function executeSerpApiRequest(origin, destination, travelDate, config) {
  const params = new URLSearchParams({
    engine: 'google_flights',
    api_key: config.apiKey,
    departure_id: origin,
    arrival_id: destination,
    outbound_date: travelDate,
    type: '2', // one-way
    travel_class: config.travelClass,
    adults: config.adults,
    currency: config.currency,
    gl: config.gl,
    hl: config.hl,
    deep_search: config.deepSearch,
  });

  // Never log the URL: it contains the API key.
  const url = `https://serpapi.com/search.json?${params.toString()}`;

  let lastError = null;
  let attempts = 0;
  let lastHttpStatus = 0;
  let rawText = null;

  for (let attempt = 1; attempt <= config.maxRetries; attempt += 1) {
    attempts = attempt;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
      rawText = await response.text();
      lastHttpStatus = response.status;

      const verdict = classifyResponse(response.status, rawText);
      if (verdict.fatal) {
        return { ok: false, fatal: true, error: verdict.error, attempts, http_status: lastHttpStatus, raw_text: rawText };
      }
      if (verdict.error === null) {
        return { ok: true, data: JSON.parse(rawText), attempts, http_status: 200, raw_text: rawText, error: null };
      }
      lastError = verdict.error;
    } catch (err) {
      if (err && err.name === 'TimeoutError') {
        lastError = `SerpApi request timed out after ${config.requestTimeoutMs} ms`;
      } else if (err && err.name === 'AbortError') {
        lastError = 'SerpApi request aborted (timeout)';
      } else {
        lastError = `Network failure calling SerpApi: ${err && err.message ? err.message : err}`;
      }
      lastHttpStatus = 0;
    }

    if (attempt < config.maxRetries) {
      const backoff = Math.min(config.retryBaseDelayMs * 2 ** (attempt - 1), config.retryMaxDelayMs);
      await sleep(backoff);
    }
  }

  return { ok: false, fatal: false, error: lastError || 'SerpApi request failed after retries', attempts, http_status: lastHttpStatus, raw_text: rawText };
}

function uniqueFlights(flights) {
  const map = new Map();
  for (const flight of flights) {
    const key = [
      flight.airline || '',
      flight.flight_numbers?.join('|') || '',
      flight.departure_airport_code || '',
      flight.departure_time || '',
      flight.arrival_airport_code || '',
      flight.arrival_time || '',
      flight.total_fare ?? '',
    ].join('|');
    if (!map.has(key)) map.set(key, flight);
  }
  return [...map.values()];
}

function extractFlights(results, config) {
  const groups = [];
  if (Array.isArray(results.best_flights)) groups.push(...results.best_flights);
  if (Array.isArray(results.other_flights)) groups.push(...results.other_flights);

  const observations = [];
  for (const group of groups) {
    if (!group) continue;
    const segments = Array.isArray(group.flights) ? group.flights : [];
    if (segments.length === 0) continue;

    const first = segments[0];
    const last = segments[segments.length - 1];
    const departureAirport = first.departure_airport || {};
    const arrivalAirport = last.arrival_airport || {};

    const airlines = [...new Set(segments.map((s) => s.airline).filter(Boolean))];
    const flightNumbers = segments.map((s) => s.flight_number).filter(Boolean);
    const price = Number(group.price);

    observations.push({
      airline: airlines.join(', ') || null,
      flight_numbers: flightNumbers,
      departure_airport: departureAirport.name || null,
      departure_airport_code: departureAirport.id || null,
      departure_time: departureAirport.time || null,
      arrival_airport: arrivalAirport.name || null,
      arrival_airport_code: arrivalAirport.id || null,
      arrival_time: arrivalAirport.time || null,
      total_duration_minutes: Number.isFinite(Number(group.total_duration)) ? Number(group.total_duration) : null,
      stops: Math.max(0, segments.length - 1),
      total_fare: Number.isFinite(price) ? price : null,
      currency: config.currency,
    });
  }

  return uniqueFlights(observations.filter((o) => o.total_fare !== null && o.total_fare > 0));
}

function archiveRawResponse(routeLabel, windowLabel, rawText) {
  try {
    fs.mkdirSync(RAW_RESPONSE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${stamp}_${routeLabel}_${windowLabel}.json`;
    const filePath = path.join(RAW_RESPONSE_DIR, filename);
    let content = rawText;
    try {
      content = JSON.stringify(JSON.parse(rawText), null, 2);
    } catch {
      // non-JSON body: archive as-is
    }
    fs.writeFileSync(filePath, content, 'utf8');
    return path.relative(process.cwd(), filePath);
  } catch (err) {
    console.warn(`  WARNING: could not archive raw response: ${err.message}`);
    return null;
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

function calculateWindowStats(observations) {
  const fares = observations
    .map((item) => Number(item.total_fare))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  if (fares.length === 0) {
    return { observation_count: 0, minimum_fare: null, p25: null, median_fare: null, p75: null, maximum_fare: null, mean_fare: null };
  }
  const sum = fares.reduce((t, v) => t + v, 0);
  return {
    observation_count: fares.length,
    minimum_fare: fares[0],
    p25: percentile(fares, 0.25),
    median_fare: percentile(fares, 0.5),
    p75: percentile(fares, 0.75),
    maximum_fare: fares[fares.length - 1],
    mean_fare: sum / fares.length,
  };
}

/**
 * Collect one route x one booking window. Never throws for upstream
 * problems — always returns a structured outcome so one failure cannot
 * abort the rest of the run (failure isolation).
 */
async function collect(route, windowLabel, quoteDate, config) {
  const travelDate = travelDateFor(windowLabel, quoteDate);
  const startedAt = new Date().toISOString();
  const requestStart = Date.now();

  const outcome = await executeSerpApiRequest(route.origin, route.destination, travelDate, config);
  const durationMs = Date.now() - requestStart;

  const logEntry = {
    route: route.route_label,
    booking_window: windowLabel,
    travel_date: travelDate,
    request_time: startedAt,
    status: 'FAILED',
    number_of_results: 0,
    duration_ms: durationMs,
    attempts: outcome.attempts || 0,
    http_status: outcome.http_status || null,
    error_message: outcome.error || null,
    source: 'Google Flights via SerpApi',
    raw_response_path: null,
  };

  if (!outcome.ok) {
    if (outcome.raw_text) {
      logEntry.raw_response_path = archiveRawResponse(route.route_label, windowLabel, outcome.raw_text);
    }
    return { flights: [], stats: null, logEntry, travelDate };
  }

  const rawPath = archiveRawResponse(route.route_label, windowLabel, outcome.raw_text);
  const flights = extractFlights(outcome.data, config);
  const stats = calculateWindowStats(flights);

  logEntry.status = 'SUCCESS';
  logEntry.number_of_results = flights.length;
  logEntry.raw_response_path = rawPath;
  logEntry.search_id = outcome.data.search_metadata?.id || null;

  return { flights, stats, logEntry, travelDate };
}

/**
 * Run the full 6-route x 5-window collection (30 SerpApi searches).
 * onProgress(routeLabel, windowLabel, logEntry) is called after each search
 * so callers (CLI or backend) can stream progress if they want to.
 */
async function runFullCollection({ onProgress } = {}) {
  const config = getConfig();
  if (!config.apiKey) {
    throw new Error('SERPAPI_KEY is not set in the environment.');
  }

  const quoteDate = todayUTC();
  const collectionLog = [];
  const routeResults = [];
  let searchCount = 0;

  for (const route of ROUTES) {
    const routeOutput = { route_label: route.route_label, origin: route.origin, destination: route.destination, traffic_weight: route.traffic_weight, windows: [] };

    for (const windowLabel of BOOKING_WINDOWS) {
      const { flights, stats, logEntry, travelDate } = await collect(route, windowLabel, quoteDate, config);
      collectionLog.push(logEntry);
      searchCount += 1;
      if (onProgress) onProgress(route.route_label, windowLabel, logEntry);

      if (logEntry.status === 'SUCCESS') {
        routeOutput.windows.push({ window: windowLabel, travel_date: travelDate, lead_days: calculateLeadDays(quoteDate, travelDate), ...stats, flights });
      }

      await sleep(config.requestDelayMs); // ethical pacing between requests
    }

    routeResults.push(routeOutput);
  }

  return {
    quoteDate,
    collectedAt: new Date().toISOString(),
    routes: routeResults,
    collectionLog,
    searchCount,
    successfulSearches: collectionLog.filter((e) => e.status === 'SUCCESS').length,
    failedSearches: collectionLog.filter((e) => e.status === 'FAILED').length,
  };
}

module.exports = {
  ROUTES,
  BOOKING_WINDOWS,
  BOOKING_WINDOW_DAYS,
  DATA_DIR,
  RAW_RESPONSE_DIR,
  todayUTC,
  travelDateFor,
  calculateLeadDays,
  getConfig,
  calculateWindowStats,
  percentile,
  collect,
  runFullCollection,
};
