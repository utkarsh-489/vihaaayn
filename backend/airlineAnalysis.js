'use strict';

const storage = require('./storage');
const stats = require('./stats');

/**
 * APIx airline analysis module.
 * ---------------------------------------------------------------
 * Purely descriptive: observation counts, median/mean fare, and route /
 * booking-window distribution per airline, as reported in the collected
 * observations. This module NEVER ranks airlines as "best" or "worst" —
 * it has no basis to (fares here reflect one economy fare class searched
 * on specific dates, not overall airline quality or pricing strategy).
 *
 * Observations with no airline recorded are grouped under "Unknown" so
 * they are visible rather than silently dropped.
 */

function buildAirlineList() {
  const observations = storage.getObservations();
  const withAirline = observations.map((o) => ({ ...o, airline: o.airline || 'Unknown' }));

  const byAirline = stats.groupSummary(withAirline, (o) => o.airline);

  const airlines = byAirline.map((entry) => {
    const airlineObs = withAirline.filter((o) => o.airline === entry.key);

    const routeDistribution = stats
      .groupSummary(airlineObs, (o) => o.route)
      .map((r) => ({ route: r.key, observation_count: r.observation_count }))
      .sort((a, b) => b.observation_count - a.observation_count);

    const windowDistribution = stats
      .groupSummary(airlineObs, (o) => o.booking_window)
      .map((w) => ({ booking_window: w.key, observation_count: w.observation_count }))
      .sort((a, b) => b.observation_count - a.observation_count);

    return {
      airline: entry.key,
      observation_count: entry.observation_count,
      low_sample: entry.low_sample,
      median_fare: entry.median_fare,
      mean_fare: entry.mean_fare,
      p25_fare: entry.p25_fare,
      p75_fare: entry.p75_fare,
      route_distribution: routeDistribution,
      booking_window_distribution: windowDistribution,
    };
  });

  airlines.sort((a, b) => b.observation_count - a.observation_count);

  return {
    generated_at: new Date().toISOString(),
    total_observations: observations.length,
    airline_count: airlines.length,
    low_sample_threshold: stats.LOW_SAMPLE_THRESHOLD,
    disclaimer:
      'Descriptive statistics only. Airlines are not ranked as "best" or "worst" — fares reflect specific economy searches on specific dates, not overall pricing strategy or service quality. Airlines with fewer than ' +
      stats.LOW_SAMPLE_THRESHOLD +
      ' observations are flagged low_sample: true; treat their statistics as indicative, not authoritative.',
    airlines,
  };
}

module.exports = { buildAirlineList };
