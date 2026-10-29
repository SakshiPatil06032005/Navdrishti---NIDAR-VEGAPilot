"""FastAPI application for the VEGA-Pilot simulated telemetry backend.

Telemetry packets, fault events and system events are persisted into SQLite by
the background recorder so the ground control station can search, filter, chart
and export the flight history. Every record carries the data source it came
from, so simulated frames are never mixed with hardware frames.
"""

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response

from .database import DEFAULT_DB_PATH, LogFilter, LogStore
from .models import (
    LogEntry,
    LogHistoryPoint,
    LogHistoryResponse,
    LogRecordModel,
    LogRecordsResponse,
    LogStatsResponse,
    MissionResponse,
    Telemetry,
)
from .recorder import TelemetryRecorder
from .providers import TelemetryProvider, provider_from_environment
from .simulation import mission_snapshot

UTC = timezone.utc

logger = logging.getLogger(__name__)
provider: TelemetryProvider = provider_from_environment()
provider_start_error: str | None = None

#: The log store location can be overridden so tests never touch the real data.
store = LogStore(os.environ.get("VEGA_PILOT_DB") or DEFAULT_DB_PATH)
recorder = TelemetryRecorder(store)

RECORD_INTERVAL_S = 1.0


async def _record_loop() -> None:
    """Persist one telemetry packet per second for the lifetime of the app."""
    while True:
        try:
            packet = provider.latest()
            if packet is not None:
                recorder.record(packet)
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
    allow_methods=["GET"],
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
) -> LogFilter:
    """Build a normalised log filter from the query parameters."""
    return LogFilter(
        start=_parse_datetime(start, end_of_day=False),
        end=_parse_datetime(end, end_of_day=True),
        sensor=sensor,
        severity=severity,
        event_type=event_type,
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
        "log_store": "degraded" if store.last_error else "ok",
    }


@app.get("/api/telemetry/latest", response_model=Telemetry)
async def latest_telemetry() -> Telemetry:
    packet = provider.latest()
    if packet is None:
        raise HTTPException(status_code=503, detail="No decoded telemetry packet is available.")
    return packet


@app.get("/api/mission", response_model=MissionResponse)
async def mission() -> MissionResponse:
    return MissionResponse.model_validate(mission_snapshot())


@app.get("/api/logs", response_model=list[LogEntry])
def logs() -> list[LogEntry]:
    """Return the most recent stored records as plain log lines."""
    _, rows = store.query_records(LogFilter().normalised(), limit=100, offset=0)
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
    event_type: str | None = Query(None, description="TELEMETRY, FAULT or SYSTEM"),
    data_source: str | None = Query(None, description="simulation or hardware"),
    search: str | None = Query(None, description="Free text match on message or code"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> LogRecordsResponse:
    """Return stored telemetry, fault and system records matching the filters."""
    filters = _build_filter(start, end, sensor, severity, event_type, data_source, search)
    total, rows = store.query_records(filters, limit, offset)
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
    event_type: str | None = Query(None, description="TELEMETRY, FAULT or SYSTEM"),
    data_source: str | None = Query(None, description="simulation or hardware"),
    search: str | None = Query(None, description="Free text match on message or code"),
) -> LogStatsResponse:
    """Return record counts for the dashboard summary cards."""
    filters = _build_filter(start, end, sensor, severity, event_type, data_source, search)
    stats = store.query_stats(filters)
    return LogStatsResponse(**stats, database_error=store.last_error)


@app.get("/api/logs/export.csv")
def export_logs_csv(
    start: str | None = Query(None, description="ISO-8601 start date or date-time"),
    end: str | None = Query(None, description="ISO-8601 end date or date-time"),
    sensor: str | None = Query(None, description="Sensor attributed to the record"),
    severity: str | None = Query(None, description="INFO, WARNING, ERROR or CRITICAL"),
    event_type: str | None = Query(None, description="TELEMETRY, FAULT or SYSTEM"),
    data_source: str | None = Query(None, description="simulation or hardware"),
    search: str | None = Query(None, description="Free text match on message or code"),
) -> Response:
    """Export every matching record as CSV."""
    filters = _build_filter(start, end, sensor, severity, event_type, data_source, search)
    payload = store.export_csv(filters)
    filename = f"vega-pilot-logs-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.csv"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "X-Log-Store-Status": "degraded" if store.last_error else "ok",
    }
    return Response(content=payload, media_type="text/csv; charset=utf-8", headers=headers)


@app.websocket("/ws/telemetry")
async def telemetry_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    packet = provider.latest()
    source = packet.data_source.value if packet is not None else provider.name
    recorder.record_client_connected(source)
    logger.info("Telemetry WebSocket connected: %s", websocket.client)
    try:
        while True:
            packet = provider.latest()
            if packet is not None:
                await websocket.send_json(packet.model_dump(mode="json"))
            else:
                await websocket.send_json(
                    {"type": "status", "provider": provider.name, "connected": provider.connected, "stale": provider.stale}
                )
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        recorder.record_client_disconnected(source)
        logger.info("Telemetry WebSocket disconnected: %s", websocket.client)
    except Exception:
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
