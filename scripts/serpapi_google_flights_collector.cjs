#!/usr/bin/env node
'use strict';

/**
 * APIx — SerpApi / Google Flights multi-route collector (CLI)
 *
 * This is a thin CLI wrapper around scripts/serpapi_core.cjs, which is the
 * SAME module the backend uses for POST /api/collector/run. There is only
 * one collector implementation in this project.
 *
 * Usage:
 *   SERPAPI_KEY=your_key node scripts/serpapi_google_flights_collector.cjs
 *
 * Scope: 6 DGCA basket routes x 5 exact lead-time windows (T+1, T+7, T+15,
 * T+30, T+45) = 30 SerpApi searches.
 *
 * Outputs (for standalone/manual inspection):
 *   data/scraped/serpapi_6routes_5windows.json   route/window statistics + flights
 *   data/scraped/serpapi_collection_log.json     per-request collection log
 *   data/raw/<timestamp>_<route>_<window>.json   verbatim SerpApi responses
 */

const fs = require('fs');
const path = require('path');
const core = require('./serpapi_core.cjs');

const SCRAPED_DIR = path.resolve(process.cwd(), 'data', 'scraped');
const OUTPUT_FILE = path.join(SCRAPED_DIR, 'serpapi_6routes_5windows.json');
const COLLECTION_LOG_FILE = path.join(SCRAPED_DIR, 'serpapi_collection_log.json');

(async () => {
  if (!process.env.SERPAPI_KEY) {
    console.error('ERROR: SERPAPI_KEY is not set.');
    console.error('  export SERPAPI_KEY="your_key_here"   (macOS/Linux)');
    console.error('  $env:SERPAPI_KEY="your_key_here"      (PowerShell)');
    process.exit(1);
  }

  console.log('========================================');
  console.log('SERPAPI 6-ROUTE / 5-WINDOW COLLECTOR');
  console.log('========================================');
  console.log('Routes:', core.ROUTES.length);
  console.log('Booking windows:', core.BOOKING_WINDOWS.join(', '));
  console.log('Planned SerpApi searches:', core.ROUTES.length * core.BOOKING_WINDOWS.length);
  console.log('');

  const result = await core.runFullCollection({
    onProgress: (routeLabel, windowLabel, logEntry) => {
      const tag = `${routeLabel} ${windowLabel}`;
      if (logEntry.status === 'SUCCESS') {
        console.log(`  OK   ${tag} -> ${logEntry.number_of_results} observations`);
      } else {
        console.log(`  FAIL ${tag} -> ${logEntry.error_message}`);
      }
    },
  });

  const output = {
    source: 'Google Flights via SerpApi',
    source_type: 'flight_aggregator_api',
    quote_date: result.quoteDate,
    collection_timestamp: result.collectedAt,
    statistic: 'median_total_fare',
    fare_components_available: false,
    index_note:
      'Route-window statistics only. Current SerpApi response exposes total fare, not a reliable Base Fare + Taxes/Fees split.',
    route_weights: core.ROUTES.map((r) => ({ route_label: r.route_label, traffic_weight: r.traffic_weight })),
    routes: result.routes,
  };

  fs.mkdirSync(SCRAPED_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  fs.writeFileSync(
    COLLECTION_LOG_FILE,
    JSON.stringify(
      {
        quote_date: result.quoteDate,
        generated_at: result.collectedAt,
        source: 'Google Flights via SerpApi',
        total_requests: result.collectionLog.length,
        successful_requests: result.successfulSearches,
        failed_requests: result.failedSearches,
        entries: result.collectionLog,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log('\n========================================');
  console.log('COLLECTION SUMMARY');
  console.log('========================================');
  for (const route of result.routes) {
    const totalObservations = route.windows.reduce((sum, w) => sum + (w.observation_count || 0), 0);
    console.log(`${route.route_label} | ${route.windows.length}/${core.BOOKING_WINDOWS.length} windows | ${totalObservations} observations`);
  }
  console.log('\nSerpApi searches used:', result.searchCount);
  console.log('Successful requests:', result.successfulSearches);
  console.log('Failed requests:', result.failedSearches);
  console.log('\nSaved:');
  console.log(OUTPUT_FILE);
  console.log(COLLECTION_LOG_FILE);

  process.exit(result.failedSearches === result.searchCount ? 1 : 0);
})();
