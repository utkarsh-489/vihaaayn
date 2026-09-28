# Changelog — SIH 2026 MVP hardening pass

This update was applied directly to the existing project. **Nothing was
rebuilt from scratch, no working code was replaced, and no real data was
deleted or overwritten.** The `data/` folder in this ZIP is empty except
`.gitkeep`, exactly as it arrived — your actual `observations.json` and any
raw SerpApi archives were not part of the uploaded ZIP (they're
`.gitignore`'d), so nothing of yours was touched.

## Second pass — Airline Analysis, Heatmap, Coverage, Weekly/Monthly APIx, 30-day back-test

Building on the hardening pass below (scheduler, quality, DGCA scaffolding,
tests), this pass closed the remaining MVP gaps the previous pass had left
as "Not done", **without** touching the route basket, weights, booking
windows, collector, or index formula.

Added:

- **`backend/stats.js`** — reusable mean/median/percentile/group-summary
  functions, used by every module below. Does not replace or alter the
  index engine's own median-based methodology.
- **`backend/airlineAnalysis.js`** + `GET /api/airlines`, `GET
  /api/airline-analysis` — descriptive per-airline statistics (observation
  count, median/mean fare, route and booking-window distribution).
  Observations with no airline recorded are grouped as "Unknown" rather
  than dropped. Airlines are never ranked as best/worst. Samples under 5
  observations are flagged `low_sample: true`.
- **`backend/heatmap.js`** + `GET /api/heatmap` — route x booking-window
  median/mean fare matrix. Empty cells are marked `insufficient_data: true`
  with `null` fares, never interpolated.
- **`backend/coverage.js`** + `GET /api/coverage` — observations by route,
  booking window, and airline; the full route x window matrix; and the
  latest collection run's search success/failure counts.
- **`backend/indexAggregation.js`** + `GET /api/index/daily`, `GET
  /api/index/weekly`, `GET /api/index/monthly` — weekly (ISO week,
  Monday-start UTC) and monthly (calendar month, UTC) APIx as the
  arithmetic mean of already-recorded daily `national_index` values from
  `index_history.json`. Missing days are never invented; periods built from
  fewer than 3 daily entries are flagged `low_confidence: true`.
- **`backend/backtest30.js`** + `GET /api/backtest-30day` — reconstructs the
  last 30 days of genuinely recorded daily index entries, reports which
  calendar days have data vs are missing, and computes MAE/RMSE/MAPE
  against DGCA reference data only when `data/dgca_reference.json` exists
  and overlaps. Reports `INSUFFICIENT_DATA` (not a fabricated result) when
  zero entries exist in the last 30 days.
- New frontend pages: `AirlineAnalysis.jsx`, `HeatmapCoverage.jsx` (also
  hosts the coverage dashboard), `DgcaBacktest.jsx`. Wired into `App.jsx`'s
  nav alongside the existing 6 pages (9 total).
- A descriptive (non-causal, clearly labelled) SVG lead-time chart added to
  the existing `LeadTime.jsx` table — the table itself is unchanged.
- Weekly/monthly APIx tables added to `NationalIndex.jsx`, below the
  existing (unchanged) index-history table.
- `GET /api/methodology` extended with documented weekly/monthly, airline,
  heatmap, and 30-day back-test methodology sections; `Methodology.jsx`
  renders them.
- **8 new tests** added to `tests/backend.test.js` (10 → 18 total, all
  passing in this sandbox), covering `stats.js`, `airlineAnalysis.js`,
  `heatmap.js`, `indexAggregation.js`, and `backtest30.js` directly against
  hand-constructed fixtures in throwaway temp directories (same
  `APIX_DATA_DIR` isolation pattern as the existing tests — real data is
  never touched).

Verified in this pass:

- `npm test` → **18/18 passing**.
- `node --check` on every backend and test `.js` file → all pass (strict
  syntax validation).
- Manual audit read of every new module and page for logic errors.

Not verified in this pass (see "Sandbox limitations" below): a live
`node backend/server.js` HTTP smoke test of the new endpoints, and `npm run
build` for the frontend — both require packages (`express`; `react`/`vite`)
that could not be installed in this offline sandbox.

## Audit findings (before any changes)

- The existing collector (`scripts/serpapi_core.cjs`), storage
  (`backend/storage.js`), index engine (`backend/indexEngine.js`), and API
  routes (`backend/routes.js`) were already well-built: failure-isolated
  collection, exponential-backoff retries, atomic JSON writes, deterministic
  deduplication, and a documented weighted relative-price index. These were
  preserved unchanged in their core logic.
- Missing against the SIH requirements: a daily scheduler (Phase 3),
  automated tests (Phase 10), a data-quality report (Phase 2), and a DGCA
  back-test module (Phase 9).

## Added

- **`backend/scheduler.js`** — dependency-free daily scheduler. Disabled by
  default (`SCHEDULE_ENABLED=false`). UTC-based, idempotent start/stop,
  never runs two collections concurrently, never claims to be active unless
  it genuinely is. Wired into `backend/server.js` (starts once, shuts down
  cleanly on SIGINT/SIGTERM).
- **`backend/quality.js`** — read-only data quality report: missing fields,
  invalid fares, bad dates, unsupported currency, duplicate IDs, and a
  documented IQR-based outlier flag (flag only, never deletes). Exposed at
  `GET /api/quality`.
- **`backend/dgcaBacktest.js`** — DGCA back-test infrastructure + exact JSON
  schema for `data/dgca_reference.json`. Reports `NOT_CONFIGURED` honestly
  when no reference data is supplied — nothing fabricated. Exposed at
  `GET /api/dgca-backtest`.
- **`GET /api/scheduler/status`**, **`GET /api/index-history`** — new
  read-only endpoints.
- **`tests/backend.test.js`** — 10 automated unit tests using Node's
  built-in test runner (`node --test`, zero new dependencies). Covers route
  weights, storage dedup, atomic writes, the index formula against
  hand-calculated expected values, missing-route coverage handling, and the
  quality report. **Result when run in this update: 10/10 passing.**
- **`npm test`** script (`node --test`).

## Changed

- **`backend/collector.js`**:
  - Added `isRunning()` and an overlap guard — a scheduled run and a manual
    "Trigger Ingestion" click can no longer race on `data/*.json` writes;
    the later one is rejected with a clear `REJECTED` status instead.
  - `runCollection()` now accepts `{ triggeredBy }` and records `run_type`
    (`manual` | `scheduled`) on every run.
  - Status is now three-way: `FAILED` (all searches failed) / `ZERO_NEW`
    (searches succeeded, but every observation was already known via
    dedup) / `SUCCESS` (genuinely new data) — previously `ZERO_NEW` and
    `SUCCESS` were conflated.
  - Runs now record `duration_ms`.
- **`backend/config.js`** — `DATA_DIR` can be overridden via `APIX_DATA_DIR`
  (used only by the test suite, so tests can never touch real data; unset
  in normal operation, so production/demo behaviour is unchanged).
- **`backend/routes.js`** — added the new endpoints above; `GET /api/health`
  now also reports total observations and last collection status;
  `GET /api/methodology` now includes an explicit non-official-status
  disclaimer and a DGCA back-test note.
- **`backend/server.js`** — starts/stops the scheduler cleanly.
- **Frontend**: `frontend/src/api.js` gained `getQuality`,
  `getSchedulerStatus`, `getDgcaBacktest`, `getIndexHistory`.
  `CollectionMonitor.jsx` now shows scheduler status, run type, the
  3-way status distinction, and a data-quality summary.
  `NationalIndex.jsx` now shows latest collection time and a real
  (never-fabricated) index history table when more than one snapshot
  exists. `LeadTime.jsx` now states plainly that its comparison is
  descriptive, not causal/predictive. `Methodology.jsx` surfaces the new
  official-status disclaimer and DGCA note. No page was redesigned —
  only additions using the existing visual style.
- **`.env.example`** — added `SCHEDULE_ENABLED`, `SCHEDULE_HOUR_UTC`,
  `SCHEDULE_MINUTE_UTC` (placeholders only, no real key).
- **`README.md`** — added a Windows PowerShell step-by-step quickstart,
  scheduler configuration instructions, DGCA back-test instructions,
  automated-test instructions, the new endpoints in the API table, and
  updated the "Known limitations" section to reflect what's now real vs.
  still pending real data/credentials.

## What was actually run and verified in this update

- `node --test` → **10/10 tests passing** (see `tests/backend.test.js`).
- `node --check` on every modified/new backend `.js` file → no syntax
  errors.
- A direct, in-process dispatch smoke test against every route in
  `backend/routes.js` (health, quality, scheduler/status, dgca-backtest,
  index, collector/status, methodology, corridors, lead-time,
  observations, index-history) → all returned correct JSON shapes.
- `backend/dgcaBacktest.js` tested both with and without a
  `dgca_reference.json` file present → both paths behave as documented.
- `backend/collector.js`'s overlap guard tested with two concurrent
  `runCollection()` calls → the second is correctly `REJECTED`.

## What could NOT be run in this update, and why

This update was made in a sandboxed environment with **no access to the
npm registry** (confirmed: `npm install` returns `403 Forbidden`). As a
result:

- `npm install` for `express` (backend) and `react`/`vite` (frontend) could
  not be executed here, so the real `express`-based HTTP server and
  `vite build` were not run in this sandbox, in either pass. The route
  logic itself was verified via direct dispatch and unit tests against the
  underlying modules, not through real Express — please run `npm install`
  and the manual `curl` steps in the README yourself as the first thing
  you do, including the new endpoints added in the second pass
  (`/api/airline-analysis`, `/api/heatmap`, `/api/coverage`,
  `/api/index/weekly`, `/api/index/monthly`, `/api/backtest-30day`).
- The actual `POST /api/collector/run` against live SerpApi was not (and
  could not safely be) exercised — no SerpApi key exists in this sandbox,
  and this project's own rules forbid ever faking a successful collection
  result.
- No real 24-hour run of the scheduler was observed.
- No DGCA back-test was run — no official DGCA figures were supplied.

## Final status table

| SIH requirement area | Status | Notes |
|---|---|---|
| Preserve working collector/storage/index/routes | **Done** | No working logic replaced |
| Backup / non-destructive to real data | **Done** | `data/` in this ZIP was already empty; nothing deleted |
| Robust API error handling, retries, pacing | **Done** (pre-existing) | Verified by audit, unchanged |
| Normalization schema | **Done** (pre-existing) | Unchanged |
| Collection run metadata | **Done** | Extended with `run_type`, `duration_ms` |
| Atomic storage writes | **Done** (pre-existing) | Verified by test |
| Deduplication, documented key | **Done** (pre-existing) | Verified by test |
| Data quality reporting | **Done** | New `GET /api/quality`, tested |
| Distinguish FAILED / ZERO_NEW / SUCCESS | **Done** | New in this update |
| Daily scheduler | **Partial** | Built, overlap-safe, off by default; not run for 24h live |
| Manual collection | **Done** (pre-existing) | Unchanged |
| Index formula, documented + unit-tested | **Done** | Hand-calculated tests now verify it |
| Missing-route / coverage handling | **Done** | Tested |
| Index history (real snapshots only) | **Done** | New `GET /api/index-history` + UI table |
| Weekly/monthly aggregation | **Done** (this pass) | `GET /api/index/weekly`, `/api/index/monthly` — mean of recorded daily entries, no interpolation, `low_confidence` flag under 3 days |
| Fare component split disclosure | **Done** (pre-existing) | Unchanged |
| Outlier flagging (flag, don't delete) | **Done** | New in this update |
| Dashboard pages (all 6) | **Done**, enhanced | Additions only, no redesign |
| API documentation | **Done** | README table updated |
| API versioning | **Not done** | Not necessary for this MVP's size; noted, not built |
| Health/freshness endpoint | **Done** | `GET /api/health` extended |
| DGCA 30-day back-test | **Partial** (this pass) | `GET /api/backtest-30day` framework built and tested; reports `INSUFFICIENT_DATA` honestly since no real 30-day history or official DGCA data exists yet in this sandbox |
| Airline analysis | **Done** (this pass) | `GET /api/airlines`/`/api/airline-analysis` + `AirlineAnalysis.jsx`, descriptive only, no ranking |
| Heatmap | **Done** (this pass) | `GET /api/heatmap` + heatmap UI in `HeatmapCoverage.jsx` |
| Data coverage dashboard | **Done** (this pass) | `GET /api/coverage` + coverage UI in `HeatmapCoverage.jsx` |
| Lead-time visual chart | **Done** (this pass) | SVG chart added to `LeadTime.jsx`, existing table kept, explicitly non-causal |
| Automated test suite | **Done** | 18/18 passing, `npm test` (10 pre-existing + 8 added this pass) |
| README (Windows PowerShell) | **Done** | Full step-by-step section added |
| `.env.example`, no real keys | **Done** | Verified — placeholders only |
| Final ZIP, no `node_modules`/keys/logs | **Done** | See packaging notes below |

## Remaining blockers (things you must supply — nothing more can be done without them)

1. **A real SerpApi key** — needed to actually run collections and generate
   observations; none was provided or invented here.
2. **Your existing `observations.json` / raw archives**, if you want this
   ZIP's dashboard to show your prior 1,015 observations — they were not
   part of the uploaded ZIP, so copy them back into `data/` yourself.
3. **Official DGCA fare bulletins**, in the `data/dgca_reference.json`
   format documented above, if you want the DGCA back-test to produce an
   actual comparison for your SIH submission.
4. **Running `npm install` and `npm run build` yourself**, on a machine
   with internet access, to get `node_modules` and confirm the frontend
   production build actually succeeds, and that the new pages (Airline
   Analysis, Heatmap / Coverage, DGCA / Back-test) render correctly — none
   of this could be verified in the sandbox either pass was made in.
5. **At least ~30 days of real daily collection runs**, if you want
   `GET /api/backtest-30day` and the weekly/monthly APIx endpoints to show
   more than a single low-confidence data point — the framework is built
   and tested, but it has nothing but its own unit-test fixtures to
   aggregate until real collections accumulate.
