"""Tests for the log API endpoints: retrieving, filtering, charting and exporting."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from backend.database import LogStore
from backend.recorder import TelemetryRecorder


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Run the API against an isolated temporary log store."""
    from backend import main

    test_store = LogStore(tmp_path / "api.db")
    monkeypatch.setattr(main, "store", test_store)
    monkeypatch.setattr(main, "recorder", TelemetryRecorder(test_store))
    with TestClient(main.app) as test_client:
        yield test_client
    test_store.close()


def _seed(store: LogStore, make_packet) -> None:
    base = datetime(2026, 10, 21, 12, 0, 0, tzinfo=UTC)
    store.record_telemetry(make_packet(base))
    store.record_telemetry(make_packet(base.replace(second=1)))
    store.record_system_event(
        "CONNECTION_LOST",
        "WARNING",
        "Telemetry link lost.",
        "simulation",
        "link",
    )


def test_health_reports_the_log_store_status(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["log_store"] == "ok"


def test_diagnostics_page_and_messages_endpoint_are_available(client):
    page = client.get("/diagnostics")
    messages = client.get("/api/diagnostics/messages")

    assert page.status_code == 200
    assert "Raw provider messages only" in page.text
    assert messages.status_code == 200
    assert isinstance(messages.json(), list)


def test_records_endpoint_returns_stored_records(client, make_packet):
    from backend import main

    _seed(main.store, make_packet)

    response = client.get("/api/logs/records")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 3
    assert {record["event_type"] for record in payload["records"]} <= {
        "TELEMETRY",
        "FAULT",
        "SYSTEM",
    }
    assert payload["database_error"] is None


def test_records_endpoint_filters_by_event_type_and_severity(client, make_packet):
    from backend import main

    _seed(main.store, make_packet)

    response = client.get("/api/logs/records", params={"event_type": "system"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["records"][0]["code"] == "CONNECTION_LOST"

    response = client.get("/api/logs/records", params={"severity": "WARNING"})
    assert response.json()["total"] == 1


def test_records_endpoint_rejects_an_invalid_date(client):
    response = client.get("/api/logs/records", params={"start": "not-a-date"})

    assert response.status_code == 400


def test_history_endpoint_returns_chart_points(client, make_packet):
    from backend import main

    _seed(main.store, make_packet)

    response = client.get("/api/logs/history")

    assert response.status_code == 200
    points = response.json()["points"]
    assert len(points) >= 2
    assert points[0]["battery_voltage_v"] == pytest.approx(24.8)
    assert points[0]["altitude_m"] == pytest.approx(124.6)


def test_stats_endpoint_counts_records_by_type(client, make_packet):
    from backend import main

    _seed(main.store, make_packet)

    response = client.get("/api/logs/stats")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 3
    assert payload["system"] == 1
    assert payload["connection_losses"] == 1


def test_export_endpoint_returns_a_csv_attachment(client, make_packet):
    from backend import main

    _seed(main.store, make_packet)

    response = client.get("/api/logs/export.csv")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    lines = response.text.strip().splitlines()
    assert lines[0].startswith("timestamp,recorded_at,event_type,severity,data_source")
    assert len(lines) >= 4
    assert all(",simulation," in line for line in lines[1:])


def test_export_endpoint_respects_filters(client, make_packet):
    from backend import main

    _seed(main.store, make_packet)

    response = client.get("/api/logs/export.csv", params={"event_type": "system"})

    assert response.status_code == 200
    lines = response.text.strip().splitlines()
    assert len(lines) == 2
