# VEGA-Pilot backend

This backend exposes simulated telemetry only. It does not connect to flight
hardware.

Telemetry packets, fault events and system events are persisted into a local
SQLite database so the ground control station can search, filter, chart and
export the flight history. Every stored record carries the data source it came
from, so simulated frames are never mixed with hardware frames.

## Run on Windows

From the project directory in PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

If PowerShell blocks activation, run this once for the current user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

The API is available at `http://127.0.0.1:8000`; interactive API
documentation is at `http://127.0.0.1:8000/docs`. The WebSocket endpoint is
`ws://127.0.0.1:8000/ws/telemetry` and sends one validated telemetry snapshot
per second.

## Provider configuration

Simulation is the default and is the only provider enabled by default:

```text
VEGA_TELEMETRY_PROVIDER=simulation
```

Serial hardware is intentionally disabled until the ARIES V3 and telemetry
module specifications are supplied. When those specifications are confirmed,
enable it explicitly:

```text
VEGA_TELEMETRY_PROVIDER=serial
VEGA_SERIAL_ENABLED=true
VEGA_SERIAL_PORT=COM7
VEGA_SERIAL_BAUD=115200
VEGA_SERIAL_PROTOCOL=raw
VEGA_PACKET_TIMEOUT_S=3
```

`SerialProvider` records raw bytes and requires a documented decoder before it
can produce dashboard telemetry. It does not assume framing, checksums, field
layouts, units or pin connections. MAVLink is similarly opt-in through
`VEGA_TELEMETRY_PROVIDER=mavlink` and `VEGA_MAVLINK_CONFIRMED=true`; the
compatible source and dialect must be confirmed before adding `pymavlink`.

The raw diagnostic page is available at `http://127.0.0.1:8000/diagnostics`.
Its API and WebSocket counterparts are `/api/diagnostics/messages` and
`ws://127.0.0.1:8000/ws/diagnostics`.

Endpoints:

- `GET /api/health`
- `GET /api/telemetry/latest`
- `GET /api/mission`
- `GET /api/missions` — saved five-waypoint mission drafts
- `PUT /api/missions/{mission_id}` — save a validated mission draft
- `POST /api/missions/{mission_id}/simulation-upload` — simulation-only upload with acknowledgement
- `POST /api/missions/{mission_id}/simulation-command?command=start|pause|resume|abort|rth|standby|reset&command_id=...` — simulation-only validated mission controls
- `POST /api/simulation/faults?fault=gnss|battery|communication` — inject one simulation fault; unavailable in hardware mode
- `DELETE /api/simulation/faults` — clear injected simulation faults and record recovery telemetry
- `GET /api/logs` — the most recent stored records as plain log lines
- `GET /api/logs/records` — searchable, filterable records
- `GET /api/logs/history` — battery voltage and altitude series for the charts
- `GET /api/logs/stats` — record counts by type and severity
- `GET /api/logs/export.csv` — CSV export using the same filters
- `WS /ws/telemetry`

## Log store

The database lives in `data\vega_pilot.db` by default. Set `VEGA_PILOT_DB` to
point it somewhere else:

```powershell
$env:VEGA_PILOT_DB = "C:\temp\vega_pilot.db"
```

The store keeps three tables and exposes them through one `log_records` view:

- `telemetry_records` — one row per telemetry packet, with the packet
  timestamp and the data source
- `fault_events` — fault events only, stored separately from telemetry
- `system_events` — system events such as telemetry connection loss

Duplicates are avoided on purpose: telemetry packets are unique per
timestamp and data source, faults are only stored once per code inside a
60 second window, and identical system events are only stored once inside a
10 second window.

Database failures never take the API down. The store reports the problem
through `database_error` on every response and `/api/health` returns
`"log_store": "degraded"`.

## Query parameters

`/api/logs/records`, `/api/logs/stats` and `/api/logs/export.csv` accept the
same filters:

- `start` / `end` — ISO-8601 date or date-time; a date-only `end` covers the
  whole day
- `sensor` — `imu`, `gnss`, `barometer`, `battery` or `link`
- `severity` — `INFO`, `WARNING`, `ERROR` or `CRITICAL`
- `category` — `Telemetry`, `Mission`, `Waypoint`, `Sensor`, `Battery`,
  `Communication`, `Failsafe` or `System`
- `event_type` — legacy raw event type (`TELEMETRY`, `FAULT`, `SYSTEM` or `MISSION`)
- `data_source` — `simulation` or `hardware`
- `search` — free text match on the message or the fault code

Mission events are read from the existing `mission_events` table and unioned
into the log query; source rows are not copied or re-recorded. CSV export uses
the same filters as the records endpoint.

`/api/logs/records` also accepts `limit` and `offset`.

## Tests

```powershell
python -m pip install -r backend\requirements-dev.txt
python -m pytest
```

The suite covers saving, retrieving, filtering, deduplication, CSV export and
graceful handling of database failures.
