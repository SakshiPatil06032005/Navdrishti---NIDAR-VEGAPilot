# NAVDRISHTI VEGA-Pilot
# Telemetry and Hardware Integration Documentation

## Easy Hinglish Summary

### Sabse important baat

Abhi dashboard par jo telemetry values dikh rahi hain, woh actual Arduino ya
sensor se nahi aa rahi hain. Yeh software ke andar bani hui simulated/demo
values hain.

Is project mein abhi:

- Real Arduino connected nahi hai.
- Real GPS/GNSS, IMU, barometer ya battery sensor read nahi ho raha.
- Battery voltage, current aur percentage actual battery measurement nahi hain.
- Temperature telemetry available nahi hai.
- Motor control, arming, RTH aur abort functionality actual hardware ko control
  nahi karti.

### Current data ka simple flow

```text
Python SimulationProvider
        ↓
Simulated telemetry packet
        ↓
Pydantic validation
        ↓
SQLite log database
        ↓
FastAPI WebSocket
        ↓
React dashboard
```

`backend/simulation.py` mein `SimulationProvider` values generate karta hai.
Kuch values fixed hain, jaise pressure aur current. Kuch values time ke saath
formula se change hoti hain, jaise altitude, position, heading aur battery.

### Important frontend finding

Project mein live WebSocket code bana hua hai, lekin current visible dashboard
ka kuch hissa abhi bhi `mockMission` aur hardcoded values use karta hai. Isliye
screen par number change hona apne aap mein real live hardware proof nahi hai.

### Future hardware ka flow

```text
Actual sensors
      ↓
Arduino/controller
      ↓
USB serial COM port
      ↓
Python pyserial receiver
      ↓
JSON validation and processing
      ↓
Existing FastAPI/WebSocket
      ↓
React dashboard
```

Future mein Arduino sensors ko read karke structured JSON message bhejega.
Python COM port se message receive karega, validate karega aur dashboard ko
forward karega.

### Hardware connection ka matlab

Sirf COM port open hona enough nahi hai. Application ko yeh bhi check karna
chahiye:

1. Kya message receive ho raha hai?
2. Kya message valid JSON hai?
3. Kya sequence number sahi hai?
4. Kya packet recent hai?
5. Kya har sensor ka status valid hai?

Isliye controller connection aur individual sensor health alag-alag dikhani
chahiye.

### Battery ke liye warning

Arduino USB/power status ko main battery status mat samajhna. Actual battery
status ke liye voltage/current sensing hardware chahiye. Battery ko directly
Arduino pin par connect nahi karna chahiye jab tak voltage limit, resistor
divider, protection aur grounding properly calculate aur verify na ho.

### Ab tak kya build hua hai

- React/Vite dashboard.
- Simulated mission map.
- Position, altitude, IMU aur battery panels.
- FastAPI Python backend.
- Simulation telemetry provider.
- WebSocket telemetry stream.
- Pydantic data validation.
- SQLite logs.
- Fault aur connection event logging.
- Log filtering, charts aur CSV export.
- Future serial hardware provider ka basic scaffold.
- Optional MAVLink provider ka scaffold.

### Abhi kya pending hai

- Exact Arduino/controller model.
- Exact sensor models.
- Battery chemistry, voltage aur capacity.
- Current measurement range.
- COM port aur baud rate.
- Arduino packet format.
- JSON schema/checksum/framing.
- Pin mapping aur electrical compatibility.
- Sensor calibration.
- Real hardware testing.

Neeche report mein detailed file paths, functions, data fields, future
architecture, battery plan, connection states aur testing plan diya gaya hai.

**Analysis scope:** Existing repository inspection only  
**Analysis date:** 27 October 2026  
**Implementation status:** No existing application file was modified. This report is the only new file.

## 1. Project Overview

NAVDRISHTI VEGA-Pilot is a React/Vite ground-control dashboard with a Python/FastAPI
backend. The repository has two related dashboard paths:

1. `frontend/src/App.tsx` renders the currently mounted dashboard UI. Its main
   cards and several panels use static values from `mockMission`.
2. `frontend/src/pages/DashboardPage.tsx` is a newer live-telemetry-oriented page.
   It consumes the shared WebSocket context, but `frontend/src/main.tsx` mounts
   `App.tsx` directly and no router was found that mounts `DashboardPage`.

The backend has a much more complete telemetry foundation:

- A deterministic simulation provider.
- Pydantic telemetry models and validation.
- A FastAPI HTTP API and WebSocket stream.
- SQLite persistence for telemetry, fault events and system events.
- A serial-provider scaffold for future hardware.
- Optional MAVLink-provider scaffolding, disabled until its source and dialect
  are confirmed.
- Diagnostic HTTP/WebSocket views for raw provider messages.

The repository documentation itself states that the current default system is
simulation-only and does not connect to flight hardware.

## 2. Existing Telemetry Source Audit

### 2.1 Primary generator: deterministic software simulation

The current default source is `SimulationProvider` in
`backend/simulation.py`. It explicitly says that it performs no hardware access.
`SimulationProvider.latest()` creates one cached packet per elapsed wall-clock
second. The packet is rebuilt by `_build(elapsed, second)`.

The values are software-generated:

- Some values are fixed constants.
- Some values change deterministically using `sin(...)`.
- Battery voltage and percentage decrease as a function of elapsed time.
- Sensor faults and link outages are generated from the elapsed-second modulo
  schedule.
- No sensor read, Arduino read, USB read, COM-port read or external telemetry API
  is used by this provider.

`backend/providers.py` wraps it in `SimulationTelemetryProvider`. The provider
factory selects simulation by default:

```text
VEGA_TELEMETRY_PROVIDER=simulation
```

### 2.2 Generated telemetry fields and formulas

The following formulas are directly visible in `backend/simulation.py`:

| Field | Current generated value/source |
|---|---|
| Timestamp | `datetime.now(UTC)` at packet construction |
| Data source | `DataSource.SIMULATION` |
| Flight mode | Fixed `MISSION` |
| Latitude | `18.52390 + sin(elapsed / 30) * 0.00005` |
| Longitude | `73.86410 + sin(elapsed / 35) * 0.00005` |
| GNSS altitude | `124.6 + sin(elapsed / 8) * 1.5` metres |
| Ground speed | `12.8 + sin(elapsed / 6) * 0.3` m/s |
| Heading/yaw | `(84.2 + elapsed * 0.05) % 360` degrees |
| GNSS fix | `RTK FIX` when GNSS health is `VALID`, otherwise `FLOAT FIX` |
| Satellites | `14` when valid, otherwise `7` |
| HDOP | `0.7` when valid, otherwise `2.4` |
| IMU roll | `1.8 + sin(elapsed / 4) * 0.2` degrees |
| IMU pitch | `-0.6 + sin(elapsed / 5) * 0.15` degrees |
| IMU yaw | Same generated heading/yaw |
| IMU rates | Fixed `0.02`, `0.01`, `0.08` degrees/second |
| Barometer pressure | Fixed `998.4` hPa |
| Relative altitude | Same generated altitude |
| Vertical speed | `sin(elapsed / 8) * 0.2` m/s |
| Battery voltage | `24.8 - min(elapsed / 3600, 0.4)` V |
| Battery current | Fixed `8.4` A |
| Battery remaining | `max(0, 78 - elapsed / 180)` percent |
| Battery health | Fixed `VALID` in the simulator |
| Mission | Fixed simulated mission `Survey perimeter Alpha` |

These are not actual measurements. In particular, the current voltage,
percentage and current are demo/simulation values, not measurements of the
computer's USB supply or a connected battery pack.

### 2.3 Sensor-health and link simulation

`SimulationProvider._health()` periodically marks sensors as `DEGRADED`:

- IMU: seconds 200–214 in each 400-second cycle.
- GNSS: seconds 120–149 in each 300-second cycle.
- Barometer: seconds 40–69 in each 240-second cycle.
- Battery: always `VALID` in the current simulation.

`SimulationProvider._link()` generates a simulated telemetry link:

- Six seconds of outage beginning at second 90 in every 180-second period.
- During outage: `connected=False`, signal `0`, latency `0`.
- Otherwise: `connected=True`, signal starts at `96%` and follows a repeating
  deterministic pattern; latency follows a repeating deterministic pattern.

`_faults()` converts simulated degraded sensors into warning fault events and
link outages into a `LINK_DOWN` error. These are also software-generated.

## 3. Telemetry Field Trace Table

The table below distinguishes the backend packet from what the currently mounted
UI visibly renders.

| Telemetry Field | Current Source | Generating Function | Processing File | Dashboard Location | Verification |
|---|---|---|---|---|---|
| Latitude/longitude | Simulated GNSS coordinates | `SimulationProvider._build()` | `backend/simulation.py` → `backend/main.py` | Current `App.tsx` → `MissionMap.tsx` uses fixed `simulatedDrone`; live `DashboardPage` path would use packet data | Verified simulation; current mounted map is static |
| Altitude | Simulated sine-wave altitude | `SimulationProvider._build()` | `backend/simulation.py`, optionally SQLite via `database.py` | Current map/panels use `mockMission`; live page has `DashboardPage` data path | Verified simulation; static current UI |
| Relative altitude | Same simulated altitude | `SimulationProvider._build()` | `backend/models.py`, `backend/database.py` | `TelemetryPanels.tsx` and `MissionPanels.tsx` use `mockMission.telemetry.relativeAltitude` | Verified simulated/static UI |
| Ground speed | Simulated sine-wave value | `SimulationProvider._build()` | `backend/simulation.py` | `TelemetryPanels.tsx` / `MissionPanels.tsx` use `mockMission` | Verified simulated/static UI |
| Heading/yaw | Simulated elapsed-time calculation | `SimulationProvider._build()` | `backend/simulation.py` | Current panels use `mockMission.telemetry.yaw` | Verified simulated/static UI |
| Roll/pitch | Simulated sine-wave values | `SimulationProvider._build()` | `backend/simulation.py` | Current panels use `mockMission.telemetry.roll/pitch` | Verified simulated/static UI |
| IMU rates | Fixed simulator constants | `SimulationProvider._build()` | `backend/simulation.py` | Current `TelemetryPanels.tsx` uses literal strings | Verified simulated/static UI |
| Pressure | Fixed `998.4` simulator value | `SimulationProvider._build()` | `backend/simulation.py` | Current `TelemetryPanels.tsx` uses literal `998.4 hPa` | Verified simulated/static UI |
| GNSS fix/satellites/HDOP | Simulator health-dependent constants | `SimulationProvider._build()` | `backend/simulation.py` | Current panels use literal `RTK FIX`, `14 satellites`, `0.7` | Verified simulated/static UI |
| Battery voltage | Simulated elapsed-time formula; also duplicated as `mockMission` value | `SimulationProvider._build()` and `mockMission` constant | `backend/simulation.py`; `frontend/src/services/mockMission.ts` | Current cards/panels/charts | Verified software-generated; not hardware |
| Battery percentage | Simulated elapsed-time formula; also duplicated as `mockMission` value | `SimulationProvider._build()` and `mockMission` constant | Same as above | Current summary and battery panel | Verified estimated/demo simulation |
| Battery current | Simulated fixed `8.4 A` | `SimulationProvider._build()` | `backend/simulation.py` and model | Not visibly rendered in current `App.tsx` panels | Verified backend-only simulated field |
| Sensor health | Scheduled simulated statuses | `SimulationProvider._health()` | `backend/simulation.py` | Current `TelemetryPanels.tsx` uses a static `sensorReadings` array; live page can consume packet context | Verified backend simulation; mounted UI static |
| Telemetry link | Scheduled simulated connection/signal/latency | `SimulationProvider._link()` | `backend/simulation.py` | Current `App.tsx` hardcodes `CONNECTED`, `98.4%`; live page has connection context | Verified simulated backend; current header static |
| Fault events | Scheduled simulator faults | `SimulationProvider._faults()` | `backend/simulation.py`, `recorder.py`, `database.py` | Current `App.tsx` hardcodes no active faults; live `DashboardPage` maps packet faults | Verified backend simulation; current mounted panel static |
| Mission state/waypoints | Static simulator mission snapshot | `mission_snapshot()` and `mockMission` | `backend/simulation.py`, `mockMission.ts` | Current map, progress and timeline panels | Verified software-generated |
| Temperature | No temperature field in `Telemetry` | None found | None | Not displayed as telemetry | Not implemented |
| GPS separate from GNSS | No separate GPS object; GNSS position exists | `GnssPosition` simulator | `backend/models.py` | Map/position concepts | GNSS exists; separate GPS sensor not verified |
| Power/energy/charging state | No model field | None found | None | Not displayed | Not implemented |

### 3.1 Important UI integration finding

`frontend/src/services/telemetry.tsx` contains a real shared WebSocket client:

- URL: `ws://localhost:8000/ws/telemetry`
- Validates the packet shape with `isTelemetry()`.
- Stores the latest packet and up to 60 packets of history.
- Detects stale data after `3,000 ms`.
- Reconnects after `1,500 ms`.

However, `frontend/src/main.tsx` mounts `App` directly. The currently mounted
`App.tsx` renders static `mockMission` components and does not wrap its tree in
`TelemetryProvider` or render `DashboardPage`. Therefore:

- The backend live stream is implemented.
- The frontend live context client is implemented.
- The currently mounted visual dashboard is not consistently wired to that live
  context.
- The current visible values should not be described as live hardware telemetry.

This is an existing architecture observation, not a change made by this report.

## 4. File-wise Code Flow

### Backend generation, validation and storage

1. `backend/main.py` calls `provider_from_environment()`.
2. Default provider is `SimulationTelemetryProvider`.
3. Its internal `SimulationProvider.latest()` returns one packet per simulated
   second.
4. `backend/models.py` defines the Pydantic `Telemetry` shape and field bounds.
5. FastAPI startup creates `_record_loop()`, which calls `provider.latest()`,
   then `TelemetryRecorder.record()`, once per second (`RECORD_INTERVAL_S=1.0`).
6. `backend/recorder.py` writes telemetry, faults and link transitions to
   `backend/database.py`.
7. SQLite stores telemetry in `telemetry_records`, faults in `fault_events`, and
   connection/system events in `system_events`.
8. `GET /api/telemetry/latest` returns the latest decoded packet.
9. `WS /ws/telemetry` sends the current packet as JSON approximately once per
   second to each connected client.
10. Log endpoints read SQLite history, stats and records.

### Frontend live path

1. `frontend/src/services/telemetry.tsx` opens the WebSocket.
2. Incoming text is parsed as JSON.
3. `isTelemetry()` performs structural validation.
4. Timestamp parsing, latest-packet state, history, stale state and reconnect
   state are maintained in React context.
5. `DashboardPage.tsx` consumes that context and can display packet-backed
   values.

### Frontend currently mounted path

`frontend/src/main.tsx` mounts `App.tsx`. `App.tsx` directly renders:

- `MissionMap.tsx`, whose coordinates and waypoints are fixed simulated
  constants.
- `TelemetryPanels.tsx`, where many values are from `mockMission` or literals.
- `MissionPanels.tsx`, where charts, live metrics and timeline use `mockMission`.
- Static header and summary-card values.

The logs page has a separate HTTP path through `frontend/src/services/logs.ts`
and calls `/api/logs/records`, `/api/logs/history`, `/api/logs/stats` and
`/api/logs/export.csv`.

## 5. Current Data Source Verification

| Question | Finding |
|---|---|
| Actual Arduino/sensor data received? | No evidence. No Arduino reader, sensor driver, pin read or hardware packet decoder is active. |
| Is current telemetry random? | No. It is deterministic time-based simulation using constants, `sin`, elapsed time and modulo schedules. |
| Is it file/API based? | The primary live packet is not file/API sourced. It is generated in Python. Logs are stored in SQLite after generation. |
| Is the current battery actual? | No. Voltage, current and percentage are simulator values; the UI also has duplicated demo constants. |
| Is the current connection status actual hardware status? | No. Simulation reports a generated link state. Current mounted header hardcodes connected/nominal labels. |
| Is live WebSocket infrastructure present? | Yes, in backend and frontend service code. Its use by the currently mounted `App` is not verified; code inspection indicates it is not wired there. |
| Are temperature readings available? | No temperature model or visible temperature telemetry field was found. |
| Is motor/flight-controller operation implemented? | No. README states arming, disarming, motor control, RTH and abort controls are display-only. |

## 6. Beginner-friendly Hinglish Explanation

### Telemetry kya hota hai?

Telemetry ka matlab hai vehicle ya device se regularly status aur sensor data
receive karna: jaise position, speed, altitude, battery aur sensor health.

### Is project mein abhi data kaise banta hai?

Abhi Python ka `SimulationProvider` khud values banata hai. Kuch values fixed hain,
aur kuch elapsed time ke saath mathematical formula se badalti hain. Isliye screen
par number change ho sakte hain, lekin unka source Arduino, GPS, IMU ya battery
sensor nahi hai.

### Dashboard tak kaise pahunchta hai?

Backend theoretically har second packet banata, validate karta, SQLite mein record
karta aur WebSocket par JSON bhejta hai. `telemetry.tsx` us JSON ko validate,
store aur stale/reconnect state manage karta hai. Lekin current `App.tsx` path
mein dikhne wale kai panels direct `mockMission`/literal values lete hain. Isliye
backend ka live path aur current visible UI path ko alag samajhna zaroori hai.

### Live aur simulated reading mein antar

- **Live reading:** sensor hardware se actual measurement, communication link se
  receive, validate aur timestamped hoti hai.
- **Simulated reading:** software formula/constant se banti hai; hardware ki
  physical condition prove nahi karti.

Current project mein generated backend telemetry simulated hai. Current battery
percentage estimated/demo value hai, actual battery gauge measurement nahi.

### Hardware connection status abhi kaise determine hota hai?

Simulation mode mein connection provider ke generated link state se aata hai.
Serial provider scaffold mein COM port open/read errors, last packet time aur
timeout ka use hota hai. Lekin actual Arduino connected aur saare sensors healthy
hain, yeh current project ne prove nahi kiya hai. COM port open hona sirf transport
level evidence hai, sensor health ka proof nahi.

## 7. Proposed Future Hardware Architecture

```text
Actual sensors and battery monitor
        ↓
Arduino / compatible controller
        ↓
USB serial (COM port) or approved communication interface
        ↓
Python hardware receiver
        ↓
Telemetry validation and processing layer
        ↓
Existing FastAPI/WebSocket/logging services
        ↓
React dashboard
```

### Step 1: Controller select karna

**Kya karna hai:** Controller choose karne se pehle required sensor count,
sampling rate, ADC resolution, UART/I2C/SPI availability, USB capability, power
levels, memory, timing and library support document karna hai.

**Kyun:** Board ke pins, voltage levels aur throughput sensors aur battery
monitor ke saath electrically/technically compatible hone chahiye.

**Pending:** Exact Arduino/controller model abhi project se identify nahi hota.
Arduino Uno/Nano/Mega/ESP32 ya flight-controller equivalent invent karke select
nahi karna chahiye.

### Step 2: Sensors/components identify karna

Required measurement list se components select honge:

- GNSS receiver for latitude, longitude, altitude, fix, satellites and HDOP.
- IMU for accelerometer/gyro attitude and rates.
- Barometer for pressure, relative altitude and vertical speed.
- Battery voltage/current monitor selected for the pack's voltage/current range.
- Optional temperature sensor only if temperature is a required field.
- Controller, regulated power, wiring/connectors, protection and mounting.

Exact sensor models, ranges, calibration method and update rates are pending.

### Step 3: Arduino firmware

Firmware sensors initialize karega, sampling schedule maintain karega, sensor
errors detect karega, units normalize karega, battery monitor read karega aur
structured messages emit karega. Firmware ko sensor-wise status aur sequence
number bhi bhejna chahiye, taaki Python stale/missing sensor ko identify kar sake.

### Step 4: Structured serial messages

Readable newline-delimited JSON ek practical initial protocol ho sakta hai:

```json
{
  "schema_version": 1,
  "sequence": 1234,
  "timestamp_ms": 456789,
  "device": {"controller": "PENDING", "firmware": "PENDING"},
  "gnss": {"lat_deg": 0.0, "lon_deg": 0.0, "alt_m": 0.0, "fix": "NO_DATA"},
  "imu": {"roll_deg": 0.0, "pitch_deg": 0.0, "yaw_deg": 0.0},
  "barometer": {"pressure_hpa": 0.0, "relative_alt_m": 0.0},
  "battery": {"voltage_v": 0.0, "current_a": 0.0, "percent": null},
  "health": {"gnss": "NO DATA", "imu": "NO DATA", "barometer": "NO DATA", "battery": "NO DATA"}
}
```

The exact schema, timestamp authority, units, checksum/framing and maximum
message size must be agreed before implementation. JSON is convenient for
bring-up; a binary/checksummed protocol may be preferable for high-rate or
noisy links.

### Step 5: Python receiver and `pyserial`

The existing `SerialProvider` is the intended extension point. In future it
should:

1. Open the configured COM port with the confirmed baud rate and timeout.
2. Read complete framed lines/messages.
3. Record raw diagnostic payloads.
4. Validate framing, JSON/schema, sequence, timestamp and units.
5. Convert the verified message into the existing `Telemetry` model.
6. Update last-valid-packet time and per-sensor health.
7. Expose the latest packet to the same API/WebSocket/logging path.

`pyserial` is already listed in backend requirements, but a real decoder,
protocol and hardware configuration are not implemented. The current serial
provider intentionally does not invent packet framing or field layouts.

### Step 6: Existing dashboard integration

Keep the provider-neutral `Telemetry` contract. The simulation provider and
hardware provider should both produce that contract. Then the existing recorder,
`/api/telemetry/latest`, `/ws/telemetry`, frontend validation and dashboard
context can consume either source.

Simulation and hardware mode should be selected explicitly by configuration,
never silently mixed. Every packet should retain `data_source=simulation` or
`data_source=hardware`.

### Step 7: Error handling

The system should distinguish:

- Opening/permission/COM-port failure.
- No bytes received before timeout.
- Invalid JSON or framing.
- Schema/range/unit validation failure.
- Valid packet with an individual sensor error.
- Valid packets that are stale.
- Recovered communication after reconnect.

Errors must be visible in health/status UI and logs; invalid data must not be
silently treated as a valid zero value.

## 8. Battery Monitoring Plan

### 8.1 Voltage

Use a battery-monitoring IC/module or a correctly designed resistor divider
feeding an ADC. Before recommending a direct Arduino pin connection, verify:

- Maximum battery voltage, including charging/fully charged voltage.
- Arduino ADC maximum input voltage and reference configuration.
- Divider ratio and resistor power ratings.
- Common ground and signal ground arrangement.
- Protection against transients, reverse polarity and overvoltage.
- Isolation requirements and motor-noise environment.

The battery must never be connected directly to an Arduino input unless these
limits and a suitable divider/protection circuit are calculated and verified.

### 8.2 Percentage

Percentage should be estimated from the correct battery chemistry, cell count,
charge/discharge curve, under-load behavior and calibration. A linear voltage
mapping is only a rough estimate and can be misleading under motor load.

For better results, use a fuel-gauge/monitoring circuit or calibrated
voltage-plus-current integration. The dashboard should label estimated
percentage and show unavailable when the required calibration/specification is
missing.

### 8.3 Current and power

If needed, use an appropriately rated current sensor/shunt plus monitor IC.
Power can be calculated as `voltage × current`, while energy/remaining capacity
requires time integration and calibration. Verify continuous and peak current,
shunt heating, wiring, polarity and noise filtering.

### 8.4 Charging/discharging

Charging/discharging status requires hardware that can identify current
direction or charger state. It cannot be inferred reliably from USB connection
or Arduino power. The controller should send a status such as
`CHARGING`, `DISCHARGING`, `IDLE` or `UNKNOWN` only when hardware supports it.

### 8.5 Dashboard transfer and warnings

Arduino sends voltage/current/percentage/health in the structured message.
Python validates and forwards it. The dashboard can then show:

- Voltage with unit and freshness.
- Percentage with estimated/measured qualifier.
- Current and calculated power when available.
- Low-battery warning thresholds defined from battery specifications.
- Battery sensor unavailable/degraded state.
- Charging/discharging state only when verified.

Arduino's own USB/power status must not be presented as the mission battery
status.

## 9. Hardware Connection and Sensor Health Plan

Use separate state machines for transport and sensors.

### Controller/transport states

- **Connecting:** startup or explicit connection attempt.
- **Connected:** port is open and recent valid packets are arriving.
- **Reconnecting:** connection was lost and retry is active.
- **Hardware Disconnected:** port cannot be opened or remains unavailable.
- **Communication Error:** bytes/frames are malformed, validation fails, or
  repeated read errors occur.
- **Stale Data / No Recent Update:** no valid packet within the configured
  timeout, even if the OS still reports the port open.

### Sensor states

Each GNSS, IMU, barometer and battery monitor should independently report
`VALID`, `DEGRADED`, `FAILED` or `NO DATA`, with last update and error reason.
This prevents a connected Arduino with a failed GNSS module from appearing as
fully healthy.

Recommended evidence:

1. COM port open result.
2. Last raw message time.
3. Last valid decoded packet time.
4. Sequence continuity.
5. Message validation result.
6. Per-sensor health and sensor timestamp.
7. Reconnect/error counters.

The existing serial scaffold already has useful pieces: configured port,
baudrate, timeout, `_last_packet_at`, `connected`, `stale`, raw diagnostics and
retry after errors. It still needs the confirmed decoder and sensor-health
contract before it can represent real hardware.

## 10. Proposed Dashboard Sections

| Section | Required data | Future source |
|---|---|---|
| Device Status | Controller name, firmware, provider mode, COM port, transport state, last valid packet | Python provider configuration and validated device metadata |
| Battery Monitoring | Voltage, percent, current, power, charge state, alert threshold, freshness | Battery monitor hardware → Arduino → Python |
| Live Telemetry | GNSS, altitude, speed, heading, IMU, barometer and only confirmed fields | Sensor packet normalized by Python |
| Sensor Health | Sensor-wise state, last update, error, calibration/fix details | Arduino health plus Python validation |
| Communication Monitor | Raw/valid/invalid counts, sequence gaps, timeout, reconnect and error counts | Serial receiver diagnostics |
| Telemetry Source | Hardware/simulation/API label per packet/field | `data_source` and provider metadata |
| Historical Data | Time-series sensor/battery values and source filters | SQLite or another explicitly selected store |

This is a proposed design only. The existing dashboard must not be changed as
part of this analysis.

## 11. Required Hardware Components

The code establishes interfaces, not final hardware specifications. The
following categories will be required after confirmation:

- Arduino or compatible controller with suitable USB/UART and sensor buses.
- GNSS receiver, if position telemetry is required.
- IMU, if attitude/rates are required.
- Barometer, if pressure/relative altitude is required.
- Battery voltage monitor and, if required, current/power monitor.
- Regulated supplies, connectors, wiring, fusing/protection and mounting.
- USB cable/serial interface and a known COM-port configuration.
- Optional level shifter/isolation where voltage domains require it.

Exact part numbers, voltage ranges and wiring must not be invented from the
current repository.

## 12. Pending Decisions

The following are **Pending Confirmation** because the repository does not
provide them:

- Exact Arduino/controller model and firmware environment.
- Exact GNSS, IMU, barometer and temperature sensor models.
- Battery chemistry, nominal/full/empty voltage, cell count and capacity.
- Maximum continuous/peak current and required measurement accuracy.
- Voltage-divider/protection/current-monitor circuit design.
- USB serial, UART bridge, wireless link or another interface.
- COM port assignment, baud rate and framing/checksum protocol.
- JSON versus binary protocol and schema version.
- Required telemetry fields and authoritative units.
- Sampling frequency for each sensor and packet frequency.
- Timestamp source and clock synchronization.
- Controller pin mapping, bus addresses and interrupt requirements.
- Grounding, power domains, electrical isolation and motor-noise precautions.
- Calibration procedure and sensor-failure semantics.
- Low-battery thresholds and whether percentage is measured or estimated.
- Whether charging state is required and how hardware reports it.
- Retention, sampling/downsampling and storage policy for history.
- Safety requirements for any future control commands.

## 13. Future Implementation Steps

1. Confirm the controller, sensors, battery and electrical specifications.
2. Freeze the telemetry schema, units, timestamps, health states and protocol.
3. Build and bench-test Arduino sensor acquisition without motors.
4. Add sequence numbers, checksums/framing and explicit sensor errors.
5. Implement a Python decoder behind the existing provider interface.
6. Validate ranges, units, timestamps, sequence gaps and stale timeouts.
7. Keep simulation as a selectable provider and test both modes separately.
8. Feed validated hardware packets through the existing recorder/API/WebSocket.
9. Wire the rendered React dashboard to the shared validated telemetry context.
10. Add device status, source labels, battery warnings and per-sensor health.
11. Add controlled persistence/history for real hardware records.
12. Run bench, disconnect/reconnect, malformed-packet, sensor-failure and
    low-battery tests before any flight test.

## 14. Testing and Verification Plan

### Software-only

- Unit-test schema and range validation.
- Test valid JSON, malformed JSON, partial frames and checksum failures.
- Test sequence gaps, duplicate packets and out-of-order timestamps.
- Test stale timeout and reconnect transitions.
- Test every provider mode explicitly.
- Verify simulation packets remain labeled `simulation`.
- Verify hardware packets are labeled `hardware`.
- Verify logs retain source, faults and link transitions separately.

### Bench hardware

- Test each sensor individually with known reference values.
- Verify ADC/divider readings with a calibrated multimeter.
- Verify current sensor polarity, range and heating.
- Test battery values without motor transients first.
- Disconnect each sensor and confirm only that sensor becomes unhealthy.
- Unplug/replug USB and confirm `Disconnected` → `Reconnecting` → `Connected`.
- Send malformed and stale messages and confirm visible errors.

### Integrated and safety verification

- Compare GNSS/IMU/barometer readings with independent instruments.
- Test under expected motor noise and peak current.
- Confirm low-battery warnings against the battery specification.
- Confirm no USB/Arduino supply state is mislabeled as pack state.
- Confirm dashboard displays source and freshness.
- Keep all arming, motor and flight-control behavior disabled until separately
  specified, reviewed and tested.

## 15. What Has Been Built So Far

Based on the Git history and current files:

1. **Frontend foundation (`794d4f4`)**: Vite/React/Tailwind-oriented frontend
   initialized.
2. **UI styling and responsive layout (`82d9ffe`)**: visual dashboard base
   improved.
3. **Mission map (`ec85596`)**: Leaflet map, simulated route, waypoints, home
   and simulated aircraft marker added.
4. **Telemetry panels (`b298c0a`)**: position/altitude and sensor-health UI
   added.
5. **Mission panels (`ae4bfeb`)**: mission progress, live telemetry charts,
   timeline and mock mission data integrated.
6. **Backend and live infrastructure (`4671875`)**:
   - FastAPI application and endpoints.
   - Pydantic telemetry contracts.
   - Deterministic simulation provider.
   - Shared frontend WebSocket telemetry service with validation/reconnect.
   - SQLite logging, history, filtering, statistics and CSV export.
   - Fault/link event recording.
   - Serial and optional MAVLink provider scaffolds.
   - Backend tests for API, database and provider behavior.

The current branch also contains a baseline checkpoint commit
`cc6207d`; it is session metadata rather than a new telemetry feature.

## 16. Final Three Lists

### Currently Implemented

- Software-generated deterministic telemetry simulation.
- GNSS-like position, altitude, speed, heading and fix fields.
- IMU attitude/rate fields.
- Barometer pressure/altitude/vertical-speed fields.
- Simulated battery voltage, current and percentage.
- Simulated sensor health, link state and fault events.
- Pydantic validation model.
- FastAPI latest-telemetry HTTP endpoint.
- FastAPI telemetry WebSocket stream.
- Frontend WebSocket validation/reconnect/stale-state service.
- SQLite telemetry/fault/system event persistence.
- Log filtering, charts, statistics and CSV export APIs/UI.
- Raw diagnostics endpoints/page.
- Disabled-by-default serial provider scaffold and optional MAVLink scaffold.
- Static/mock dashboard panels and simulated map.
- Display-only RTH/abort UI; no actual flight-control command path.

### Future Hardware Integration

- Confirm controller, sensors, battery and electrical design.
- Implement Arduino sensor acquisition and health reporting.
- Implement agreed framing/schema/checksum and packet timestamps.
- Implement the Python serial decoder and hardware provider configuration.
- Validate and normalize real units and timestamps.
- Add real battery monitor acquisition and calibrated percentage.
- Add transport/sensor state handling and user-visible diagnostics.
- Wire the actually mounted dashboard to validated live context consistently.
- Add hardware history/source filtering and real-device acceptance tests.

### Not Yet Verified

- Any actual Arduino/controller connection.
- Any real GNSS, IMU, barometer or battery sensor measurement.
- Any real battery voltage, current, percentage or charging state.
- Exact COM port, baud rate, packet protocol, pin map or sensor addresses.
- Sensor calibration and accuracy.
- Hardware disconnect/reconnect behavior on the target device.
- Electrical compatibility, grounding, protection and motor-noise behavior.
- Flight-controller integration or safe command/control behavior.
- Temperature telemetry, power consumption history and energy estimation.

**Bottom line:** Abhi project ka reliable truth yeh hai ki telemetry software
simulation se generate ho rahi hai. Hardware integration ke liye foundation
(`Telemetry` model, provider interface, serial scaffold, WebSocket, logging) bana
hua hai, lekin actual Arduino/sensor decoder, hardware specifications aur
mounted UI wiring ko future implementation mein complete aur verify karna hoga.
