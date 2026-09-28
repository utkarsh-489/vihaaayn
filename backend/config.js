'use strict';

const path = require('path');
const core = require('../scripts/serpapi_core.cjs');

const DATA_DIR = path.resolve(
  process.env.APIX_DATA_DIR ||
    (process.env.VERCEL ? '/tmp/apix-data' : path.join(__dirname, '..', 'data'))
);

module.exports = {
  PORT: Number(process.env.PORT || 5000),
  DATA_DIR,
  RAW_DIR: path.join(DATA_DIR, 'raw'),
  FRONTEND_DIST: path.resolve(__dirname, '..', 'frontend', 'dist'),
  ROUTES: core.ROUTES,
  BOOKING_WINDOWS: core.BOOKING_WINDOWS,
  SOURCE_NAME: 'Google Flights via SerpApi',
};
