'use strict';

const path = require('path');
const core = require('../scripts/serpapi_core.cjs');

// APIX_DATA_DIR lets the test suite point storage at a throwaway temp
// directory instead of the real data/ folder, so running tests can never
// touch or overwrite the user's actual collected observations. Unset in
// normal operation, so production/demo behaviour is completely unchanged.
const DATA_DIR = path.resolve(process.env.APIX_DATA_DIR || path.join(__dirname, '..', 'data'));

module.exports = {
  PORT: Number(process.env.PORT || 5000),
  DATA_DIR,
  RAW_DIR: path.join(DATA_DIR, 'raw'),
  FRONTEND_DIST: path.resolve(__dirname, '..', 'frontend', 'dist'),
  ROUTES: core.ROUTES, // [{route_label, origin, destination, traffic_weight}]
  BOOKING_WINDOWS: core.BOOKING_WINDOWS, // ['T+1','T+7','T+15','T+30','T+45']
  SOURCE_NAME: 'Google Flights via SerpApi',
};
