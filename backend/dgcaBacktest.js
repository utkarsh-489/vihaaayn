'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR, ROUTES } = require('./config');
const storage = require('./storage');
const indexEngine = require('./indexEngine');

/**
 * APIx DGCA backtest module.
 * ---------------------------------------------------------------
 * The SIH problem statement asks for a 30-day back-test against
 * PUBLICLY AVAILABLE DGCA monthly average domestic-fare data.
 *
 * This project does NOT ship any DGCA figures, because none were
 * provided and DGCA data is not something this codebase can invent
 * or scrape reliably (it is published as PDF/Excel bulletins, not a
 * queryable API). Per the project's own rules, we build the
 * infrastructure and a precise schema, and we refuse to fabricate
 * or fake a "backtest complete" result.
 *
 * To actually run a backtest: place a file at
 *   data/dgca_reference.json
 * matching DGCA_REFERENCE_SCHEMA below (see also README.md), then call
 * GET /api/dgca-backtest again. Until that file exists, this endpoint
 * reports NOT_CONFIGURED and explains exactly what is missing.
 *
 * IMPORTANT comparability caveat (always surfaced, never hidden):
 * DGCA's published figures are MONTHLY AVERAGE fares for a route,
 * aggregated across airlines/fare classes/booking windows however
 * DGCA defines them. This project's numbers are median total fares
 * for specific T+n booking windows on specific quote dates. These are
 * NOT the same statistical population — a backtest here is a rough
 * directional cross-check at best, not a validation of equivalence.
 */

const DGCA_REFERENCE_FILE = path.join(DATA_DIR, 'dgca_reference.json');

const DGCA_REFERENCE_SCHEMA = {
  description: 'One entry per route per month of official DGCA average domestic fare data.',
  format: [
    {
      route: 'DEL-BOM',
      month: '2026-08',
      dgca_average_fare_inr: 5200,
      source_document: 'e.g. DGCA monthly domestic traffic/fare bulletin, August 2026 (name/URL of the actual publication)',
    },
  ],
  notes: [
    'route must be one of the 6 basket routes: ' + ROUTES.map((r) => r.route_label).join(', '),
    'month must be "YYYY-MM"',
    'dgca_average_fare_inr must be a positive number, taken directly from the published DGCA figure — never estimated',
    'source_document should identify exactly which official publication the figure came from, for auditability',
  ],
};

function loadReferenceData() {
  if (!fs.existsSync(DGCA_REFERENCE_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(DGCA_REFERENCE_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Compares whatever DGCA reference data is available against this
 * project's own median fares for the same route+month, if we have
 * observations covering that month. Never fabricates a comparison
 * point for a month/route we have no observations for.
 */
function buildBacktest() {
  const reference = loadReferenceData();

  if (!reference) {
    return {
      status: 'NOT_CONFIGURED',
      message: 'No DGCA reference data found. This is expected until official figures are added — nothing has been fabricated.',
      required_file: path.relative(process.cwd(), DGCA_REFERENCE_FILE),
      schema: DGCA_REFERENCE_SCHEMA,
      comparability_caveat:
        'DGCA publishes MONTHLY AVERAGE fares; this project measures median fares for specific T+n booking windows on specific quote dates. Even once reference data is added, a match here is a directional cross-check, not proof of equivalence.',
    };
  }

  const observations = storage.getObservations();
  const results = [];

  for (const entry of reference) {
    const monthObs = observations.filter(
      (o) => o.route === entry.route && typeof o.travel_date === 'string' && o.travel_date.startsWith(entry.month)
    );
    const fares = monthObs.map((o) => o.total_fare).filter((f) => Number.isFinite(f));
    const projectMedian = indexEngine.median(fares);

    results.push({
      route: entry.route,
      month: entry.month,
      dgca_average_fare_inr: entry.dgca_average_fare_inr,
      source_document: entry.source_document || null,
      project_median_fare_inr: projectMedian,
      project_observation_count: fares.length,
      difference_inr: projectMedian !== null ? Math.round((projectMedian - entry.dgca_average_fare_inr) * 100) / 100 : null,
      difference_pct:
        projectMedian !== null && entry.dgca_average_fare_inr
          ? Math.round(((projectMedian - entry.dgca_average_fare_inr) / entry.dgca_average_fare_inr) * 10000) / 100
          : null,
      comparable: fares.length > 0,
    });
  }

  const comparableCount = results.filter((r) => r.comparable).length;

  return {
    status: comparableCount > 0 ? 'PARTIAL' : 'REFERENCE_ONLY_NO_OVERLAP',
    message:
      comparableCount > 0
        ? `${comparableCount} of ${results.length} reference entries have overlapping project observations.`
        : 'DGCA reference data is present, but no project observations overlap with any of its route/month combinations yet.',
    comparability_caveat:
      'DGCA publishes MONTHLY AVERAGE fares; this project measures median fares for specific T+n booking windows on specific quote dates. A match here is a directional cross-check, not proof of equivalence.',
    results,
  };
}

module.exports = { buildBacktest, DGCA_REFERENCE_SCHEMA, DGCA_REFERENCE_FILE };
