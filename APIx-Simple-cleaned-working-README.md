# APIx / विहाय — Real-time India Airfare Price Index

This README is the **Windows execution guide** for the supplied `APIx-Simple-cleaned-working` ZIP.

The project contains:

- **Frontend:** React + Vite
- **Backend:** Node.js + Express
- **Collector:** Google Flights data through SerpApi
- **Storage:** JSON files under `data/`
- **Route basket:** 6 India corridors
- **Booking windows:** T+1, T+7, T+15, T+30, T+45
- **Dashboard:** National Index, Corridor Explorer, Lead-Time Analysis, Airline Analysis, Heatmap/Coverage, Collection Monitor, Data Provenance, Reference/Back-test, Methodology

> **Important:** This project requires Node.js 18 or newer and a valid SerpApi API key for fresh live collection.

---

## 1. Extract the ZIP

Extract the ZIP to a convenient location, for example:

```text
C:\Users\<YOUR_USERNAME>\Downloads\APIx-Simple-cleaned-working
```

After extraction, the actual project root should contain:

```text
APIx-Simple-cleaned-working\
├── backend\
├── frontend\
├── scripts\
├── data\
├── tests\
├── package.json
├── .env.example
└── .env
```

If you see another `APIx-Simple-cleaned-working` folder inside the first one, open the **inner folder** that contains `package.json`.

---

## 2. Open the project in VS Code

Open the folder containing the root `package.json`.

Open **Terminal → New Terminal**.

Then run:

```powershell
cd "C:\Users\<YOUR_USERNAME>\Downloads\APIx-Simple-cleaned-working\APIx-Simple-cleaned-working"
```

Replace the path with your actual extracted project path.

Verify that the correct folder is open:

```powershell
Get-ChildItem package.json
```

If `package.json` is found, you are in the correct directory.

---

## 3. Windows PowerShell: use `npm.cmd`

On some Windows systems, PowerShell blocks `npm.ps1` because of the execution policy.

If you see:

```text
npm.ps1 cannot be loaded because running scripts is disabled on this system
```

use **`npm.cmd` instead of `npm`**.

Examples:

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd test
npm.cmd run build
npm.cmd start
```

This avoids changing your PowerShell execution policy.

---

## 4. Check Node.js

Run:

```powershell
node --version
```

Recommended:

```text
v18+
```

Also check npm:

```powershell
npm.cmd --version
```

---

## 5. Install dependencies

From the project root:

```powershell
npm.cmd install
```

Then install the frontend dependencies:

```powershell
npm.cmd install --prefix frontend
```

You only need to do this once after extracting the project, unless dependencies are changed.

---

## 6. Configure SerpApi

The only external credential required for live collection is:

```text
SERPAPI_KEY
```

### Option A — use the supplied `.env`

If the extracted project already contains `.env`, do **not** paste the key into GitHub or into this README.

The project code reads the API key from the process environment, so load the `.env` value into your current PowerShell session before starting the backend.

Run:

```powershell
$env:SERPAPI_KEY = ((Get-Content .env | Where-Object { $_ -match '^\s*SERPAPI_KEY\s*=' } | Select-Object -First 1) -replace '^\s*SERPAPI_KEY\s*=\s*', '').Trim().Trim('"').Trim("'")
```

Verify without displaying the key:

```powershell
if ([string]::IsNullOrWhiteSpace($env:SERPAPI_KEY)) { "SERPAPI_KEY = MISSING" } else { "SERPAPI_KEY = LOADED" }
```

You want:

```text
SERPAPI_KEY = LOADED
```

### Option B — enter the key without storing it in `.env`

Use:

```powershell
$env:SERPAPI_KEY = Read-Host "Enter your SerpApi key"
```

Then verify:

```powershell
if ([string]::IsNullOrWhiteSpace($env:SERPAPI_KEY)) { "SERPAPI_KEY = MISSING" } else { "SERPAPI_KEY = LOADED" }
```

The variable exists only in the current PowerShell session. If you open a new terminal, load it again.

### Security

- Never commit `.env` to GitHub.
- Keep real API keys out of `.env.example`, screenshots, PPTs, READMEs, and source code.
- If a key has been exposed publicly, revoke/rotate it and create a new key.

---

## 7. Run the automated tests (optional but recommended)

Run:

```powershell
npm.cmd test
```

The supplied project test suite is expected to report all tests passing in a normal installed environment.

---

## 8. Start the complete application

The easiest Windows development command is:

```powershell
npm.cmd run dev
```

This starts both:

```text
Backend  → http://localhost:5000
Frontend → http://localhost:5173
```

If port `5173` is already occupied, Vite automatically chooses another port, for example:

```text
http://localhost:5174
```

Always use the exact **Local:** URL printed by Vite.

Keep the terminal running while using the application.

---

## 9. Open the dashboard

Open the frontend URL printed by Vite, normally:

```text
http://localhost:5173
```

The dashboard contains:

1. National Index
2. Corridor Explorer
3. Lead-Time Analysis
4. Airline Analysis
5. Heatmap / Coverage
6. Collection Monitor
7. Data Provenance
8. Reference / Back-test
9. Methodology

The supplied ZIP includes existing JSON data under `data/`, so the dashboard can show previously collected observations without performing a new collection.

---

## 10. Verify the backend health

Open a second PowerShell terminal or browser and run:

```powershell
Invoke-RestMethod http://localhost:5000/api/health | ConvertTo-Json
```

A healthy backend returns JSON with:

```json
{
  "status": "ok"
}
```

The response also reports observation count and the last collection status.

---

## 11. Run a fresh live collection from the dashboard

Make sure the backend was started **after** `SERPAPI_KEY` was loaded into the same PowerShell session.

Then open the dashboard and click:

```text
Run Collection
```

The configured collection performs:

```text
6 routes × 5 booking windows = 30 SerpApi searches
```

Booking windows:

```text
T+1
T+7
T+15
T+30
T+45
```

A successful run should return information such as:

```text
status: SUCCESS
routes: 6
windows: 5
searches: 30
successful_searches: 30
failed_searches: 0
observations_added: <number>
```

A full collection can take a couple of minutes depending on SerpApi response time and retry behaviour.

---

## 12. Run the collector directly from PowerShell

To test the live collector without using the dashboard:

```powershell
npm.cmd run collector
```

This uses the same SerpApi collector core used by the backend ingestion path.

---

## 13. Trigger collection directly through the backend API

Start the backend first:

```powershell
npm.cmd start
```

Keep that terminal running.

Then, from a second PowerShell terminal, run:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:5000/api/collector/run" -ContentType "application/json" -Body '{"corridor":"ALL","window":"ALL"}' | ConvertTo-Json -Depth 10
```

Expected successful structure:

```text
status: SUCCESS
routes: 6
windows: 5
searches: 30
successful_searches: 30
failed_searches: 0
```

---

## 14. Important: do not start the backend twice

If you see:

```text
EADDRINUSE: address already in use :::5000
```

port `5000` is already being used by another backend process.

Do **not** start another `npm.cmd start`.

First check that the existing backend is healthy:

```powershell
Invoke-RestMethod http://localhost:5000/api/health | ConvertTo-Json
```

If it returns:

```text
status: ok
```

the backend is already running.

---

## 15. Important: the API key must be loaded before starting Node

This is a common error:

```text
SERPAPI_KEY is not set in the environment.
```

The correct order is:

```text
1. Open PowerShell
2. cd into the project root
3. Load SERPAPI_KEY
4. Verify SERPAPI_KEY = LOADED
5. Start the backend
6. Start/open the frontend
7. Click Run Collection
```

If you load the key **after** the backend has already started, the existing Node process will not automatically receive it. Restart the backend after loading the key.

---

## 16. If the frontend says `Failed to fetch`

Check the backend first:

```powershell
Invoke-RestMethod http://localhost:5000/api/health | ConvertTo-Json
```

If that fails, the backend is not reachable on port `5000`.

If the health check succeeds but the frontend still says `Failed to fetch`, make sure you are opening the **Vite Local URL** printed by the frontend terminal.

---

## 17. If the dashboard shows no observations

The project reads stored observations from:

```text
data/observations.json
```

Also check:

```text
data/index_history.json
data/collection_runs.json
data/mospi_airfare_reference.json
```

A fresh deployment on a cloud platform may not have the same local JSON filesystem as your computer. For a local demo, the supplied `data/` directory is the source of the existing observations.

---

## 18. Useful API endpoints

### Health

```text
GET http://localhost:5000/api/health
```

### Latest index

```text
GET http://localhost:5000/api/index
```

### Observations

```text
GET http://localhost:5000/api/observations
```

### Collector status

```text
GET http://localhost:5000/api/collector/status
```

### Trigger collection

```text
POST http://localhost:5000/api/collector/run
```

### Coverage

```text
GET http://localhost:5000/api/coverage
```

### Airline analysis

```text
GET http://localhost:5000/api/airline-analysis
```

### Heatmap

```text
GET http://localhost:5000/api/heatmap
```

### Lead time

```text
GET http://localhost:5000/api/lead-time
```

### Weekly index

```text
GET http://localhost:5000/api/index/weekly
```

### Monthly index

```text
GET http://localhost:5000/api/index/monthly
```

### 30-day back-test endpoint

```text
GET http://localhost:5000/api/backtest-30day
```

### Methodology

```text
GET http://localhost:5000/api/methodology
```

---

## 19. Production build on a local machine

To build the React frontend:

```powershell
npm.cmd run build
```

The frontend output will be created at:

```text
frontend/dist
```

To run the Express backend together with the built frontend:

```powershell
npm.cmd start
```

Then open:

```text
http://localhost:5000
```

---

## 20. Optional daily scheduler

The scheduler is disabled by default.

To enable it, set:

```text
SCHEDULE_ENABLED=true
SCHEDULE_HOUR_UTC=3
SCHEDULE_MINUTE_UTC=0
```

Then restart the backend.

Manual `Run Collection` works regardless of the scheduler setting.

---

## 21. Project architecture

```text
                    ┌───────────────────────┐
                    │     React + Vite       │
                    │     frontend/          │
                    └───────────┬───────────┘
                                │ /api/*
                                ▼
                    ┌───────────────────────┐
                    │ Node.js + Express      │
                    │ backend/server.js      │
                    └───────────┬───────────┘
                                │
                     ┌──────────┴──────────┐
                     ▼                     ▼
          ┌──────────────────┐   ┌──────────────────┐
          │ SerpApi collector │   │ Index / analytics │
          │ scripts/*.cjs     │   │ backend/*.js     │
          └─────────┬────────┘   └────────┬─────────┘
                    │                     │
                    └──────────┬──────────┘
                               ▼
                     ┌──────────────────┐
                     │ JSON storage     │
                     │ data/*.json      │
                     └──────────────────┘
```

---

## 22. Fixed route basket

| Route | Weight |
|---|---:|
| DEL-BOM | 26% |
| DEL-BLR | 22% |
| BOM-BLR | 18% |
| DEL-CCU | 14% |
| MAA-DEL | 12% |
| BLR-HYD | 8% |

Total weight = 100%.

---

## 23. Index methodology

The project computes a transparent weighted relative-price index.

1. For each basket route, calculate the median observed total fare.
2. The first successful collection establishes the base period.
3. Route relative index is:

```text
relative_index = (current_route_median / base_route_median) × 100
```

4. The national index is the traffic-weighted average of the available route relative indices.
5. Routes with no observations are excluded rather than fabricated.

The project records only observed data. It does not invent missing fares.

---

## 24. Data and fare caveat

The current collector uses **total observed fare** from Google Flights via SerpApi.

The project does not invent a base-fare/tax split when that split is not reliably exposed by the source. In those cases:

```text
base_fare = null
taxes_fees = null
total_fare_only = true
```

---

## 25. DGCA reference/back-test

The project contains infrastructure for a DGCA comparison, but a real back-test requires an appropriate official DGCA reference dataset to be supplied separately.

The endpoint is:

```text
GET /api/dgca-backtest
```

and the extended 30-day endpoint is:

```text
GET /api/backtest-30day
```

Do not treat an unconfigured/reference-only result as proof of a completed official 30-day validation.

---

## 26. Recommended demo workflow

For an SIH/demo presentation:

### Start

```powershell
cd "C:\path\to\APIx-Simple-cleaned-working"
```

### Install

```powershell
npm.cmd install
npm.cmd install --prefix frontend
```

### Load key

```powershell
$env:SERPAPI_KEY = Read-Host "Enter your SerpApi key"
```

### Verify key

```powershell
if ([string]::IsNullOrWhiteSpace($env:SERPAPI_KEY)) { "SERPAPI_KEY = MISSING" } else { "SERPAPI_KEY = LOADED" }
```

### Run tests

```powershell
npm.cmd test
```

### Start both services

```powershell
npm.cmd run dev
```

### Open the dashboard

Use the Vite `Local:` URL shown in the terminal.

### Run a fresh collection

Click **Run Collection**.

### Verify backend result

```powershell
Invoke-RestMethod http://localhost:5000/api/health | ConvertTo-Json
```

---

## 27. Quick troubleshooting table

| Problem | Solution |
|---|---|
| `npm.ps1 cannot be loaded` | Use `npm.cmd` instead of `npm` |
| `package.json` not found | `cd` into the folder containing the root `package.json` |
| `Port 5000 is already in use` | The backend is probably already running; test `/api/health` before starting another one |
| `Port 5173 is in use` | Vite will normally switch to 5174 or another available port |
| `SERPAPI_KEY is not set` | Load the key and restart the backend |
| `Failed to fetch` in UI | Confirm `http://localhost:5000/api/health` works and use the Vite Local URL |
| Collection returns 401/403 | Check/rotate the SerpApi key and account quota |
| Collection is slow | A full 30-search run can take a few minutes; wait for the response |
| Dashboard has no data | Check the local `data/` directory and run a successful collection |
| Cloud deployment loses JSON data | Local JSON storage is not durable cloud database storage; use persistent/external storage for production |

---

## 28. Stop the project

In the terminal running the combined development server:

```text
Ctrl + C
```

If Windows asks:

```text
Terminate batch job (Y/N)?
```

enter:

```text
Y
```

---

## 29. Final checklist before a demo

```text
[ ] Node.js 18+ installed
[ ] Correct project root opened
[ ] npm.cmd install completed
[ ] frontend dependencies installed
[ ] SERPAPI_KEY loaded
[ ] SERPAPI_KEY verification says LOADED
[ ] npm.cmd test passes
[ ] backend health endpoint returns status=ok
[ ] frontend opens at the Vite Local URL
[ ] existing dashboard data appears
[ ] fresh Run Collection succeeds if live collection is needed
[ ] no API key is present in screenshots/PPT/GitHub
```

---

## License / project status

This repository is a simplified MVP/prototype for the India Airfare Price Index concept. Read the in-app Methodology page and API responses for the exact assumptions, data-source limitations, and validation status before presenting results as official statistics.
