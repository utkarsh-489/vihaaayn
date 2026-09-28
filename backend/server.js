'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const storage = require('./storage');
const apiRoutes = require('./routes');
const scheduler = require('./scheduler');

storage.ensureStorage();

const app = express();
app.use(express.json());

// Minimal, permissive CORS for local development — no extra dependency needed.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api', apiRoutes);

// Serve the built frontend in production, if it exists.
if (fs.existsSync(config.FRONTEND_DIST)) {
  app.use(express.static(config.FRONTEND_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(config.FRONTEND_DIST, 'index.html'));
  });
}

// The server must never crash outright on an unhandled route error.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ status: 'FAILED', error: 'Internal server error' });
});

const server = app.listen(config.PORT, () => {
  console.log(`APIx backend listening on http://localhost:${config.PORT}`);
  console.log(`  Health check: http://localhost:${config.PORT}/api/health`);
  // Starts exactly once per process. If SCHEDULE_ENABLED is not "true" this
  // only logs that scheduling is off — it never runs collections silently.
  scheduler.start();
});

// Clean shutdown: stop the scheduler's interval handle so the process can
// exit normally (e.g. under nodemon, Docker, or Ctrl+C).
function shutdown() {
  scheduler.stop();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
