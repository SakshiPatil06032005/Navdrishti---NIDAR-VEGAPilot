"""Tests for the log API endpoints: retrieving, filtering, charting and exporting."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from backend.database import LogStore
from backend.notifications import NotificationManager
from backend.recorder import TelemetryRecorder
from backend.settings import SettingsStore


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Run the API against an isolated temporary log store."""
    from backend import main

    test_store = LogStore(tmp_path / "api.db")
    monkeypatch.setattr(main, "store", test_store)
    monkeypatch.setattr(main, "notification_manager", NotificationManager(test_store))
    monkeypatch.setattr(main, "recorder", TelemetryRecorder(test_store, main.notification_manager))
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


def test_settings_are_persisted_and_do_not_invent_device_information(client, tmp_path, monkeypatch):
    from backend import main

    monkeypatch.setattr(main, "settings_store", SettingsStore(tmp_path / "settings.db"))
    response = client.get("/api/settings")

    assert response.status_code == 200
    assert response.json()["source"] == "simulation"
    assert response.json()["system"]["controller_model"] is None

    response = client.put(
        "/api/settings/dashboard",
        json={
            "refresh_rate_hz": 5,
            "measurement_units": "metric",
            "theme": "dark",
            "alerts_enabled": False,
            "sound_enabled": True,
        },
    )
    assert response.status_code == 200
    assert main.settings_store.load().dashboard.alerts_enabled is False


def test_hardware_source_requires_explicit_serial_connection(client, tmp_path, monkeypatch):
    from backend import main

    monkeypatch.setattr(main, "settings_store", SettingsStore(tmp_path / "settings.db"))
    response = client.put("/api/settings/source?source=hardware")

    assert response.status_code == 200
    assert response.json()["source"] == "hardware"

    response = client.post("/api/settings/serial/connect")
    assert response.status_code == 400
    assert "serial port is required" in response.json()["detail"]


def test_mission_api_rejects_invalid_coordinates_and_exposes_route_length(client):
    from backend import main

    mission = main.mission_manager.selected()
    response = client.get(f"/api/missions/{mission.id}/route-length")
    assert response.status_code == 200
    assert response.json()["distance_m"] > 0

    payload = mission.model_dump(mode="json")
    payload["waypoints"][0]["latitude_deg"] = 91
    response = client.put(f"/api/missions/{mission.id}", json=payload)
    assert response.status_code == 422


def test_failsafe_policy_and_status_are_inspection_only(client, tmp_path, monkeypatch):
    from backend import main

    monkeypatch.setattr(main, "settings_store", SettingsStore(tmp_path / "settings.db"))
    response = client.put("/api/failsafe/policy", json={
        "enabled": True,
        "low_battery_percent": 25,
        "telemetry_timeout_s": 4,
        "require_gnss_fix": True,
        "require_sensor_health": True,
        "action": "INSPECT_ONLY",
        "validation_status": "UNVALIDATED",
    })
    assert response.status_code == 200
    status = client.get("/api/failsafe/status")
    assert status.status_code == 200
    assert status.json()["automatic_action_taken"] is False
    assert status.json()["policy"]["action"] == "INSPECT_ONLY"


def test_notification_api_persists_unread_count_and_read_state(client):
    from backend import main
    from backend.providers import SimulationTelemetryProvider

    main.provider = SimulationTelemetryProvider()
    main.store.mark_all_notifications_read()
    response = client.post("/api/notifications/test?severity=WARNING")
    assert response.status_code == 200
    notification = response.json()
    assert notification["source"] == "simulation"
    assert client.get("/api/notifications/unread-count").json()["unread_count"] == 1

    assert client.post(f"/api/notifications/{notification['id']}/read").status_code == 200
    assert client.get("/api/notifications/unread-count").json()["unread_count"] == 0
    assert client.post(f"/api/notifications/{notification['id']}/dismiss").status_code == 200
    assert all(item["id"] != notification["id"] for item in client.get("/api/notifications").json())
    assert client.get("/api/notifications?include_dismissed=true").json()[0]["dismissed"] is True


def test_notification_policy_is_separate_from_failsafe_policy(client, tmp_path, monkeypatch):
    from backend import main

    monkeypatch.setattr(main, "settings_store", SettingsStore(tmp_path / "settings.db"))
    notification_policy = client.put("/api/notifications/policy", json={
        "low_battery_warning_percent": 35,
        "low_battery_critical_percent": 15,
        "low_battery_hysteresis_percent": 4,
        "alert_cooldown_s": 30,
        "announce_recovery": False,
    })
    assert notification_policy.status_code == 200
    failsafe_policy = client.get("/api/failsafe/policy")
    assert failsafe_policy.status_code == 200
    assert failsafe_policy.json()["action"] == "INSPECT_ONLY"


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
