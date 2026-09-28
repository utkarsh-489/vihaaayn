# APIx — Real-time India Airfare Price Index (Simplified MVP)

A clean rebuild of the APIx project: one collector, one ingestion path, real
data only, no placeholders.

## What this project does

APIx collects real one-way economy airfares for 6 major India air corridors,
across 5 booking windows (T+1, T+7, T+15, T+30, T+45), via **Google Flights
through SerpApi**, and computes a simple, transparent, weighted national
airfare price index from the real fares collected.

There is exactly **one** collector implementation (`scripts/serpapi_core.cjs`),
used by both the standalone CLI script and the backend's
`POST /api/collector/run` — no competing or placeholder collection paths.

## Architecture

```
React Dashboard (frontend/)
       |  REST API (/api/*)
       v
Node.js + Express Backend (backend/)
       |
       +-------------------+
       |                   |
       v                   v
scripts/serpapi_core.cjs   backend/indexEngine.js
       |                        ^
       v                        |
Google Flights (via SerpApi)    |
       |                        |
       v                        |
backend/storage.js  ----------->+
(data/*.json)
```

- **Frontend**: React + Vite. Pages: National Index, Corridor Explorer,
  Lead-Time Analysis (with a descriptive fare-vs-window chart), Airline
  Analysis, Heatmap / Coverage, Collection Monitor, Data Provenance,
  DGCA / Back-test, Methodology. The "Trigger Ingestion" button calls
  `POST /api/collector/run`.
- **Backend**: Node.js + Express. `backend/collector.js` is the single
  ingestion pipeline: SerpApi search → normalize → validate → dedupe →
  store → recompute index.
- **Collector core**: `scripts/serpapi_core.cjs` — the only code that talks
  to SerpApi. Reused by `scripts/serpapi_google_flights_collector.cjs`
  (standalone CLI) and `backend/collector.js` (API-triggered).
- **Storage**: plain JSON files in `data/` — no database.

## Quickstart — Windows PowerShell (step by step)

If you're following along on Windows, run these in order from the project
root, in PowerShell:

```powershell
# 1. Install dependencies (needs internet access)
npm install
npm install --prefix frontend

# 2. Set up your SerpApi key
copy .env.example .env
notepad .env   # set SERPAPI_KEY=your_key_here, save, close

# 3. Load the .env into THIS PowerShell session (env vars don't persist
#    across sessions, so re-run this each time you open a new terminal)
Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim())
    }
}

# 4. Run the automated backend tests (no server needed for this step)
npm test

# 5. Run the standalone collector once, to confirm SerpApi actually works
node scripts/serpapi_google_flights_collector.cjs

# 6. Start the backend
npm run server
# Leave this running. Health check in a browser or a second PowerShell tab:
#   curl http://localhost:5000/api/health

# 7. In a SECOND PowerShell tab, start the frontend dev server
npm run client
# Open http://localhost:5173 in your browser

# 8. (Optional) Production build — serves everything from one process
npm run build
npm start
```

To set a single environment variable manually instead of loading `.env`
(e.g. to quickly test without a key):

```powershell
$env:SERPAPI_KEY = "your_key_here"
```

## Requirements

- Node.js 18+ (tested against Node 22)
- A [SerpApi](https://serpapi.com/) key (the **only** required external
  credential — no airline API keys needed)

## Installation

```bash
# from the project root
npm install
npm install --prefix frontend
```

## SerpApi key setup

```bash
cp .env.example .env
# edit .env and set:
# SERPAPI_KEY=your_key_here
```

The backend reads `SERPAPI_KEY` from the environment (via `.env` if you use
a loader like `dotenv -e .env -- npm run server`, or simply export it in
your shell — see below).

## Running

### 1. Run the standalone collector (proven, unchanged behaviour)

```bash
export SERPAPI_KEY=your_key_here     # PowerShell: $env:SERPAPI_KEY="your_key_here"
npm run collector
```

This performs 6 routes × 5 windows = 30 SerpApi searches and writes:
- `data/scraped/serpapi_6routes_5windows.json`
- `data/scraped/serpapi_collection_log.json`
- `data/raw/<timestamp>_<route>_<window>.json` (verbatim SerpApi responses)

### 2. Run the backend

```bash
export SERPAPI_KEY=your_key_here
npm run server
```

Backend listens on `http://localhost:5000`. Health check:
`GET http://localhost:5000/api/health`.

### 3. Run the frontend (development)

```bash
npm run client
```

Vite dev server on `http://localhost:5173`, proxying `/api/*` to the
backend on port 5000 (see `frontend/vite.config.js`).

Or run both backend and frontend together:

```bash
npm run dev
```

### 4. Production build

```bash
npm run build   # builds frontend/dist
npm start       # serves the API and the built frontend from one process
```

## Daily scheduled collection (optional)

Disabled by default — manual "Trigger Ingestion" always works regardless of
this setting. To turn on a daily automatic collection, set in `.env`:

```
SCHEDULE_ENABLED=true
SCHEDULE_HOUR_UTC=3
SCHEDULE_MINUTE_UTC=0
```

Notes:
- The time is always **UTC** (avoids local-timezone/DST confusion on
  whatever machine ends up hosting the server).
- The scheduler starts exactly once per server process and shuts down
  cleanly on Ctrl+C. `GET /api/scheduler/status` always tells you the truth
  about whether it's actually active — it never claims to be running if
  `SCHEDULE_ENABLED` is false or the server hasn't started it yet.
- A scheduled run and a manual "Trigger Ingestion" click can never run at
  the same time; whichever started first wins and the other is rejected
  with a clear message rather than corrupting `data/*.json`.

## DGCA back-test (optional, requires you to supply official data)

The SIH problem statement asks for a 30-day back-test against **publicly
available DGCA monthly average domestic-fare data**. This project ships the
infrastructure for that comparison but does **not** ship any DGCA figures —
none were provided, and DGCA publishes bulletins as PDF/Excel, not a queryable
API, so nothing can be safely auto-fetched here.

To run a real back-test:

1. Find the relevant DGCA monthly domestic-fare bulletin(s) for your basket
   routes and months.
2. Create `data/dgca_reference.json` in this shape:
   ```json
   [
     {
       "route": "DEL-BOM",
       "month": "2026-08",
       "dgca_average_fare_inr": 5200,
       "source_document": "DGCA domestic traffic/fare bulletin, August 2026"
     }
   ]
   ```
3. Call `GET /api/dgca-backtest` — it will compare your DGCA figures against
   this project's own median fares for any overlapping route/month you have
   real observations for, and report `PARTIAL`/`REFERENCE_ONLY_NO_OVERLAP`
   accordingly. Until step 2 is done, this endpoint honestly reports
   `NOT_CONFIGURED`.

**Important caveat, always shown in the response:** DGCA publishes *monthly
average* fares; this project measures *median* fares for specific T+n
booking windows on specific quote dates. A match is a directional
cross-check, not proof the two measure the same thing.

## Airline analysis, heatmap, coverage, weekly/monthly APIx, 30-day back-test

These were added on top of the existing verified core without touching the
route basket, weights, booking windows, collector, or index formula:

- **Airline analysis** (`GET /api/airlines`, `/api/airline-analysis`) —
  descriptive statistics per airline (observation count, median/mean fare,
  route and booking-window distribution). Airlines are **never** ranked as
  "best" or "worst" — a single economy fare search on specific dates is not
  a basis for that. Any airline with fewer than 5 observations is flagged
  `low_sample: true` so its numbers are read as indicative, not authoritative.
- **Heatmap** (`GET /api/heatmap`) — a route x booking-window median/mean
  fare matrix. A cell with no observations is marked `insufficient_data:
  true` with `null` fares — nothing is interpolated from neighboring cells.
- **Data coverage dashboard** (`GET /api/coverage`) — observations by route,
  by booking window, by airline, the full route x window matrix, and the
  latest collection run's search success/failure counts, all derived from
  what is actually in storage.
- **Weekly / monthly APIx** (`GET /api/index/weekly`, `/api/index/monthly`)
  — the arithmetic mean of the already-computed **recorded** daily
  `national_index` values (from `index_history.json`) grouped into ISO-8601
  weeks (Monday start, UTC) or calendar months (UTC). Missing days are never
  invented; each period reports `daily_count` and is flagged
  `low_confidence: true` when built from fewer than 3 daily entries. This is
  a straight average over real snapshots, not a re-weighted recompute
  against underlying fares.
- **30-day back-test** (`GET /api/backtest-30day`) — reconstructs the last
  30 days of genuinely recorded daily index entries, reports exactly which
  calendar days in that window have data and which don't, and — only if
  `data/dgca_reference.json` has been supplied — computes MAE/RMSE/MAPE
  between this project's route medians and the DGCA reference figures for
  any overlapping month. With zero recorded entries in the last 30 days it
  reports `INSUFFICIENT_DATA` and explains why, rather than fabricating a
  result.

None of these five features required changing `backend/collector.js`'s
normalization/validation logic, `backend/indexEngine.js`'s formula, or
`scripts/serpapi_core.cjs` — they are read-only aggregations over data that
already exists in storage.

## Testing (recommended order)

```bash
# 1. Standalone collector
export SERPAPI_KEY=your_key_here
npm run test:collector
# Expect: 30 planned searches, 6 routes, 5 windows, successful/failed counts

# 2. Backend health
npm run server &
curl http://localhost:5000/api/health
# Expect: {"status":"ok",...}

# 3. Trigger ingestion via the API (same collector as the CLI)
curl -X POST http://localhost:5000/api/collector/run
# Expect: {"status":"SUCCESS","routes":6,"windows":5,"searches":30,...}

# 4. Read endpoints
curl http://localhost:5000/api/observations
curl http://localhost:5000/api/collector/status
curl http://localhost:5000/api/corridors
curl http://localhost:5000/api/lead-time
curl http://localhost:5000/api/index
curl http://localhost:5000/api/airline-analysis
curl http://localhost:5000/api/heatmap
curl http://localhost:5000/api/coverage
curl http://localhost:5000/api/index/weekly
curl http://localhost:5000/api/index/monthly
curl http://localhost:5000/api/backtest-30day

# 5. Open the dashboard, click "Trigger Ingestion", confirm it updates with
#    real observation counts (same backend call as step 3).
```

## Automated unit tests

```bash
npm test
```

This runs `tests/backend.test.js` using Node's **built-in** test runner
(`node --test` — no new npm dependency was added just to run tests). It
covers: route weights summing to exactly 100%, storage deduplication
(exact repeats removed, genuinely distinct fares kept), atomic-write
behaviour, the index-engine formula against hand-calculated expected values
(base period = 100, a known single-route change moving the national index
by exactly its weight, missing-route exclusion from coverage), `median()`
edge cases, and the data-quality report's issue flags.

The suite points storage at a **throwaway temp directory** for the whole
run (via an internal `APIX_DATA_DIR` override) — it can never read, modify,
or delete your real `data/observations.json`.

Expected output: `# pass 18` / `# fail 0`. (These were run and verified
during this update — see the changelog for the exact result.)

**Known gap, stated plainly:** the test suite covers `backend/config.js`,
`backend/storage.js`, `backend/indexEngine.js`, `backend/quality.js`,
`backend/collector.js`'s overlap guard, and the newer `backend/stats.js`,
`backend/airlineAnalysis.js`, `backend/heatmap.js`,
`backend/indexAggregation.js`, and `backend/backtest30.js` modules directly
(18 tests total, all passing in this sandbox). It does **not** exercise
`backend/routes.js` end-to-end through real HTTP, and the frontend has not
been built or rendered, because both require packages (`express` for the
backend; `react`/`vite` for the frontend) that could not be installed in
the offline sandbox this update was made in (no npm registry access — `npm
install` returns `403 Forbidden`). Every backend and test file was still
verified with `node --check` (strict syntax validation) and passed. Run
`npm install` on your own machine (which has internet access), then the
manual test steps above (`curl http://localhost:5000/api/health`, the new
endpoints below, etc.) and `npm run build` cover that gap — please run them
once and confirm before your demo.

## API endpoints

| Method | Path                   | Description                                   |
|--------|------------------------|------------------------------------------------|
| GET    | `/api/health`          | Health check + total observations + last collection status |
| GET    | `/api/observations`    | Stored observations (filter by `route`, `window`) |
| GET    | `/api/index`           | Latest national index                          |
| GET    | `/api/index-history`   | Every recorded index snapshot (real ones only — never interpolated) |
| GET    | `/api/corridors`       | Per-route median fares + per-window breakdown  |
| GET    | `/api/lead-time`       | Fare by booking window (optionally filtered by `route`) |
| GET    | `/api/collector/status`| Most recent collection run (status, run type, timing, counts) |
| POST   | `/api/collector/run`   | **Triggers a fresh 30-search collection** (the "Trigger Ingestion" endpoint). Returns `REJECTED` if a run is already in progress (manual or scheduled) — it never lets two runs race. |
| GET    | `/api/scheduler/status`| Whether daily scheduled collection is enabled/started, next/last run |
| GET    | `/api/quality`         | Data quality report: missing/invalid fields, outlier flags, route/window coverage. Read-only — never deletes or edits stored data. |
| GET    | `/api/dgca-backtest`   | Compares project medians to official DGCA figures, IF you've supplied `data/dgca_reference.json` (see "DGCA back-test" below). Reports `NOT_CONFIGURED` otherwise — never fabricated. |
| GET    | `/api/provenance`      | Sample of recent observations with source metadata |
| GET    | `/api/airlines` / `/api/airline-analysis` | Descriptive per-airline stats (median/mean fare, route & booking-window distribution). Never ranks airlines. |
| GET    | `/api/heatmap`         | Route x booking-window median/mean fare matrix. Empty cells marked `insufficient_data`, never fabricated. |
| GET    | `/api/coverage`        | Data coverage dashboard: observations by route/window/airline, route x window matrix, latest run summary |
| GET    | `/api/index/daily`     | Full recorded daily index history (alias of `/api/index-history`) |
| GET    | `/api/index/weekly`    | ISO-week mean of recorded daily indices. No interpolation of missing days. |
| GET    | `/api/index/monthly`   | Calendar-month mean of recorded daily indices. No interpolation of missing days. |
| GET    | `/api/backtest-30day`  | 30-day back-test: observed daily index entries, missing-day coverage, MAE/RMSE/MAPE vs DGCA reference (if configured). Reports `INSUFFICIENT_DATA` otherwise. |
| GET    | `/api/methodology`     | Route weights, booking windows, index formula, weekly/monthly/heatmap/airline/backtest methodology, official-status disclaimer |

Every response above is real JSON straight from `data/*.json` — nothing is
computed ahead of time or cached beyond what's already in storage.

## Route basket & weights (fixed, per project spec)

| Route   | Weight |
|---------|--------|
| DEL-BOM | 26%    |
| DEL-BLR | 22%    |
| BOM-BLR | 18%    |
| DEL-CCU | 14%    |
| MAA-DEL | 12%    |
| BLR-HYD | 8%     |

## Booking windows

T+1, T+7, T+15, T+30, T+45 — travel dates are always computed dynamically
from the collection date, never hard-coded.

## Data model (one observation)

```json
{
  "id": "uuid",
  "route": "DEL-BOM",
  "origin": "DEL",
  "destination": "BOM",
  "airline": "IndiGo",
  "flight_numbers": ["6E 322"],
  "departure": "2026-09-27 06:15",
  "arrival": "2026-09-27 08:25",
  "stops": 0,
  "booking_window": "T+1",
  "travel_date": "2026-09-27",
  "collection_date": "2026-09-26",
  "total_fare": 6474,
  "base_fare": null,
  "taxes_fees": null,
  "total_fare_only": true,
  "source": "Google Flights via SerpApi",
  "collected_at": "2026-09-26T10:15:00.000Z"
}
```

`base_fare` and `taxes_fees` are **always null** — SerpApi does not reliably
expose that split, and this project never invents one. Every observation is
marked `total_fare_only: true`.

## Index methodology

A simple, transparent weighted relative-price index (see `/api/methodology`
for the machine-readable version, and the in-app Methodology page):

1. For each of the 6 basket routes, take the median `total_fare` across all
   stored observations for that route.
2. The **first** successful collection run establishes the base period:
   each route's median becomes its `base_median`, and the national index is
   defined as **100.0**.
3. On every later run: `relative_index = (current_median / base_median) * 100`
   for each route.
4. `national_index = weighted average of relative_index across routes`,
   weighted by each route's traffic weight, normalized to only the routes
   that currently have data.
5. A route with no observations yet is excluded from the weighted sum and
   from the coverage percentage — nothing is fabricated for missing routes.

No historical data is ever fabricated. With fewer than 2 collection runs,
only the base index (100.0) can be reported.

## Known limitations

- **No fake data, ever.** If a corridor/window has no real observations yet,
  endpoints return `null`/`N/A` or `INSUFFICIENT_DATA` rather than inventing
  numbers.
- **No base/tax breakdown.** SerpApi only reliably provides total fare.
- **Scheduler exists but is disabled by default.** `backend/scheduler.js`
  calls the exact same `collector.runCollection()` function manual ingestion
  uses (never a second implementation) and is overlap-safe, but you must
  set `SCHEDULE_ENABLED=true` yourself — see "Daily scheduled collection"
  above. It has not been run unattended for a real 24-hour period as part
  of this update; verify it once on your machine before relying on it.
- **DGCA back-test infrastructure exists, but no DGCA data is bundled.**
  `GET /api/dgca-backtest` will honestly report `NOT_CONFIGURED` until you
  supply `data/dgca_reference.json` yourself — see "DGCA back-test" above.
  No 30-day back-test has been run; that requires official figures this
  project was not given.
- JSON-file storage is intentionally simple for the MVP; if this needs to
  scale past a demo, swap `backend/storage.js` for a real database without
  touching the collector or index engine.
- **This update was made in an offline sandbox with no npm registry
  access.** `backend/`, `tests/`, and pure-JS logic were run and verified
  directly with Node (see the changelog). `npm install` for `express` and
  the frontend's `react`/`vite` packages, and `npm run build` for the
  frontend, could **not** be executed here — run them yourself as the very
  first step and confirm they succeed before your demo.

## Troubleshooting

- **`SERPAPI_KEY is not set`** — export it in your shell or load it via
  `.env` before running the collector or the backend.
- **`POST /api/collector/run` returns `FAILED` with 0 searches** — the
  `SERPAPI_KEY` environment variable isn't visible to the backend process;
  restart the backend after exporting it.
- **SerpApi 401/403** — the key is invalid or exhausted; check your SerpApi
  dashboard.
- **Trigger Ingestion shows 0 observations while the CLI got real ones** —
  this should not happen (both use `scripts/serpapi_core.cjs`); if it does,
  confirm the backend process has `SERPAPI_KEY` set in its own environment.
