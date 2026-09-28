'use strict';

const collector = require('./collector');

/**
 * APIx scheduler — configurable daily collection.
 * ---------------------------------------------------------------
 * Deliberately NOT a cron library dependency: the project's own rules
 * ask to avoid unnecessary new dependencies when a small, auditable
 * piece of code does the job. This is a single setInterval-based
 * "tick" loop that checks, once a minute, whether it is time to run
 * today's scheduled collection.
 *
 * Guarantees:
 *  - Starts only once per process (start() is idempotent).
 *  - Never runs two collections concurrently (an in-flight run blocks
 *    both the next scheduled tick and a manual trigger from
 *    overlapping — see collector.js's isRunning guard below).
 *  - Never claims to be "active" unless SCHEDULE_ENABLED=true AND
 *    start() has actually been called.
 *  - Shuts down cleanly via stop() (clears the interval handle).
 *
 * Configuration (all via environment variables, see .env.example):
 *  SCHEDULE_ENABLED     'true' | 'false'  (default: false)
 *  SCHEDULE_HOUR_UTC    0-23              (default: 3)
 *  SCHEDULE_MINUTE_UTC  0-59              (default: 0)
 *
 * The schedule always runs in UTC to avoid local-timezone / DST
 * ambiguity on whatever machine or host runs the server; the
 * configured hour/minute is documented as UTC everywhere in the UI.
 */

const state = {
  enabled: String(process.env.SCHEDULE_ENABLED || 'false').toLowerCase() === 'true',
  hourUTC: clampInt(process.env.SCHEDULE_HOUR_UTC, 0, 23, 3),
  minuteUTC: clampInt(process.env.SCHEDULE_MINUTE_UTC, 0, 59, 0),
  started: false,
  intervalHandle: null,
  lastRunDateKey: null, // 'YYYY-MM-DD' of the last date a scheduled run fired, to avoid double-firing within the same minute window
  lastScheduledRunAt: null,
  lastScheduledRunResult: null,
};

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function nextRunISO() {
  if (!state.enabled) return null;
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), state.hourUTC, state.minuteUTC, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

async function tick() {
  if (!state.enabled) return;
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const isScheduledMinute = now.getUTCHours() === state.hourUTC && now.getUTCMinutes() === state.minuteUTC;

  if (!isScheduledMinute) return;
  if (state.lastRunDateKey === dateKey) return; // already fired today
  if (collector.isRunning()) return; // a manual run is in progress; skip this tick, try again next minute

  state.lastRunDateKey = dateKey;
  state.lastScheduledRunAt = now.toISOString();
  try {
    const run = await collector.runCollection({ triggeredBy: 'scheduled' });
    state.lastScheduledRunResult = { status: run.status, run_id: run.run_id };
  } catch (err) {
    state.lastScheduledRunResult = { status: 'FAILED', error: err.message };
  }
}

/** Starts the scheduler loop. Idempotent — calling twice is a no-op. */
function start() {
  if (state.started) return getStatus();
  state.started = true;
  if (state.enabled) {
    // Check once a minute. A minute granularity is enough for a daily job
    // and keeps this dependency-free implementation simple and auditable.
    state.intervalHandle = setInterval(() => {
      tick().catch((err) => console.error('Scheduler tick error:', err));
    }, 60 * 1000);
    if (state.intervalHandle.unref) state.intervalHandle.unref();
    console.log(`Scheduler started: daily collection at ${String(state.hourUTC).padStart(2, '0')}:${String(state.minuteUTC).padStart(2, '0')} UTC`);
  } else {
    console.log('Scheduler disabled (SCHEDULE_ENABLED is not "true"). Manual "Trigger Ingestion" still works.');
  }
  return getStatus();
}

/** Stops the scheduler loop cleanly. Safe to call even if never started. */
function stop() {
  if (state.intervalHandle) clearInterval(state.intervalHandle);
  state.intervalHandle = null;
  state.started = false;
}

function getStatus() {
  return {
    enabled: state.enabled,
    started: state.started,
    schedule_utc: `${String(state.hourUTC).padStart(2, '0')}:${String(state.minuteUTC).padStart(2, '0')}`,
    next_scheduled_run_utc: state.started ? nextRunISO() : null,
    last_scheduled_run_at: state.lastScheduledRunAt,
    last_scheduled_run_result: state.lastScheduledRunResult,
    note: state.enabled
      ? (state.started ? 'Scheduler is active.' : 'Scheduler is enabled but has not been started yet.')
      : 'Scheduler is disabled (SCHEDULE_ENABLED=false). Only manual "Trigger Ingestion" runs will occur.',
  };
}

module.exports = { start, stop, getStatus, tick };
