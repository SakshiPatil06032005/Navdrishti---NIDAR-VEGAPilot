"""SQLite persistence for telemetry, fault events and system events.

Telemetry packets, fault events and system events are kept in three separate
tables so that faults are never mixed with routine telemetry samples. A single
``log_records`` view unions the three tables into one row shape so the API can
filter, sort, chart and export every record type uniformly.

Every operation degrades gracefully: database failures are captured in
``last_error`` and reported to the caller instead of raising, so a broken log
store never takes the telemetry API down.
"""

from __future__ import annotations

import csv
import io
import logging
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .models import FaultEvent, SensorStatus, Telemetry

UTC = timezone.utc

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "vega_pilot.db"

EVENT_TELEMETRY = "TELEMETRY"
EVENT_FAULT = "FAULT"
EVENT_SYSTEM = "SYSTEM"

SEVERITY_INFO = "INFO"
SEVERITY_WARNING = "WARNING"
SEVERITY_ERROR = "ERROR"
SEVERITY_CRITICAL = "CRITICAL"

SENSOR_LINK = "link"

EVENT_CONNECTION_LOST = "CONNECTION_LOST"
EVENT_CONNECTION_RESTORED = "CONNECTION_RESTORED"
EVENT_CLIENT_CONNECTED = "CLIENT_CONNECTED"
EVENT_CLIENT_DISCONNECTED = "CLIENT_DISCONNECTED"

#: Repeated faults with the same code are only stored once per window.
FAULT_DEDUPE_WINDOW = timedelta(seconds=60)
#: Repeated system events with the same type/message are only stored once per window.
SYSTEM_DEDUPE_WINDOW = timedelta(seconds=10)

CSV_COLUMNS = (
    "timestamp",
    "recorded_at",
    "event_type",
    "severity",
    "data_source",
    "sensor",
    "code",
    "message",
    "flight_mode",
    "battery_voltage_v",
    "altitude_m",
    "relative_altitude_m",
    "link_connected",
    "link_signal_percent",
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS telemetry_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    data_source TEXT NOT NULL,
    flight_mode TEXT NOT NULL,
    battery_voltage_v REAL NOT NULL,
    battery_remaining_percent REAL NOT NULL,
    altitude_m REAL NOT NULL,
    relative_altitude_m REAL NOT NULL,
    vertical_speed_mps REAL NOT NULL,
    ground_speed_mps REAL NOT NULL,
    latitude_deg REAL NOT NULL,
    longitude_deg REAL NOT NULL,
    imu_status TEXT NOT NULL,
    gnss_status TEXT NOT NULL,
    barometer_status TEXT NOT NULL,
    battery_status TEXT NOT NULL,
    sensors TEXT NOT NULL DEFAULT '',
    link_connected INTEGER NOT NULL,
    link_signal_percent REAL NOT NULL,
    link_latency_ms REAL NOT NULL,
    UNIQUE (timestamp, data_source)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry_records (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_source ON telemetry_records (data_source, timestamp DESC);

CREATE TABLE IF NOT EXISTS fault_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    data_source TEXT NOT NULL,
    severity TEXT NOT NULL,
    code TEXT NOT NULL,
    message TEXT NOT NULL,
    sensor TEXT,
    UNIQUE (timestamp, data_source, code, message)
);

CREATE INDEX IF NOT EXISTS idx_fault_timestamp ON fault_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_fault_code ON fault_events (code, timestamp DESC);

CREATE TABLE IF NOT EXISTS system_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    data_source TEXT NOT NULL,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    sensor TEXT,
    message TEXT NOT NULL,
    UNIQUE (timestamp, data_source, event_type, message)
);

CREATE INDEX IF NOT EXISTS idx_system_timestamp ON system_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_system_type ON system_events (event_type, timestamp DESC);

CREATE VIEW IF NOT EXISTS log_records AS
SELECT
    'T' || telemetry_records.id AS uid,
    telemetry_records.timestamp AS timestamp,
    telemetry_records.recorded_at AS recorded_at,
    'TELEMETRY' AS event_type,
    telemetry_records.data_source AS data_source,
    'INFO' AS severity,
    telemetry_records.sensors AS sensor,
    NULL AS code,
    'Telemetry packet · ' || telemetry_records.flight_mode || ' · ' ||
        printf('%.2f V battery', telemetry_records.battery_voltage_v) || ' · ' ||
        printf('%.1f m altitude', telemetry_records.altitude_m) AS message,
    telemetry_records.flight_mode AS flight_mode,
    telemetry_records.battery_voltage_v AS battery_voltage_v,
    telemetry_records.altitude_m AS altitude_m,
    telemetry_records.relative_altitude_m AS relative_altitude_m,
    telemetry_records.link_connected AS link_connected,
    telemetry_records.link_signal_percent AS link_signal_percent
FROM telemetry_records
UNION ALL
SELECT
    'F' || fault_events.id,
    fault_events.timestamp,
    fault_events.recorded_at,
    'FAULT',
    fault_events.data_source,
    fault_events.severity,
    fault_events.sensor,
    fault_events.code,
    fault_events.message,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
FROM fault_events
UNION ALL
SELECT
    'S' || system_events.id,
    system_events.timestamp,
    system_events.recorded_at,
    'SYSTEM',
    system_events.data_source,
    system_events.severity,
    system_events.sensor,
    system_events.event_type,
    system_events.message,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
FROM system_events;
"""


def _iso(value: datetime) -> str:
    """Return a UTC-normalised ISO-8601 string with fixed precision."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat(timespec="microseconds")


@dataclass(frozen=True)
class LogFilter:
    """Filter criteria shared by the record, history and export queries."""

    start: datetime | None = None
    end: datetime | None = None
    sensor: str | None = None
    severity: str | None = None
    event_type: str | None = None
    data_source: str | None = None
    search: str | None = None

    def normalised(self) -> "LogFilter":
        """Trim optional values and drop empty filters."""
        return LogFilter(
            start=self.start,
            end=self.end,
            sensor=self.sensor.strip() or None if self.sensor else None,
            severity=self.severity.strip().upper() or None if self.severity else None,
            event_type=self.event_type.strip().upper() or None if self.event_type else None,
            data_source=self.data_source.strip().lower() or None if self.data_source else None,
            search=self.search.strip() or None if self.search else None,
        )


def _build_where(filters: LogFilter, source: str = "view") -> tuple[str, list[Any]]:
    """Build a parameterised WHERE clause for the log record view or telemetry table.

    ``source="view"`` targets the unified ``log_records`` view, while
    ``source="telemetry"`` targets the raw ``telemetry_records`` table used by
    the history query.
    """
    clauses: list[str] = []
    params: list[Any] = []
    telemetry = source == "telemetry"

    if filters.start is not None:
        clauses.append("timestamp >= ?")
        params.append(_iso(filters.start))
    if filters.end is not None:
        clauses.append("timestamp <= ?")
        params.append(_iso(filters.end))
    if filters.data_source:
        clauses.append("data_source = ?")
        params.append(filters.data_source)

    if telemetry:
        if filters.severity and filters.severity != SEVERITY_INFO:
            clauses.append("1 = 0")
        if filters.event_type and filters.event_type != EVENT_TELEMETRY:
            clauses.append("1 = 0")
        if filters.sensor:
            clauses.append("sensors LIKE ?")
            params.append(f"%{filters.sensor.strip()}%")
        if filters.search:
            clauses.append("(flight_mode LIKE ? OR sensors LIKE ?)")
            params.extend([f"%{filters.search}%", f"%{filters.search}%"])
    else:
        if filters.severity:
            clauses.append("severity = ?")
            params.append(filters.severity)
        if filters.event_type:
            clauses.append("event_type = ?")
            params.append(filters.event_type)
        if filters.sensor:
            clauses.append("sensor IS NOT NULL AND sensor LIKE ?")
            params.append(f"%{filters.sensor.strip()}%")
        if filters.search:
            clauses.append("(message LIKE ? OR code LIKE ?)")
            params.extend([f"%{filters.search}%", f"%{filters.search}%"])

    if not clauses:
        return "", params
    return "WHERE " + " AND ".join(clauses), params


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    data = {key: row[key] for key in row.keys()}
    sensor = data.get("sensor")
    data["sensor"] = sensor if sensor else None
    return data


class LogStore:
    """Thread-safe SQLite store for telemetry, fault and system events."""

    def __init__(self, path: Path | str | None = None) -> None:
        self.path = Path(path) if path is not None else DEFAULT_DB_PATH
        self._lock = threading.RLock()
        self._conn: sqlite3.Connection | None = None
        self.last_error: str | None = None
        self.available = False

    # ------------------------------------------------------------------
    # connection handling
    # ------------------------------------------------------------------
    def _connect(self) -> sqlite3.Connection | None:
        if self._conn is not None:
            return self._conn
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(self.path, check_same_thread=False, timeout=10.0)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(SCHEMA)
            conn.commit()
        except (sqlite3.Error, OSError) as exc:
            self._fail("connect", exc)
            self.available = False
            return None
        self._conn = conn
        self.available = True
        self.last_error = None
        return conn

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                try:
                    self._conn.close()
                except sqlite3.Error as exc:
                    self._fail("close", exc)
                self._conn = None

    def _fail(self, operation: str, exc: Exception) -> None:
        self.last_error = f"{operation} failed: {exc}"
        logger.error("Log store operation %s failed: %s", operation, exc)

    # ------------------------------------------------------------------
    # writes
    # ------------------------------------------------------------------
    def record_telemetry(self, packet: Telemetry) -> bool:
        """Store a telemetry packet. Returns True when a new row was written."""
        conn = self._connect()
        if conn is None:
            return False

        sensors = ",".join(
            name
            for name, status in (
                ("imu", packet.sensor_health.imu),
                ("gnss", packet.sensor_health.gnss),
                ("barometer", packet.sensor_health.barometer),
                ("battery", packet.sensor_health.battery),
            )
            if status != SensorStatus.VALID
        )

        values = (
            _iso(packet.timestamp),
            _iso(datetime.now(UTC)),
            packet.data_source.value,
            packet.flight_mode.value,
            packet.battery.voltage_v,
            packet.battery.remaining_percent,
            packet.gnss_position.altitude_m,
            packet.barometer.relative_altitude_m,
            packet.barometer.vertical_speed_mps,
            packet.gnss_position.ground_speed_mps,
            packet.gnss_position.latitude_deg,
            packet.gnss_position.longitude_deg,
            packet.sensor_health.imu.value,
            packet.sensor_health.gnss.value,
            packet.sensor_health.barometer.value,
            packet.sensor_health.battery.value,
            sensors,
            1 if packet.telemetry_link.connected else 0,
            packet.telemetry_link.signal_strength_percent,
            packet.telemetry_link.latency_ms,
        )

        try:
            with self._lock:
                cursor = conn.execute(
                    """
                    INSERT OR IGNORE INTO telemetry_records (
                        timestamp, recorded_at, data_source, flight_mode,
                        battery_voltage_v, battery_remaining_percent, altitude_m,
                        relative_altitude_m, vertical_speed_mps, ground_speed_mps,
                        latitude_deg, longitude_deg, imu_status, gnss_status,
                        barometer_status, battery_status, sensors, link_connected,
                        link_signal_percent, link_latency_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    values,
                )
                conn.commit()
                return cursor.rowcount > 0
        except sqlite3.Error as exc:
            self._fail("record_telemetry", exc)
            return False

    def record_fault(
        self,
        fault: FaultEvent,
        data_source: str,
        sensor: str | None = None,
        window: timedelta = FAULT_DEDUPE_WINDOW,
    ) -> bool:
        """Store a fault event, skipping repeats of the same code in the window."""
        conn = self._connect()
        if conn is None:
            return False

        try:
            with self._lock:
                if self._seen_recently(
                    conn,
                    table="fault_events",
                    column="code",
                    keys={"code": fault.code, "data_source": data_source},
                    window=window,
                ):
                    return False
                cursor = conn.execute(
                    """
                    INSERT OR IGNORE INTO fault_events (
                        timestamp, recorded_at, data_source, severity, code, message, sensor
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        _iso(fault.timestamp),
                        _iso(datetime.now(UTC)),
                        data_source,
                        fault.severity,
                        fault.code,
                        fault.message,
                        sensor,
                    ),
                )
                conn.commit()
                return cursor.rowcount > 0
        except sqlite3.Error as exc:
            self._fail("record_fault", exc)
            return False

    def record_system_event(
        self,
        event_type: str,
        severity: str,
        message: str,
        data_source: str,
        sensor: str | None = None,
        window: timedelta = SYSTEM_DEDUPE_WINDOW,
    ) -> bool:
        """Store a system event, skipping identical repeats inside the window."""
        conn = self._connect()
        if conn is None:
            return False

        now = datetime.now(UTC)
        try:
            with self._lock:
                if self._seen_recently(
                    conn,
                    table="system_events",
                    column="event_type",
                    keys={"event_type": event_type, "data_source": data_source, "message": message},
                    window=window,
                ):
                    return False
                cursor = conn.execute(
                    """
                    INSERT OR IGNORE INTO system_events (
                        timestamp, recorded_at, data_source, event_type, severity, sensor, message
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        _iso(now),
                        _iso(now),
                        data_source,
                        event_type,
                        severity,
                        sensor,
                        message,
                    ),
                )
                conn.commit()
                return cursor.rowcount > 0
        except sqlite3.Error as exc:
            self._fail("record_system_event", exc)
            return False

    @staticmethod
    def _seen_recently(
        conn: sqlite3.Connection,
        table: str,
        column: str,
        keys: dict[str, str],
        window: timedelta,
    ) -> bool:
        """Check whether an identical event was already stored inside the window."""
        if window <= timedelta(0):
            return False
        cutoff = _iso(datetime.now(UTC) - window)
        conditions = [f"{key} = ?" for key in keys]
        conditions.append("timestamp >= ?")
        row = conn.execute(
            f"SELECT 1 FROM {table} WHERE {' AND '.join(conditions)} LIMIT 1",
            [*keys.values(), cutoff],
        ).fetchone()
        return row is not None

    # ------------------------------------------------------------------
    # reads
    # ------------------------------------------------------------------
    def query_records(self, filters: LogFilter, limit: int, offset: int) -> tuple[int, list[dict[str, Any]]]:
        """Return the total match count and one page of records, newest first."""
        conn = self._connect()
        if conn is None:
            return 0, []
        where, params = _build_where(filters)
        try:
            with self._lock:
                total = conn.execute(
                    f"SELECT COUNT(*) FROM log_records {where}", params
                ).fetchone()[0]
                rows = conn.execute(
                    f"""
                    SELECT * FROM log_records {where}
                    ORDER BY timestamp DESC, uid DESC
                    LIMIT ? OFFSET ?
                    """,
                    [*params, limit, offset],
                ).fetchall()
            return int(total), [_row_to_dict(row) for row in rows]
        except sqlite3.Error as exc:
            self._fail("query_records", exc)
            return 0, []

    def query_history(self, filters: LogFilter, max_points: int = 240) -> list[dict[str, Any]]:
        """Return a downsampled battery voltage / altitude time series."""
        conn = self._connect()
        if conn is None:
            return []
        where, params = _build_where(filters, source="telemetry")
        try:
            with self._lock:
                rows = conn.execute(
                    f"""
                    SELECT timestamp, battery_voltage_v, altitude_m, relative_altitude_m
                    FROM telemetry_records {where}
                    ORDER BY timestamp ASC
                    """,
                    params,
                ).fetchall()
        except sqlite3.Error as exc:
            self._fail("query_history", exc)
            return []
        return _downsample(rows, max_points)

    def query_stats(self, filters: LogFilter) -> dict[str, int]:
        """Return record counts grouped by event type and severity."""
        conn = self._connect()
        if conn is None:
            return {}
        where, params = _build_where(filters)
        try:
            with self._lock:
                rows = conn.execute(
                    f"SELECT event_type, severity, code, COUNT(*) AS total FROM log_records {where} GROUP BY event_type, severity, code",
                    params,
                ).fetchall()
        except sqlite3.Error as exc:
            self._fail("query_stats", exc)
            return {}

        stats = {
            "total": 0,
            "telemetry": 0,
            "faults": 0,
            "system": 0,
            "warnings": 0,
            "errors": 0,
            "connection_losses": 0,
        }
        for row in rows:
            total = int(row["total"])
            stats["total"] += total
            event_type = row["event_type"]
            severity = row["severity"]
            if event_type == EVENT_TELEMETRY:
                stats["telemetry"] += total
            elif event_type == EVENT_FAULT:
                stats["faults"] += total
            elif event_type == EVENT_SYSTEM:
                stats["system"] += total
            if severity == SEVERITY_WARNING:
                stats["warnings"] += total
            elif severity in (SEVERITY_ERROR, SEVERITY_CRITICAL):
                stats["errors"] += total
            if event_type == EVENT_SYSTEM and row["code"] == EVENT_CONNECTION_LOST:
                stats["connection_losses"] += total
        return stats

    def export_csv(self, filters: LogFilter) -> str:
        """Return every matching record as CSV text, oldest first."""
        conn = self._connect()
        if conn is None:
            return _csv_header()
        where, params = _build_where(filters)
        try:
            with self._lock:
                rows = conn.execute(
                    f"SELECT * FROM log_records {where} ORDER BY timestamp ASC, uid ASC",
                    params,
                ).fetchall()
        except sqlite3.Error as exc:
            self._fail("export_csv", exc)
            return _csv_header()

        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(CSV_COLUMNS)
        for row in rows:
            record = _row_to_dict(row)
            writer.writerow([record.get(column) for column in CSV_COLUMNS])
        return buffer.getvalue()


def _csv_header() -> str:
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="\n").writerow(CSV_COLUMNS)
    return buffer.getvalue()


def _downsample(rows: list[sqlite3.Row], max_points: int) -> list[dict[str, Any]]:
    """Average telemetry rows into at most ``max_points`` buckets."""
    if not rows:
        return []
    if len(rows) <= max_points:
        return [
            {
                "timestamp": row["timestamp"],
                "battery_voltage_v": row["battery_voltage_v"],
                "altitude_m": row["altitude_m"],
                "relative_altitude_m": row["relative_altitude_m"],
            }
            for row in rows
        ]

    bucket_size = len(rows) / max_points
    points: list[dict[str, Any]] = []
    for index in range(max_points):
        start = int(index * bucket_size)
        end = max(start + 1, int((index + 1) * bucket_size))
        chunk = rows[start:end]
        if not chunk:
            continue
        points.append(
            {
                "timestamp": chunk[0]["timestamp"],
                "battery_voltage_v": sum(row["battery_voltage_v"] for row in chunk) / len(chunk),
                "altitude_m": sum(row["altitude_m"] for row in chunk) / len(chunk),
                "relative_altitude_m": sum(row["relative_altitude_m"] for row in chunk) / len(chunk),
            }
        )
    return points
