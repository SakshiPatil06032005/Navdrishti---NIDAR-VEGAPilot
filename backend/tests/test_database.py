"""Tests for the SQLite log store: saving, retrieving, filtering and exporting."""

import csv
import io
from datetime import UTC, datetime, timedelta

import pytest

from backend.database import (
    CSV_COLUMNS,
    EVENT_CONNECTION_LOST,
    EVENT_FAULT,
    EVENT_SYSTEM,
    EVENT_TELEMETRY,
    SEVERITY_ERROR,
    SEVERITY_INFO,
    SEVERITY_WARNING,
    LogFilter,
    LogStore,
)
from backend.models import FaultEvent, SensorStatus
from backend.mission import MissionStore


@pytest.fixture
def store(tmp_path):
    log_store = LogStore(tmp_path / "logs.db")
    yield log_store
    log_store.close()


def test_record_telemetry_is_saved_and_retrieved(store, make_packet):
    packet = make_packet(datetime(2026, 10, 21, 12, 0, 0, tzinfo=UTC))

    assert store.record_telemetry(packet) is True

    total, records = store.query_records(LogFilter(), limit=50, offset=0)
    assert total == 1
    assert records[0]["event_type"] == EVENT_TELEMETRY
    assert records[0]["data_source"] == "simulation"
    assert records[0]["battery_voltage_v"] == pytest.approx(24.8)
    assert records[0]["altitude_m"] == pytest.approx(124.6)


def test_duplicate_telemetry_packets_are_not_stored_twice(store, make_packet):
    packet = make_packet(datetime(2026, 10, 21, 12, 0, 0, tzinfo=UTC))

    assert store.record_telemetry(packet) is True
    assert store.record_telemetry(packet) is False

    total, _ = store.query_records(LogFilter(), limit=50, offset=0)
    assert total == 1


def test_fault_events_are_stored_separately_from_telemetry(store, make_packet):
    now = datetime(2026, 10, 21, 12, 0, 0, tzinfo=UTC)
    fault = FaultEvent(
        timestamp=now,
        severity=SEVERITY_WARNING,
        code="GNSS_DEGRADED",
        message="GNSS fix quality degraded.",
        sensor="gnss",
    )
    packet = make_packet(now, gnss=SensorStatus.DEGRADED, faults=[fault])

    store.record_telemetry(packet)
    store.record_fault(fault, "simulation", fault.sensor)

    total, records = store.query_records(LogFilter(), limit=50, offset=0)
    assert total == 2
    types = {record["event_type"] for record in records}
    assert types == {EVENT_TELEMETRY, EVENT_FAULT}

    _, faults = store.query_records(
        LogFilter(event_type=EVENT_FAULT), limit=50, offset=0
    )
    assert len(faults) == 1
    assert faults[0]["code"] == "GNSS_DEGRADED"
    assert faults[0]["sensor"] == "gnss"
    assert faults[0]["severity"] == SEVERITY_WARNING


def test_repeated_faults_are_deduplicated_inside_the_window(store, make_packet):
    fault = FaultEvent(
        timestamp=datetime.now(UTC),
        severity=SEVERITY_WARNING,
        code="BARO_DRIFT",
        message="Barometric altitude drifting.",
        sensor="barometer",
    )

    assert store.record_fault(fault, "simulation", "barometer") is True
    assert store.record_fault(fault, "simulation", "barometer") is False

    _, records = store.query_records(LogFilter(event_type=EVENT_FAULT), limit=50, offset=0)
    assert len(records) == 1


def test_connection_loss_events_are_recorded_once(store):
    assert (
        store.record_system_event(
            EVENT_CONNECTION_LOST,
            SEVERITY_WARNING,
            "Telemetry link lost.",
            "simulation",
            "link",
        )
        is True
    )
    assert (
        store.record_system_event(
            EVENT_CONNECTION_LOST,
            SEVERITY_WARNING,
            "Telemetry link lost.",
            "simulation",
            "link",
        )
        is False
    )

    _, records = store.query_records(LogFilter(event_type=EVENT_SYSTEM), limit=50, offset=0)
    assert len(records) == 1
    assert records[0]["code"] == EVENT_CONNECTION_LOST


def test_records_can_be_filtered_by_date_sensor_severity_and_event_type(store, make_packet):
    base = datetime(2026, 10, 21, 12, 0, 0, tzinfo=UTC)
    store.record_telemetry(make_packet(base, barometer=SensorStatus.DEGRADED))
    store.record_telemetry(make_packet(base + timedelta(minutes=90)))
    store.record_telemetry(make_packet(base + timedelta(days=1)))
    store.record_fault(
        FaultEvent(
            timestamp=base,
            severity=SEVERITY_ERROR,
            code="LINK_DOWN",
            message="Telemetry link down.",
            sensor="link",
        ),
        "simulation",
        "link",
    )

    _, by_sensor = store.query_records(LogFilter(sensor="barometer"), limit=50, offset=0)
    assert len(by_sensor) == 1
    assert by_sensor[0]["event_type"] == EVENT_TELEMETRY

    _, by_severity = store.query_records(LogFilter(severity=SEVERITY_ERROR), limit=50, offset=0)
    assert len(by_severity) == 1
    assert by_severity[0]["code"] == "LINK_DOWN"

    _, by_type = store.query_records(LogFilter(event_type=EVENT_FAULT), limit=50, offset=0)
    assert len(by_type) == 1

    _, by_date = store.query_records(
        LogFilter(start=base + timedelta(hours=1), end=base + timedelta(hours=2)),
        limit=50,
        offset=0,
    )
    assert len(by_date) == 1

    _, by_search = store.query_records(LogFilter(search="link down"), limit=50, offset=0)
    assert len(by_search) == 1


def test_history_returns_battery_voltage_and_altitude_series(store, make_packet):
    base = datetime(2026, 10, 21, 12, 0, 0, tzinfo=UTC)
    for index in range(5):
        store.record_telemetry(make_packet(base + timedelta(seconds=index)))

    points = store.query_history(LogFilter(), max_points=100)

    assert len(points) == 5
    assert points[0]["battery_voltage_v"] == pytest.approx(24.8)
    assert points[0]["altitude_m"] == pytest.approx(124.6)


def test_export_csv_writes_headers_and_rows(store, make_packet):
    base = datetime(2026, 10, 21, 12, 0, 0, tzinfo=UTC)
    store.record_telemetry(make_packet(base))
    store.record_fault(
        FaultEvent(
            timestamp=base,
            severity=SEVERITY_WARNING,
            code="GNSS_DEGRADED",
            message="GNSS fix quality degraded.",
            sensor="gnss",
        ),
        "simulation",
        "gnss",
    )

    payload = store.export_csv(LogFilter())
    rows = list(csv.reader(io.StringIO(payload)))

    assert rows[0] == list(CSV_COLUMNS)
    assert len(rows) == 3
    assert {row[2] for row in rows[1:]} == {EVENT_TELEMETRY, EVENT_FAULT}
    assert all(row[5] == "simulation" for row in rows[1:])


def test_export_csv_respects_the_active_filters(store, make_packet):
    base = datetime(2026, 10, 21, 12, 0, 0, tzinfo=UTC)
    store.record_telemetry(make_packet(base))
    store.record_telemetry(make_packet(base + timedelta(days=2)))

    payload = store.export_csv(LogFilter(event_type=EVENT_TELEMETRY))
    rows = list(csv.reader(io.StringIO(payload)))
    assert len(rows) == 3

    payload = store.export_csv(LogFilter(event_type=EVENT_FAULT))
    rows = list(csv.reader(io.StringIO(payload)))
    assert len(rows) == 1


def test_mission_events_join_log_view_with_combined_filters_and_pagination(store, make_packet, tmp_path):
    base = datetime.now(UTC) - timedelta(minutes=5)
    mission_store = MissionStore(tmp_path / "mission-events.db")
    mission = mission_store.list_missions()[0]
    mission_store.event(mission.id, "INFO", "MISSION_START", "Mission started", data_source="simulation")
    mission_store.event(mission.id, "INFO", "MISSION_PAUSE", "Mission paused", data_source="simulation")
    mission_store.event(mission.id, "INFO", "MISSION_RTH", "Mission return home", data_source="simulation")
    mission_store.event(mission.id, "INFO", "WAYPOINT_REACHED", "Reached WP 01", data_source="simulation")
    mission_store.event(mission.id, "WARNING", "MISSION_ABORT", "Mission aborted", data_source="hardware")
    store.record_telemetry(make_packet(base, data_source="simulation"))
    store.record_fault(
        FaultEvent(
            timestamp=base + timedelta(seconds=1),
            severity=SEVERITY_WARNING,
            code="GNSS_DEGRADED",
            message="GNSS fix degraded.",
            sensor="gnss",
        ),
        "simulation",
        "gnss",
    )

    filters = LogFilter(
        category="Mission",
        severity="INFO",
        data_source="simulation",
        search="mission",
    ).normalised()
    total, first_page = store.query_records(filters, limit=1, offset=0, mission_db_path=mission_store.path)
    _, second_page = store.query_records(filters, limit=1, offset=1, mission_db_path=mission_store.path)
    assert total == 3
    assert len(first_page) == 1
    assert len(second_page) == 1
    assert first_page[0]["event_type"] == "MISSION"
    assert first_page[0]["category"] == "Mission"
    assert first_page[0]["code"] != second_page[0]["code"]

    _, waypoint = store.query_records(
        LogFilter(category="Waypoint", search="WP 01"),
        limit=10,
        offset=0,
        mission_db_path=mission_store.path,
    )
    assert len(waypoint) == 1
    assert waypoint[0]["code"] == "WAYPOINT_REACHED"

    payload = store.export_csv(
        LogFilter(category="Mission", data_source="hardware"),
        mission_db_path=mission_store.path,
    )
    rows = list(csv.DictReader(io.StringIO(payload)))
    assert len(rows) == 1
    assert rows[0]["code"] == "MISSION_ABORT"
    assert rows[0]["category"] == "Mission"

    _, ordered = store.query_records(LogFilter(category="Mission"), limit=10, offset=0, mission_db_path=mission_store.path)
    assert [row["timestamp"] for row in ordered] == sorted([row["timestamp"] for row in ordered], reverse=True)


def test_database_errors_are_handled_gracefully(tmp_path, make_packet):
    # Pointing the store at a directory makes every SQLite call fail.
    broken_store = LogStore(tmp_path)

    assert broken_store.record_telemetry(make_packet()) is False
    assert broken_store.query_records(LogFilter(), limit=10, offset=0) == (0, [])
    assert broken_store.query_history(LogFilter()) == []
    assert broken_store.query_stats(LogFilter()) == {}
    assert broken_store.export_csv(LogFilter()).strip() == ",".join(CSV_COLUMNS)
    assert broken_store.last_error is not None
    assert broken_store.available is False
    broken_store.close()
