# NAVDRISHTI VEGA-Pilot

NAVDRISHTI VEGA-Pilot is a browser-based ground control station dashboard for
viewing drone mission and telemetry information.

The current project runs with a simulated telemetry provider. It is prepared
for future ARIES V3 and wireless telemetry integration, but it does not connect
to flight hardware by default.

## 1. Project overview

### What it does

The project provides:

- A React dashboard for mission status and live telemetry.
- A Leaflet map showing the simulated aircraft position and mission route.
- Sensor health and fault alerts.
- Battery, altitude, speed and attitude values.
- Live telemetry over a WebSocket connection.
- A SQLite-backed log viewer with filtering, charts and CSV export.
- A backend diagnostics page for viewing raw telemetry-provider messages.
- A simulation provider for development without hardware.
- Prepared, disabled-by-default serial and optional MAVLink provider interfaces.

### Why it was developed

The project gives operators and developers a single interface for monitoring
drone telemetry and mission information. Simulation makes it possible to
develop and test the dashboard before ARIES V3 hardware and wireless-link
specifications are available.

### Who can use it

- Frontend developers working on the dashboard.
- Backend developers adding telemetry providers.
- Testers validating telemetry, logs and connection recovery.
- Flight-system integrators preparing a future hardware connection.

### Current safety boundary

The current project does not implement arming, disarming, motor control,
Return-to-Home commands or mission-abort commands. The dashboard contains
display-only status controls for those areas; they are not connected to a
flight controller.

## 2. Technologies used

| Technology | Where it is used | Purpose |
|---|---|---|
| Python 3.13 | Backend | Runs the telemetry API and providers. |
| FastAPI | `backend/` | Defines HTTP API and WebSocket endpoints. |
| Uvicorn | Backend startup | Runs the FastAPI application. |
| Pydantic 2 | `backend/models.py` | Validates typed telemetry and API data. |
| PySerial | `backend/providers.py` | Optional serial telemetry input. It is disabled by default. |
| Pymavlink | Optional future provider | Not installed or enabled until a compatible MAVLink source is confirmed. |
| SQLite | `data/vega_pilot.db` | Stores telemetry, fault and system-event logs locally. |
| pytest | `backend/tests/` | Runs backend tests. |
| React 19 | `frontend/` | Builds the dashboard user interface. |
| TypeScript | `frontend/src/` | Adds static types to frontend code. |
| Vite | `frontend/` | Runs the frontend development server and production build. |
| Leaflet / React Leaflet | Dashboard map | Displays the route, waypoints and simulated aircraft marker. |
| Recharts | Dashboard and Logs page | Displays telemetry history charts. |
| Tailwind CSS | Frontend build | Provides utility styling support. |
| Oxlint | Frontend | Lints frontend code. |
| Lucide React | Frontend | Supplies dashboard icons. |
| WebSockets | Frontend and backend | Streams telemetry and diagnostic messages. |

There is no external database service, AI/ML model, API key, cloud service or
authentication service configured in the current code.

## 3. Project folder structure

Generated folders such as `node_modules`, `.venv`, `frontend/dist` and
`.pytest_cache` are intentionally omitted below.

```text
Navdrishti---NIDAR-VEGAPilot/
├── README.md
├── conftest.py
├── pytest.ini
├── backend/
│   ├── __init__.py
│   ├── main.py
│   ├── models.py
│   ├── providers.py
│   ├── simulation.py
│   ├── database.py
│   ├── recorder.py
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   ├── README.md
│   └── tests/
│       ├── conftest.py
│       ├── test_api.py
│       ├── test_database.py
│       └── test_providers.py
├── data/
│   └── vega_pilot.db          # created automatically while the backend runs
└── frontend/
    ├── package.json
    ├── package-lock.json
    ├── vite.config.ts
    ├── index.html
    ├── README.md
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── components/
        │   ├── MissionMap.tsx
        │   ├── MissionPanels.tsx
        │   ├── TelemetryPanels.tsx
        │   └── Panel.tsx
        ├── pages/
        │   ├── DashboardPage.tsx
        │   └── LogsPage.tsx
        ├── services/
        │   ├── telemetry.tsx
        │   └── logs.ts
        └── types/
            └── index.ts
```

### Main application files

- `backend/main.py` creates the FastAPI app, starts recording, exposes
  endpoints and streams telemetry.
- `backend/models.py` defines the validated telemetry shape.
- `backend/providers.py` defines the provider interface and simulation, serial
  and optional MAVLink adapters.
- `backend/simulation.py` produces changing simulated telemetry and faults.
- `backend/database.py` creates and queries the SQLite log store.
- `backend/recorder.py` stores telemetry, faults and link events.
- `frontend/src/main.tsx` mounts the React app and shared telemetry provider.
- `frontend/src/services/telemetry.tsx` owns the single frontend WebSocket
  connection, validation, reconnection and stale-packet detection.
- `frontend/src/pages/DashboardPage.tsx` renders the dashboard.
- `frontend/src/pages/LogsPage.tsx` retrieves and displays stored records.

## 4. How the project works

### Architecture

```text
SimulationProvider
        │
        │ validated Telemetry objects
        ▼
Python FastAPI backend ───────► SQLite log store
        │
        ├── HTTP /api/* endpoints
        ├── WebSocket /ws/telemetry
        └── WebSocket /ws/diagnostics
                │
                ▼
        React telemetry context
                │
                ├── Dashboard panels
                ├── Leaflet aircraft marker
                ├── Recharts graphs
                └── Logs page through HTTP
```

### Startup and data flow

1. The backend starts with the `simulation` provider unless
   `VEGA_TELEMETRY_PROVIDER` is changed.
2. FastAPI creates the local SQLite database under `data/vega_pilot.db` when
   needed.
3. The backend recorder stores telemetry packets, fault events and link
   transitions.
4. The React app starts one shared WebSocket connection to
   `ws://localhost:8000/ws/telemetry`.
5. The frontend validates each JSON packet before using it.
6. Dashboard components read the latest packet from the shared telemetry
   context.
7. The map uses the packet's GNSS latitude and longitude.
8. The live charts use timestamped packets kept in frontend history.
9. The Logs page calls the backend HTTP log endpoints and refreshes
   periodically when auto-refresh is enabled.

## 5. Prerequisites

Install the following on the development computer:

| Requirement | Recommended/current version | Check command |
|---|---:|---|
| Python | 3.13.x | `py --version` |
| Node.js | A current LTS release | `node --version` |
| npm | Installed with Node.js | `npm --version` |
| Git | Any recent version, if cloning | `git --version` |

Python 3.13.7 was used while validating the backend. The project uses Python
features supported by modern Python 3 versions.

No MySQL, PostgreSQL, Redis or other database server is required. SQLite is
provided by Python.

## 6. Installation and setup

### 6.1 Open or clone the project

If the project is already on the computer, open a PowerShell terminal in the
project root:

```powershell
cd "C:\path\to\Navdrishti---NIDAR-VEGAPilot"
```

If you are cloning from a Git repository, use the repository URL supplied by
your project owner:

```powershell
git clone <repository-url>
cd Navdrishti---NIDAR-VEGAPilot
```

The repository URL is intentionally shown as a placeholder because it is not
stored in the application configuration.

### 6.2 Create the Python environment

Run these commands from the project root in PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
python -m pip install -r backend\requirements-dev.txt
```

The first requirements file installs runtime packages. The development file
adds pytest and HTTP test support.

If PowerShell refuses to activate the environment, run this once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Then activate the environment again.

### 6.3 Install frontend dependencies

Open a second PowerShell terminal and run:

```powershell
cd "C:\path\to\Navdrishti---NIDAR-VEGAPilot\frontend"
npm install
```

`npm install` uses `frontend/package-lock.json` to install the React, Vite,
Leaflet, Recharts, TypeScript and linting dependencies.

### 6.4 Environment variables

No `.env` file is required for simulation mode.

For a temporary PowerShell configuration, set variables in the same terminal
that starts the backend:

```powershell
$env:VEGA_TELEMETRY_PROVIDER = "simulation"
```

Do not place passwords, tokens or private credentials in source files. The
current project does not require any secret values.

## 7. How to run the project

The frontend and backend run in separate terminals.

### Terminal 1: backend

From the project root:

```powershell
cd "C:\path\to\Navdrishti---NIDAR-VEGAPilot"
.\.venv\Scripts\Activate.ps1
$env:VEGA_TELEMETRY_PROVIDER = "simulation"
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Expected output includes:

```text
Uvicorn running on http://127.0.0.1:8000
```

### Terminal 2: frontend

```powershell
cd "C:\path\to\Navdrishti---NIDAR-VEGAPilot\frontend"
npm run dev
```

Vite normally reports a URL such as:

```text
http://localhost:5173/
```

### Open the application

Open `http://localhost:5173` in a browser.

The frontend connects to:

```text
ws://localhost:8000/ws/telemetry
```

### Verify the backend

Open these URLs or run the PowerShell commands below:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:8000/api/telemetry/latest
Invoke-RestMethod http://127.0.0.1:8000/api/mission
Invoke-RestMethod http://127.0.0.1:8000/api/logs
```

The health response should show `"mode": "simulation"` and a successful
provider status. Interactive API documentation is available at
`http://127.0.0.1:8000/docs`.

### Open diagnostics

Open:

```text
http://127.0.0.1:8000/diagnostics
```

This page shows raw provider messages. In simulation mode it shows the
validated simulated packet representation.

### Stop the application

In each running terminal, press:

```text
Ctrl+C
```

The backend closes its recording task and database connection during shutdown.

## 8. User guide

### Dashboard page

The Dashboard view displays:

- Flight mode and mission state.
- Telemetry connection state.
- Battery percentage and voltage.
- Map position and mission route.
- GNSS, altitude, speed and attitude values.
- Sensor health for IMU, GNSS, barometer and battery.
- Active fault events.
- Timestamped live altitude and battery-voltage charts.
- Recent telemetry packets in the system log panel.

The dashboard clearly labels simulation data and does not present it as live
hardware data.

Connection labels include:

- `CONNECTING`
- `CONNECTED`
- `DISCONNECTED`
- `RECONNECTING`
- `STALE` when packets stop arriving for the configured frontend timeout

### Logs page

The Logs view reads stored data from the backend. It supports:

- Search text.
- Start and end date filters.
- Sensor filter.
- Severity filter.
- Event type filter.
- Data-source filter.
- Pagination.
- Auto-refresh every 15 seconds.
- Battery-voltage and altitude history charts.
- CSV export using the active filters.

The available log event types are `TELEMETRY`, `FAULT` and `SYSTEM`.

### Dashboard controls that are not connected

The displayed Return-to-Home and Abort controls are not wired to backend
commands. Do not use them as flight-control commands.

## 9. Important code explanation

### Backend

| File | Responsibility |
|---|---|
| `backend/main.py` | Creates the FastAPI app, starts the selected provider, records packets and defines HTTP/WebSocket routes. |
| `backend/models.py` | Defines Pydantic telemetry, mission, log and fault models with range validation. |
| `backend/providers.py` | Defines `TelemetryProvider`, simulation, serial and optional MAVLink providers. |
| `backend/simulation.py` | Generates changing simulated position, attitude, battery, sensor-health, link and fault values. |
| `backend/recorder.py` | Writes telemetry, faults and connection events to the log store. |
| `backend/database.py` | Creates SQLite tables and implements filtering, history, statistics and CSV export. |
| `backend/tests/` | Tests provider behavior, APIs, SQLite persistence and error handling. |

`SerialProvider` intentionally reads raw bytes and accepts an injected decoder.
It does not guess the ARIES V3 packet structure.

### Frontend

| File | Responsibility |
|---|---|
| `frontend/src/main.tsx` | Mounts React and wraps the app in `TelemetryProvider`. |
| `frontend/src/services/telemetry.tsx` | Maintains one WebSocket, validates packets, reconnects and detects stale data. |
| `frontend/src/services/logs.ts` | Calls the backend log APIs and CSV endpoint. |
| `frontend/src/App.tsx` | Provides navigation and the application shell. |
| `frontend/src/pages/DashboardPage.tsx` | Composes dashboard panels. |
| `frontend/src/pages/LogsPage.tsx` | Provides log search, filtering, charts and export. |
| `frontend/src/components/MissionMap.tsx` | Displays the Leaflet map and simulated/live GNSS position. |
| `frontend/src/components/MissionPanels.tsx` | Displays mission progress, live telemetry and charts. |
| `frontend/src/components/TelemetryPanels.tsx` | Displays sensor health and position/altitude details. |

## 10. Configuration guide

### Backend ports

Default backend command:

```powershell
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

To use another backend port:

```powershell
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8100
```

The frontend currently uses fixed URLs for `localhost:8000`, so changing the
backend port also requires updating the frontend WebSocket and log API base
URLs in:

- `frontend/src/services/telemetry.tsx`
- `frontend/src/services/logs.ts`

### Database location

The default SQLite file is:

```text
data/vega_pilot.db
```

To use another location for the current PowerShell session:

```powershell
$env:VEGA_PILOT_DB = "C:\temp\vega_pilot.db"
```

The parent directory must exist or SQLite may report a database error. The
backend creates the tables automatically.

### Telemetry provider

Simulation is the safe default:

```powershell
$env:VEGA_TELEMETRY_PROVIDER = "simulation"
```

Serial mode is not a complete ARIES decoder and must remain disabled until
hardware specifications are supplied:

```powershell
$env:VEGA_TELEMETRY_PROVIDER = "serial"
$env:VEGA_SERIAL_ENABLED = "true"
$env:VEGA_SERIAL_PORT = "COM7"
$env:VEGA_SERIAL_BAUD = "115200"
$env:VEGA_SERIAL_PROTOCOL = "raw"
$env:VEGA_PACKET_TIMEOUT_S = "3"
```

MAVLink mode is also disabled until a compatible source and dialect are
confirmed:

```powershell
$env:VEGA_TELEMETRY_PROVIDER = "mavlink"
$env:VEGA_MAVLINK_CONFIRMED = "true"
```

Do not enable either hardware provider without the relevant module, firmware
and protocol documentation.

### Manual Configuration Required

Before real hardware integration, provide:

- ARIES V3 telemetry packet specification.
- Wireless TX/RX module documentation.
- Serial electrical and COM-port details.
- Baud and framing settings.
- Packet checksum and timeout rules.
- MAVLink confirmation and dialect, if applicable.
- A documented mapping from incoming fields to the existing Pydantic telemetry
  model.

## 11. Common errors and solutions

| Error or symptom | Possible reason | Solution | Verify |
|---|---|---|---|
| `python is not recognized` | Python is not installed or is not on PATH. | Install Python and enable the PATH option, or use the Python launcher. | `py --version` |
| `npm is not recognized` | Node.js is missing. | Install a current Node.js LTS release. | `node --version` and `npm --version` |
| PowerShell blocks `Activate.ps1` | Script execution policy prevents activation. | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then activate again. | `python --version` should show the environment interpreter. |
| Frontend shows `DISCONNECTED` | Backend is not running, or it is not on port 8000. | Start the backend in Terminal 1 and refresh the frontend. | `Invoke-RestMethod http://127.0.0.1:8000/api/health` |
| Backend port `8000` is already in use | Another process is using port 8000. | Stop the old process or start Uvicorn on another port and update frontend URLs. | `Get-NetTCPConnection -LocalPort 8000` |
| `ModuleNotFoundError: fastapi` | The virtual environment is not active or dependencies are missing. | Activate `.venv` and run `python -m pip install -r backend\requirements.txt`. | `python -c "import fastapi; print(fastapi.__version__)"` |
| `npm run dev` fails with missing package | Frontend dependencies are not installed. | Run `npm install` inside `frontend`. | `npm run build` |
| Logs page reports API failure | Backend is stopped or the backend URL is wrong. | Start the backend and confirm the URL is `http://localhost:8000`. | Open `/api/logs/stats`. |
| `log_store` is `degraded` | SQLite cannot create or write the configured database file. | Check `VEGA_PILOT_DB`, create its parent directory and check permissions. | `Invoke-RestMethod http://127.0.0.1:8000/api/health` |
| Serial provider refuses to start | Hardware mode is intentionally disabled or COM settings are missing. | Keep simulation enabled, or supply confirmed hardware specifications and set the explicit serial variables. | Check `provider_error` from `/api/health`. |
| No serial telemetry is decoded | No decoder is registered; the project does not assume an ARIES packet format. | Supply the official protocol specification and implement a tested decoder. | Open `/diagnostics` to inspect raw bytes. |
| Map tiles do not load | Network access to OpenStreetMap is unavailable. | Check network access. Telemetry values still come from the backend. | Check the browser console and map attribution. |

## 12. Testing and verification

### Backend automated tests

From the project root, with `.venv` active:

```powershell
python -m pytest
```

`pytest.ini` points pytest at `backend/tests`.

The tests cover:

- Telemetry provider selection.
- Simulation as the default provider.
- Serial provider enablement and recovery behavior.
- Simulated serial input and raw diagnostics.
- API responses and validation.
- SQLite storage and duplicate prevention.
- Fault and system-event logging.
- Log filters, statistics, history and CSV export.
- Graceful database errors.

### Backend syntax check

```powershell
python -m compileall -q backend
```

### Frontend checks

From `frontend`:

```powershell
npm run build
npm run lint
```

The build runs TypeScript checking and creates a production Vite build in
`frontend/dist`.

### Manual smoke test

1. Start the backend.
2. Start the frontend.
3. Open `http://localhost:5173`.
4. Confirm the dashboard says `SIMULATED DATA`.
5. Confirm the connection state becomes `CONNECTED`.
6. Confirm GNSS, altitude, battery and attitude values change over time.
7. Confirm the map marker moves slightly.
8. Open the Logs page and confirm records appear.
9. Open `/diagnostics` and confirm diagnostic messages appear.
10. Stop the backend and confirm the frontend eventually shows
    `DISCONNECTED` or `RECONNECTING`.

## 13. Frequently asked questions

### How do I start the project again?

Open two terminals. Activate the Python environment and start the backend in
the first. Run `npm run dev` from `frontend` in the second. Then open
`http://localhost:5173`.

### Do I need to start a database server?

No. The backend uses local SQLite and creates `data/vega_pilot.db`
automatically.

### How do I reset the local log history?

Stop the backend and remove the generated database file:

```powershell
Remove-Item .\data\vega_pilot.db
```

Start the backend again. It will create a fresh database. Only remove this
file if you intentionally want to delete local history.

### How do I change the backend port?

Pass another port to Uvicorn, then update both frontend constants:

- `WS_URL` in `frontend/src/services/telemetry.tsx`
- `API_BASE` in `frontend/src/services/logs.ts`

### How do I connect the database?

There is no external database connection. Set `VEGA_PILOT_DB` to a writable
SQLite file path if you need a different location.

### What should I do if an API key is missing?

The current project has no API-key requirement. Do not add secrets to source
files or commit them to Git.

### How do I connect ARIES V3?

Do not enable hardware mode yet. First obtain the module, firmware, serial
protocol and packet documentation listed in the Manual Configuration Required
section. Then implement and test a decoder that maps documented fields into
the existing validated telemetry model.

### Does the dashboard control the aircraft?

No. It currently displays telemetry and logs only. The visible RTH and Abort
areas are not connected to flight-control commands.

## 14. Quick start checklist

From a fresh Windows PowerShell session:

```powershell
# Terminal 1: backend
cd "C:\path\to\Navdrishti---NIDAR-VEGAPilot"
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

```powershell
# Terminal 2: frontend
cd "C:\path\to\Navdrishti---NIDAR-VEGAPilot\frontend"
npm install
npm run dev
```

Then:

1. Open `http://localhost:5173`.
2. Confirm `SIMULATED DATA`.
3. Confirm `CONNECTED`.
4. Confirm the backend health endpoint responds:
   `http://127.0.0.1:8000/api/health`.
5. Stop both terminals with `Ctrl+C`.

