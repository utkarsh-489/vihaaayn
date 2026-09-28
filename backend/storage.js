'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR, RAW_DIR } = require('./config');

const OBSERVATIONS_FILE = path.join(DATA_DIR, 'observations.json');
const COLLECTION_RUNS_FILE = path.join(DATA_DIR, 'collection_runs.json');
const INDEX_HISTORY_FILE = path.join(DATA_DIR, 'index_history.json');

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });
  for (const file of [OBSERVATIONS_FILE, COLLECTION_RUNS_FILE, INDEX_HISTORY_FILE]) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, '[]', 'utf8');
    }
  }
}

function readJSON(file, fallback) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  // Write to a temp file then rename, so a crash mid-write can't corrupt
  // the JSON file — keeps storage "simple and robust" as required.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------
function dedupeKey(obs) {
  return [
    obs.route,
    obs.travel_date,
    obs.booking_window,
    obs.airline || '',
    (obs.flight_numbers || []).join('|'),
    obs.departure || '',
    obs.arrival || '',
    obs.total_fare,
  ].join('::');
}

function getObservations() {
  ensureStorage();
  return readJSON(OBSERVATIONS_FILE, []);
}

/** Appends only observations not already present (by deterministic key). */
function addObservations(newObservations) {
  ensureStorage();
  const existing = getObservations();
  const seen = new Set(existing.map(dedupeKey));
  const toAdd = [];
  for (const obs of newObservations) {
    const key = dedupeKey(obs);
    if (!seen.has(key)) {
      seen.add(key);
      toAdd.push(obs);
    }
  }
  const merged = existing.concat(toAdd);
  writeJSON(OBSERVATIONS_FILE, merged);
  return { added: toAdd.length, duplicates: newObservations.length - toAdd.length, total: merged.length };
}

// ---------------------------------------------------------------------------
// Collection runs
// ---------------------------------------------------------------------------
function getCollectionRuns() {
  ensureStorage();
  return readJSON(COLLECTION_RUNS_FILE, []);
}

function addCollectionRun(run) {
  ensureStorage();
  const runs = getCollectionRuns();
  runs.push(run);
  writeJSON(COLLECTION_RUNS_FILE, runs);
  return run;
}

function getLatestCollectionRun() {
  const runs = getCollectionRuns();
  return runs.length ? runs[runs.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Index history
// ---------------------------------------------------------------------------
function getIndexHistory() {
  ensureStorage();
  return readJSON(INDEX_HISTORY_FILE, []);
}

function addIndexEntry(entry) {
  ensureStorage();
  const history = getIndexHistory();
  history.push(entry);
  writeJSON(INDEX_HISTORY_FILE, history);
  return entry;
}

function getLatestIndexEntry() {
  const history = getIndexHistory();
  return history.length ? history[history.length - 1] : null;
}

function getFirstIndexEntry() {
  const history = getIndexHistory();
  return history.length ? history[0] : null;
}

module.exports = {
  OBSERVATIONS_FILE,
  COLLECTION_RUNS_FILE,
  INDEX_HISTORY_FILE,
  ensureStorage,
  getObservations,
  addObservations,
  dedupeKey,
  getCollectionRuns,
  addCollectionRun,
  getLatestCollectionRun,
  getIndexHistory,
  addIndexEntry,
  getLatestIndexEntry,
  getFirstIndexEntry,
};
