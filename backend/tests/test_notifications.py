"""Notification generation, persistence and source-separation tests."""

from datetime import UTC, datetime

from backend.database import LogStore
from backend.models import DataSource, NotificationPolicy, NotificationSeverity, SensorStatus
from backend.notifications import NotificationManager


def test_low_battery_alert_is_persisted_and_deduplicated(tmp_path, make_packet):
    store = LogStore(tmp_path / "notifications.db")
    manager = NotificationManager(store)
    packet = make_packet(datetime.now(UTC))
    packet = packet.model_copy(update={
        "battery": packet.battery.model_copy(update={"remaining_percent": 18}),
    })
    policy = NotificationPolicy(alert_cooldown_s=60)

    first = manager.from_telemetry(packet, policy)
    second = manager.from_telemetry(packet, policy)

    assert len(first) == 1
    assert first[0].severity is NotificationSeverity.CRITICAL
    assert second == []
    assert len(store.list_notifications()) == 1
    assert store.unread_notifications_count() == 1
    store.close()


def test_sensor_fault_recovery_emits_once_and_preserves_source(tmp_path, make_packet):
    store = LogStore(tmp_path / "notifications.db")
    manager = NotificationManager(store)
    policy = NotificationPolicy(alert_cooldown_s=60)
    degraded = make_packet(imu=SensorStatus.FAILED, data_source=DataSource.HARDWARE)
    recovered = make_packet(imu=SensorStatus.VALID, data_source=DataSource.HARDWARE)

    fault = manager.from_telemetry(degraded, policy)
    repeated = manager.from_telemetry(degraded, policy)
    recovery = manager.from_telemetry(recovered, policy)

    assert [item.alert_type for item in fault] == ["IMU_FAULT"]
    assert repeated == []
    assert [item.alert_type for item in recovery] == ["IMU_RECOVERY"]
    assert all(item.source is DataSource.HARDWARE for item in store.list_notifications())
    store.close()


def test_notification_read_dismiss_and_history_survive_reload(tmp_path, make_packet):
    path = tmp_path / "notifications.db"
    store = LogStore(path)
    manager = NotificationManager(store)
    packet = make_packet()
    packet = packet.model_copy(update={
        "battery": packet.battery.model_copy(update={"remaining_percent": 10}),
    })
    created = manager.from_telemetry(packet, NotificationPolicy())[0]
    assert store.mark_notification_read(created.id) is True
    assert store.dismiss_notification(created.id) is True
    store.close()

    reopened = LogStore(path)
    assert reopened.list_notifications() == []
    assert reopened.list_notifications(include_dismissed=True)[0].read is True
    assert reopened.list_notifications(include_dismissed=True)[0].dismissed is True
    reopened.close()
