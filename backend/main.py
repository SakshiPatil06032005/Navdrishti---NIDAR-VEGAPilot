"""FastAPI application for the VEGA-Pilot simulated telemetry backend.

Telemetry packets, fault events and system events are persisted into SQLite by
the background recorder so the ground control station can search, filter, chart
and export the flight history. Every record carries the data source it came
from, so simulated frames are never mixed with hardware frames.
"""

import asyncio
import logging
import os
from uuid import uuid4
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response

from .database import DEFAULT_DB_PATH, LogFilter, LogStore
from .models import (
    CommandLifecycle,
    DataSource,
    LogEntry,
    LogHistoryPoint,
    LogHistoryResponse,
    LogRecordModel,
    LogRecordsResponse,
    LogStatsResponse,
    MissionResponse,
    MissionLimits,
    MissionState,
    NotificationSeverity,
    NotificationPolicy,
    NotificationRecord,
    Telemetry,
)
from .failsafe import FailsafePolicy, FailsafeStatus, evaluate_failsafe
from .recorder import TelemetryRecorder
from .notifications import NotificationManager
from .providers import SerialProvider, SimulationTelemetryProvider, TelemetryProvider, provider_from_environment
from .settings import DashboardPreferences, SerialSettings, SettingsState, SettingsStore
from .mission import MissionCommandResult, MissionDraft, MissionEvent, MissionManager, MissionStore
from .simulation import mission_snapshot

UTC = timezone.utc

logger = logging.getLogger(__name__)
provider: TelemetryProvider = provider_from_environment()
provider_start_error: str | None = None

#: The log store location can be overridden so tests never touch the real data.
store = LogStore(os.environ.get("VEGA_PILOT_DB") or DEFAULT_DB_PATH)
notification_manager = NotificationManager(store)
recorder = TelemetryRecorder(store, notification_manager)
settings_store = SettingsStore(os.environ.get("VEGA_PILOT_DB") or DEFAULT_DB_PATH)
mission_store = MissionStore(os.environ.get("VEGA_PILOT_DB") or DEFAULT_DB_PATH)
mission_manager = MissionManager(mission_store)
mission_clients: set[WebSocket] = set()

RECORD_INTERVAL_S = 1.0


def _mission_packet(packet: Telemetry) -> Telemetry:
    latitude, longitude, altitude = mission_manager.simulated_position()
    return packet.model_copy(update={
        "gnss_position": packet.gnss_position.model_copy(update={
            "latitude_deg": latitude,
            "longitude_deg": longitude,
            "altitude_m": max(packet.gnss_position.altitude_m, altitude),
        }),
        "barometer": packet.barometer.model_copy(update={"relative_altitude_m": max(packet.barometer.relative_altitude_m, altitude)}),
        "mission_status": mission_manager.status(),
    })


async def _record_loop() -> None:
    """Persist one telemetry packet per second for the lifetime of the app."""
    while True:
        try:
            packet = provider.latest()
            if packet is not None:
                mission_event = mission_manager.tick()
                if mission_event:
                    await _broadcast_mission_event(mission_event)
                    notification = notification_manager.from_mission_event(
                        code=mission_event.code,
                        message=mission_event.message,
                        source=packet.data_source,
                        mission_id=mission_event.mission_id,
                        event_id=f"{packet.data_source.value}:mission:{mission_event.id}",
                    )
                    if notification:
                        await _broadcast_notification_event(notification)
                packet = _mission_packet(packet)
                policy = settings_store.load().notifications
                recorder.set_notification_policy(policy)
                created = recorder.record(packet)
                stale_notification = notification_manager.on_stale(source=packet.data_source, stale=provider.stale)
                if stale_notification:
                    created.append(stale_notification)
                failsafe = evaluate_failsafe(packet, FailsafePolicy(), stale=provider.stale, mission_state=mission_manager.selected().state.value)
                failsafe_notification = notification_manager.on_failsafe_state(
                    source=packet.data_source,
                    active=not failsafe.preflight_ready,
                    mission_id=mission_manager.selected_id,
                )
                if failsafe_notification:
                    created.append(failsafe_notification)
                for notification in created:
                    await _broadcast_notification_event(notification)
            else:
                default_source = DataSource.SIMULATION if provider.name == "simulation" else DataSource.HARDWARE
                stale_notification = notification_manager.on_stale(source=default_source, stale=provider.stale)
                if stale_notification:
                    await _broadcast_notification_event(stale_notification)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Telemetry recording cycle failed")
        await asyncio.sleep(RECORD_INTERVAL_S)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    global provider_start_error
    try:
        await provider.start()
        logger.info("Started telemetry provider: %s", provider.name)
    except Exception as exc:
        provider_start_error = str(exc)
        logger.error("Telemetry provider failed to start: %s", exc)
    task = asyncio.create_task(_record_loop())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        store.close()
        await provider.stop()
        logger.info("Stopping VEGA-Pilot simulation provider")


app = FastAPI(title="VEGA-Pilot Telemetry API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "PUT", "POST"],
    allow_headers=["*"],
)


def _parse_datetime(value: str | None, *, end_of_day: bool) -> datetime | None:
    """Parse an ISO-8601 date or date-time into an aware UTC datetime."""
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    if text[-1] in ("Z", "z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid date-time value: {value!r}"
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    parsed = parsed.astimezone(UTC)
    if end_of_day and len(text) <= 10:
        parsed = parsed.replace(hour=23, minute=59, second=59, microsecond=999_999)
    return parsed


def _build_filter(
    start: str | None,
    end: str | None,
    sensor: str | None,
    severity: str | None,
    event_type: str | None,
    data_source: str | None,
    search: str | None,
    category: str | None = None,
) -> LogFilter:
    """Build a normalised log filter from the query parameters."""
    return LogFilter(
        start=_parse_datetime(start, end_of_day=False),
        end=_parse_datetime(end, end_of_day=True),
        sensor=sensor,
        severity=severity,
        event_type=event_type,
        category=category,
        data_source=data_source,
        search=search,
    ).normalised()


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {
        "status": "degraded" if provider_start_error else "ok",
        "service": "vega-pilot-backend",
        "mode": provider.name,
        "provider_connected": str(provider.connected).lower(),
        "provider_stale": str(provider.stale).lower(),
        "provider_error": provider_start_error or "",
        "serial_protocol": getattr(provider, "protocol", ""),
        "packet_error_count": str(getattr(provider, "packet_error_count", 0)),
        "valid_packet_count": str(getattr(provider, "valid_packet_count", 0)),
        "invalid_packet_count": str(getattr(provider, "invalid_packet_count", 0)),
        "reconnect_attempts": str(getattr(provider, "reconnect_attempts", 0)),
        "packet_sequence": str(getattr(provider, "packet_sequence", 0)),
        "timeout_count": str(getattr(provider, "timeout_count", 0)),
        "last_valid_packet_at": (
            getattr(provider, "last_valid_packet_at", None).isoformat()
            if getattr(provider, "last_valid_packet_at", None)
            else ""
        ),
        "log_store": "degraded" if store.last_error else "ok",
    }


def _serial_ports() -> list[dict[str, str]]:
    try:
        from serial.tools import list_ports
    except ImportError:
        return []
    return [
        {"device": port.device, "description": port.description or "Serial port"}
        for port in list_ports.comports()
    ]


@app.get("/api/settings", response_model=SettingsState)
async def get_settings() -> SettingsState:
    return settings_store.load()


@app.put("/api/settings/dashboard", response_model=DashboardPreferences)
async def update_dashboard_settings(preferences: DashboardPreferences) -> DashboardPreferences:
    settings = settings_store.load()
    settings.dashboard = preferences
    settings_store.save(settings)
    return preferences


@app.get("/api/notifications/policy", response_model=NotificationPolicy)
async def get_notification_policy() -> NotificationPolicy:
    settings = settings_store.load()
    return settings.notifications


@app.put("/api/notifications/policy", response_model=NotificationPolicy)
async def update_notification_policy(policy: NotificationPolicy) -> NotificationPolicy:
    settings = settings_store.load()
    settings.notifications = policy
    settings_store.save(settings)
    recorder.set_notification_policy(policy)
    return policy


@app.get("/api/notifications", response_model=list[NotificationRecord])
async def notifications(
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    include_dismissed: bool = Query(False),
) -> list[NotificationRecord]:
    return store.list_notifications(limit=limit, offset=offset, include_dismissed=include_dismissed)


@app.get("/api/notifications/unread-count")
async def unread_notifications_count() -> dict[str, int]:
    return {"unread_count": store.unread_notifications_count()}


@app.post("/api/notifications/{notification_id}/read")
async def read_notification(notification_id: str) -> dict[str, bool]:
    changed = store.mark_notification_read(notification_id)
    if not changed:
        raise HTTPException(status_code=404, detail="Notification not found.")
    return {"ok": True}


@app.post("/api/notifications/{notification_id}/dismiss")
async def dismiss_notification(notification_id: str) -> dict[str, bool]:
    changed = store.dismiss_notification(notification_id)
    if not changed:
        raise HTTPException(status_code=404, detail="Notification not found.")
    return {"ok": True}


@app.post("/api/notifications/read-all")
async def read_all_notifications() -> dict[str, int]:
    return {"updated": store.mark_all_notifications_read()}


@app.post("/api/notifications/test", response_model=NotificationRecord)
async def test_notification(
    severity: str = Query("INFORMATION", pattern="^(CRITICAL|WARNING|INFORMATION|SUCCESS)$"),
) -> NotificationRecord:
    if provider.name != "simulation":
        raise HTTPException(status_code=400, detail="Test notifications are available only in simulation mode.")
    source = DataSource.SIMULATION if provider.name == "simulation" else DataSource.HARDWARE
    level = NotificationSeverity(severity)
    notification = notification_manager.emit(
        event_id=f"{source.value}:test:{severity}:{int(datetime.now(UTC).timestamp())}",
        alert_type="TEST_NOTIFICATION",
        severity=level,
        title=f"Test {severity.title()} notification",
        message="This is a test notification generated for dashboard validation.",
        voice_message=f"{severity.title()} test alert.",
        source=source,
        mission_id=mission_manager.selected_id,
        timestamp=datetime.now(UTC),
    )
    if notification is None:
        raise HTTPException(status_code=409, detail="Unable to create test notification.")
    await _broadcast_notification_event(notification)
    return notification


@app.get("/api/settings/serial/ports")
async def serial_ports() -> list[dict[str, str]]:
    return _serial_ports()


@app.put("/api/settings/serial", response_model=SerialSettings)
async def update_serial_settings(serial: SerialSettings) -> SerialSettings:
    settings = settings_store.load()
    settings.serial = serial
    settings_store.save(settings)
    return serial


@app.put("/api/settings/source", response_model=SettingsState)
async def update_source(source: str = Query(..., pattern="^(simulation|hardware)$")) -> SettingsState:
    global provider, provider_start_error
    current = settings_store.load()
    if source == "simulation":
        replacement: TelemetryProvider = SimulationTelemetryProvider()
    else:
        replacement = SerialProvider(
            port=current.serial.port,
            baudrate=current.serial.baud_rate,
        )
    await provider.stop()
    provider = replacement
    provider_start_error = None
    current.source = source
    settings_store.save(current)
    return current


@app.post("/api/settings/serial/connect", response_model=SettingsState)
async def connect_serial() -> SettingsState:
    global provider, provider_start_error
    settings = settings_store.load()
    if settings.source != "hardware":
        raise HTTPException(status_code=409, detail="Select hardware mode before connecting a serial provider.")
    if not settings.serial.port:
        raise HTTPException(status_code=400, detail="A serial port is required before connecting.")
    if not isinstance(provider, SerialProvider) or provider.port != settings.serial.port:
        await provider.stop()
        provider = SerialProvider(port=settings.serial.port, baudrate=settings.serial.baud_rate)
    try:
        await provider.start()
        provider_start_error = None
    except Exception as exc:
        provider_start_error = str(exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return settings


@app.post("/api/settings/serial/disconnect", response_model=SettingsState)
async def disconnect_serial() -> SettingsState:
    global provider
    await provider.stop()
    return settings_store.load()


@app.get("/api/telemetry/latest", response_model=Telemetry)
async def latest_telemetry() -> Telemetry:
    packet = provider.latest()
    if packet is None:
        raise HTTPException(status_code=503, detail="No decoded telemetry packet is available.")
    return _mission_packet(packet)


@app.post("/api/simulation/faults")
async def inject_simulation_fault(
    fault: str = Query(..., pattern="^(gnss|battery|communication)$"),
) -> dict[str, str]:
    if provider.name != "simulation" or not isinstance(provider, SimulationTelemetryProvider):
        raise HTTPException(status_code=409, detail="Simulation fault injection is unavailable in hardware mode.")
    already_active = provider.has_fault(fault)
    provider.inject_fault(fault)
    packet = _mission_packet(provider.latest())
    recorder.set_notification_policy(settings_store.load().notifications)
    created = recorder.record(packet)
    if not already_active and not any(item.alert_type in {
        "GNSS_FAULT", "LOW_BATTERY_WARNING", "LOW_BATTERY_CRITICAL", "TELEMETRY_LOST"
    } for item in created):
        details = {
            "gnss": ("GNSS_FAULT", NotificationSeverity.WARNING, "GNSS signal lost", "Warning. GNSS signal lost."),
            "battery": ("LOW_BATTERY_CRITICAL", NotificationSeverity.CRITICAL, "Critical battery condition", "Critical alert. Drone battery level is critical."),
            "communication": ("TELEMETRY_LOST", NotificationSeverity.WARNING, "Telemetry connection lost", "Warning. Telemetry connection lost."),
        }[fault]
        fallback = notification_manager.emit(
            event_id=f"simulation:fault-injection:{fault}:{uuid4()}",
            alert_type=details[0],
            severity=details[1],
            title=details[2],
            message=f"Simulated {fault} fault injected.",
            voice_message=details[3],
            source=DataSource.SIMULATION,
        )
        if fallback:
            created.append(fallback)
    for notification in created:
        await _broadcast_notification_event(notification)
    await _broadcast_telemetry_packet(packet)
    return {"fault": fault, "status": "injected"}


@app.delete("/api/simulation/faults")
async def clear_simulation_faults() -> dict[str, str]:
    if provider.name != "simulation" or not isinstance(provider, SimulationTelemetryProvider):
        raise HTTPException(status_code=409, detail="Simulation fault recovery is unavailable in hardware mode.")
    provider.clear_faults()
    packet = _mission_packet(provider.latest())
    recorder.set_notification_policy(settings_store.load().notifications)
    created = recorder.record(packet)
    for notification in created:
        await _broadcast_notification_event(notification)
    await _broadcast_telemetry_packet(packet)
    return {"status": "cleared"}


@app.get("/api/mission", response_model=MissionResponse)
async def mission() -> MissionResponse:
    current = mission_manager.selected()
    status = mission_manager.status(current)
    return MissionResponse(
        id=current.id,
        name=current.name,
        state=status.state,
        waypoints=current.waypoints,
        completion_percent=status.completed_waypoints / status.total_waypoints * 100,
        home_latitude_deg=current.home_latitude_deg,
        home_longitude_deg=current.home_longitude_deg,
    )


@app.get("/api/missions", response_model=list[MissionDraft])
async def missions() -> list[MissionDraft]:
    return mission_store.list_missions()


@app.get("/api/missions/limits", response_model=MissionLimits)
async def mission_limits() -> MissionLimits:
    return mission_store.limits()


@app.get("/api/missions/{mission_id}/route-length")
async def mission_route_length(mission_id: str) -> dict[str, float]:
    try:
        mission = mission_store.get(mission_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Mission not found.") from exc
    return {"distance_m": MissionStore.route_length_m(mission)}


@app.get("/api/missions/{mission_id}", response_model=MissionDraft)
async def get_mission(mission_id: str) -> MissionDraft:
    try:
        return mission_store.get(mission_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Mission not found.") from exc


@app.post("/api/missions", response_model=MissionDraft, status_code=201)
async def create_mission(mission: MissionDraft) -> MissionDraft:
    return mission_store.save(mission.model_copy(update={"id": mission.id or str(uuid4())}))


@app.put("/api/missions/{mission_id}", response_model=MissionDraft)
async def update_mission(mission_id: str, mission: MissionDraft) -> MissionDraft:
    try:
        current = mission_store.get(mission_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Mission not found.") from exc
    if current.state in (MissionState.UPLOADED, MissionState.EXECUTING):
        raise HTTPException(status_code=409, detail="Executing or uploaded missions cannot be edited.")
    return mission_store.save(mission.model_copy(update={"id": mission_id, "revision": current.revision + 1}))


@app.delete("/api/missions/{mission_id}", status_code=204)
async def delete_mission(mission_id: str) -> None:
    if mission_id == mission_manager.selected_id:
        raise HTTPException(status_code=409, detail="Select another mission before deleting the active draft.")
    try:
        mission_store.get(mission_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Mission not found.") from exc
    mission_store.delete(mission_id)


@app.post("/api/missions/{mission_id}/select", response_model=MissionDraft)
async def select_mission(mission_id: str) -> MissionDraft:
    try:
        return mission_manager.select(mission_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Mission not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/missions/{mission_id}/events", response_model=list[MissionEvent])
async def mission_events(mission_id: str) -> list[MissionEvent]:
    return mission_store.events(mission_id)


@app.get("/api/missions/{mission_id}/commands", response_model=list[MissionCommandResult])
async def mission_commands(mission_id: str) -> list[MissionCommandResult]:
    return mission_store.commands(mission_id)


@app.post("/api/missions/{mission_id}/commands/{command}", response_model=MissionCommandResult)
async def mission_command(mission_id: str, command: str, command_id: str = Query(..., min_length=8)) -> MissionCommandResult:
    if mission_id != mission_manager.selected_id:
        try:
            mission_manager.select(mission_id)
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    try:
        result = mission_manager.execute(command, command_id, provider.name != "simulation")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await _broadcast_mission_event(result)
    if provider.name == "simulation":
        notification = notification_manager.from_mission_event(
            code=f"MISSION_{command.upper()}",
            message=result.message,
            source=DataSource.SIMULATION,
            mission_id=result.mission_id,
            state=result.state,
            event_id=f"simulation:command:{result.command_id}",
        )
        if notification:
            await _broadcast_notification_event(notification)
    return result


@app.post("/api/missions/{mission_id}/simulation-command", response_model=MissionCommandResult)
async def simulation_command(
    mission_id: str,
    command: str = Query(..., pattern="^(start|pause|resume|abort|rth|standby|reset)$"),
    command_id: str = Query(..., min_length=8),
) -> MissionCommandResult:
    if provider.name != "simulation":
        raise HTTPException(status_code=409, detail="Simulation commands are unavailable in hardware mode.")
    return await mission_command(mission_id, command, command_id)


@app.post("/api/missions/{mission_id}/simulation-upload", response_model=MissionCommandResult)
async def simulation_upload(mission_id: str, command_id: str = Query(..., min_length=8)) -> MissionCommandResult:
    if provider.name != "simulation":
        raise HTTPException(status_code=409, detail="Simulation upload is unavailable in hardware mode.")
    return await mission_command(mission_id, "upload", command_id)


@app.get("/api/missions/commands/{command_id}", response_model=MissionCommandResult)
async def mission_command_status(command_id: str) -> MissionCommandResult:
    try:
        return mission_manager.command_status(command_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Mission command not found.") from exc


@app.post("/api/missions/commands/{command_id}/ack", response_model=MissionCommandResult)
async def acknowledge_mission_command(
    command_id: str,
    status: CommandLifecycle = Query(..., description="ARIES V3 reported lifecycle state"),
) -> MissionCommandResult:
    try:
        result = mission_manager.acknowledge(command_id, status)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await _broadcast_mission_event(result)
    return result


@app.get("/api/failsafe/policy", response_model=FailsafePolicy)
async def get_failsafe_policy() -> FailsafePolicy:
    settings = settings_store.load()
    return FailsafePolicy.model_validate(settings.safety.failsafe_policy or {})


@app.put("/api/failsafe/policy", response_model=FailsafePolicy)
async def update_failsafe_policy(policy: FailsafePolicy) -> FailsafePolicy:
    settings = settings_store.load()
    settings.safety.failsafe_policy = policy.model_dump(mode="json")
    settings.safety.validation_status = policy.validation_status
    settings_store.save(settings)
    return policy


@app.get("/api/failsafe/status", response_model=FailsafeStatus)
async def failsafe_status() -> FailsafeStatus:
    policy = FailsafePolicy.model_validate(settings_store.load().safety.failsafe_policy or {})
    return evaluate_failsafe(
        provider.latest(),
        policy,
        stale=provider.stale,
        mission_state=mission_manager.selected().state.value,
    )


async def _broadcast_mission_event(payload: object) -> None:
    if not mission_clients:
        return
    message = payload.model_dump(mode="json") if hasattr(payload, "model_dump") else payload
    stale_clients: list[WebSocket] = []
    for client in mission_clients:
        try:
            await client.send_json({"type": "mission_event", "payload": message})
        except Exception:
            stale_clients.append(client)
    for client in stale_clients:
        mission_clients.discard(client)


async def _broadcast_notification_event(notification: NotificationRecord) -> None:
    if not mission_clients:
        return
    stale_clients: list[WebSocket] = []
    message = {"type": "notification_event", "payload": notification.model_dump(mode="json")}
    for client in mission_clients:
        try:
            await client.send_json(message)
        except Exception:
            stale_clients.append(client)
    for client in stale_clients:
        mission_clients.discard(client)


async def _broadcast_telemetry_packet(packet: Telemetry) -> None:
    stale_clients: list[WebSocket] = []
    for client in mission_clients:
        try:
            await client.send_json(packet.model_dump(mode="json"))
        except Exception:
            stale_clients.append(client)
    for client in stale_clients:
        mission_clients.discard(client)


@app.get("/api/logs", response_model=list[LogEntry])
def logs() -> list[LogEntry]:
    """Return the most recent stored records as plain log lines."""
    _, rows = store.query_records(LogFilter().normalised(), limit=100, offset=0, mission_db_path=mission_store.path)
    entries = [
        LogEntry(
            timestamp=row["timestamp"],
            level=row["severity"],
            message=f"[{row['event_type']}] {row['message']}",
        )
        for row in rows
    ]
    if not entries:
        telemetry = provider.latest()
        if telemetry is None:
            raise HTTPException(status_code=503, detail="No decoded telemetry packet is available.")
        entries.append(
            LogEntry(
                timestamp=telemetry.timestamp,
                level="INFO",
                message="Simulation telemetry provider active; no hardware connected.",
            )
        )
    return entries


@app.get("/api/logs/records", response_model=LogRecordsResponse)
def log_records(
    start: str | None = Query(None, description="ISO-8601 start date or date-time"),
    end: str | None = Query(None, description="ISO-8601 end date or date-time"),
    sensor: str | None = Query(None, description="Sensor attributed to the record"),
    severity: str | None = Query(None, description="INFO, WARNING, ERROR or CRITICAL"),
    event_type: str | None = Query(None, description="Legacy event type"),
    category: str | None = Query(None, description="Telemetry, Mission, Waypoint, Sensor, Battery, Communication, Failsafe or System"),
    data_source: str | None = Query(None, description="simulation or hardware"),
    search: str | None = Query(None, description="Free text match on message or code"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> LogRecordsResponse:
    """Return stored telemetry, fault and system records matching the filters."""
    filters = _build_filter(start, end, sensor, severity, event_type, data_source, search, category)
    total, rows = store.query_records(filters, limit, offset, mission_db_path=mission_store.path)
    return LogRecordsResponse(
        total=total,
        limit=limit,
        offset=offset,
        records=[LogRecordModel(**row) for row in rows],
        database_error=store.last_error,
    )


@app.get("/api/logs/history", response_model=LogHistoryResponse)
def log_history(
    start: str | None = Query(None, description="ISO-8601 start date or date-time"),
    end: str | None = Query(None, description="ISO-8601 end date or date-time"),
    data_source: str | None = Query(None, description="simulation or hardware"),
    max_points: int = Query(240, ge=10, le=2000),
) -> LogHistoryResponse:
    """Return the stored battery voltage and altitude history for charting."""
    filters = _build_filter(start, end, None, None, None, data_source, None)
    points = store.query_history(filters, max_points)
    return LogHistoryResponse(
        points=[LogHistoryPoint(**point) for point in points],
        database_error=store.last_error,
    )


@app.get("/api/logs/stats", response_model=LogStatsResponse)
def log_stats(
    start: str | None = Query(None, description="ISO-8601 start date or date-time"),
    end: str | None = Query(None, description="ISO-8601 end date or date-time"),
    sensor: str | None = Query(None, description="Sensor attributed to the record"),
    severity: str | None = Query(None, description="INFO, WARNING, ERROR or CRITICAL"),
    event_type: str | None = Query(None, description="Legacy event type"),
    category: str | None = Query(None, description="Unified event category"),
    data_source: str | None = Query(None, description="simulation or hardware"),
    search: str | None = Query(None, description="Free text match on message or code"),
) -> LogStatsResponse:
    """Return record counts for the dashboard summary cards."""
    filters = _build_filter(start, end, sensor, severity, event_type, data_source, search, category)
    stats = store.query_stats(filters, mission_db_path=mission_store.path)
    return LogStatsResponse(**stats, database_error=store.last_error)


@app.get("/api/logs/export.csv")
def export_logs_csv(
    start: str | None = Query(None, description="ISO-8601 start date or date-time"),
    end: str | None = Query(None, description="ISO-8601 end date or date-time"),
    sensor: str | None = Query(None, description="Sensor attributed to the record"),
    severity: str | None = Query(None, description="INFO, WARNING, ERROR or CRITICAL"),
    event_type: str | None = Query(None, description="Legacy event type"),
    category: str | None = Query(None, description="Unified event category"),
    data_source: str | None = Query(None, description="simulation or hardware"),
    search: str | None = Query(None, description="Free text match on message or code"),
) -> Response:
    """Export every matching record as CSV."""
    filters = _build_filter(start, end, sensor, severity, event_type, data_source, search, category)
    payload = store.export_csv(filters, mission_db_path=mission_store.path)
    filename = f"vega-pilot-logs-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.csv"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "X-Log-Store-Status": "degraded" if store.last_error else "ok",
    }
    return Response(content=payload, media_type="text/csv; charset=utf-8", headers=headers)


@app.websocket("/ws/telemetry")
async def telemetry_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    mission_clients.add(websocket)
    packet = provider.latest()
    source = packet.data_source.value if packet is not None else provider.name
    recorder.record_client_connected(source)
    logger.info("Telemetry WebSocket connected: %s", websocket.client)
    try:
        while True:
            packet = provider.latest()
            if packet is not None:
                packet = _mission_packet(packet)
                await websocket.send_json(packet.model_dump(mode="json"))
            else:
                await websocket.send_json(
                    {"type": "status", "provider": provider.name, "connected": provider.connected, "stale": provider.stale}
                )
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        mission_clients.discard(websocket)
        recorder.record_client_disconnected(source)
        logger.info("Telemetry WebSocket disconnected: %s", websocket.client)
    except Exception:
        mission_clients.discard(websocket)
        logger.exception("Unexpected telemetry WebSocket failure")
        recorder.record_client_disconnected(source)
        await websocket.close(code=1011, reason="Telemetry stream failed")


@app.get("/api/diagnostics/messages")
async def diagnostic_messages() -> list[dict[str, str]]:
    """Return recent raw provider messages without decoding or inventing a format."""
    return [
        {
            "timestamp": message.timestamp.isoformat(),
            "source": message.source,
            "direction": message.direction,
            "payload_hex": message.payload_hex,
            "payload_text": message.payload_text,
            "status": message.status,
        }
        for message in await provider.diagnostics()
    ]


@app.websocket("/ws/diagnostics")
async def diagnostics_socket(websocket: WebSocket) -> None:
    """Stream raw incoming messages for the diagnostic view."""
    await websocket.accept()
    try:
        last_count = -1
        while True:
            messages = await provider.diagnostics()
            if len(messages) != last_count:
                await websocket.send_json(
                    [
                        {
                            "timestamp": message.timestamp.isoformat(),
                            "source": message.source,
                            "direction": message.direction,
                            "payload_hex": message.payload_hex,
                            "payload_text": message.payload_text,
                            "status": message.status,
                        }
                        for message in messages
                    ]
                )
                last_count = len(messages)
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        logger.info("Diagnostics WebSocket disconnected: %s", websocket.client)
    except Exception:
        logger.exception("Unexpected diagnostics WebSocket failure")
        await websocket.close(code=1011, reason="Diagnostics stream failed")


@app.get("/diagnostics", response_class=HTMLResponse)
async def diagnostics_page() -> str:
    """Serve a minimal raw-message diagnostic page for integration bring-up."""
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>VEGA-Pilot diagnostics</title>
<style>body{font:14px monospace;background:#071321;color:#d5e1ef;margin:2rem}
pre{white-space:pre-wrap;border:1px solid #286079;padding:1rem;max-height:75vh;overflow:auto}
.ok{color:#6ee7b7}.warn{color:#fbbf24}</style></head>
<body><h1>VEGA-Pilot telemetry diagnostics</h1>
<p id="state" class="warn">CONNECTING</p><p>Raw provider messages only. No packet format is assumed.</p>
<pre id="messages">Waiting for messages...</pre>
<script>
const state = document.getElementById('state');
const messages = document.getElementById('messages');
const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/diagnostics');
socket.onopen = () => { state.textContent = 'CONNECTED'; state.className = 'ok'; };
socket.onclose = () => { state.textContent = 'DISCONNECTED'; state.className = 'warn'; };
socket.onerror = () => { state.textContent = 'ERROR'; state.className = 'warn'; };
socket.onmessage = event => { messages.textContent = JSON.stringify(JSON.parse(event.data), null, 2); };
</script></body></html>"""
