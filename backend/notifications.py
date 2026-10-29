"""Notification generation and persistence for telemetry, faults and missions."""

from __future__ import annotations

from datetime import UTC, datetime
from time import monotonic

from .database import LogStore
from .models import (
    DataSource,
    MissionState,
    NotificationPolicy,
    NotificationRecord,
    NotificationSeverity,
    SensorStatus,
    Telemetry,
)


class NotificationManager:
    def __init__(self, store: LogStore) -> None:
        self._store = store
        self._last_emitted_at: dict[str, float] = {}
        self._active_faults: set[str] = set()
        self._stale_active: set[str] = set()
        self._failsafe_active: set[str] = set()

    def _cooled(self, event_key: str, cooldown_s: int) -> bool:
        now = monotonic()
        last = self._last_emitted_at.get(event_key)
        if last is not None and now - last < cooldown_s:
            return False
        self._last_emitted_at[event_key] = now
        return True

    def emit(
        self,
        *,
        event_id: str,
        alert_type: str,
        severity: NotificationSeverity,
        title: str,
        message: str,
        voice_message: str,
        source: DataSource,
        mission_id: str | None = None,
        timestamp: datetime | None = None,
    ) -> NotificationRecord | None:
        return self._store.create_notification(
            event_id=event_id,
            alert_type=alert_type,
            severity=severity,
            title=title,
            message=message,
            voice_message=voice_message,
            source=source,
            mission_id=mission_id,
            timestamp=timestamp,
        )

    def from_telemetry(self, packet: Telemetry, policy: NotificationPolicy) -> list[NotificationRecord]:
        created: list[NotificationRecord] = []
        source = packet.data_source
        now = packet.timestamp
        source_key = source.value

        battery = packet.battery.remaining_percent
        critical_key = f"{source_key}:battery:critical"
        warning_key = f"{source_key}:battery:warning"
        if battery <= policy.low_battery_critical_percent:
            if self._cooled(critical_key, policy.alert_cooldown_s):
                created_alert = self.emit(
                    event_id=f"{source_key}:battery:critical:{int(now.timestamp())}",
                    alert_type="LOW_BATTERY_CRITICAL",
                    severity=NotificationSeverity.CRITICAL,
                    title="Critical battery condition",
                    message=f"Battery level is {battery:.1f}%.",
                    voice_message="Critical alert. Drone battery level is critical.",
                    source=source,
                    timestamp=now,
                )
                if created_alert:
                    created.append(created_alert)
        elif battery <= policy.low_battery_warning_percent and self._cooled(warning_key, policy.alert_cooldown_s):
            created_alert = self.emit(
                event_id=f"{source_key}:battery:warning:{int(now.timestamp())}",
                alert_type="LOW_BATTERY_WARNING",
                severity=NotificationSeverity.WARNING,
                title="Low battery warning",
                message=f"Battery level is {battery:.1f}%.",
                voice_message="Warning. Drone battery level is low.",
                source=source,
                timestamp=now,
            )
            if created_alert:
                created.append(created_alert)
        elif policy.announce_recovery and battery >= policy.low_battery_warning_percent + policy.low_battery_hysteresis_percent:
            if critical_key in self._last_emitted_at or warning_key in self._last_emitted_at:
                self._last_emitted_at.pop(critical_key, None)
                self._last_emitted_at.pop(warning_key, None)
                recovered = self.emit(
                    event_id=f"{source_key}:battery:recovery:{int(now.timestamp())}",
                    alert_type="LOW_BATTERY_RECOVERY",
                    severity=NotificationSeverity.SUCCESS,
                    title="Battery recovered",
                    message=f"Battery recovered to {battery:.1f}%.",
                    voice_message="Information. Battery level recovered.",
                    source=source,
                    timestamp=now,
                )
                if recovered:
                    created.append(recovered)

        for sensor_name, status, fault_title, voice in (
            ("gnss", packet.sensor_health.gnss, "GNSS signal lost", "Warning. GNSS signal lost."),
            ("imu", packet.sensor_health.imu, "IMU sensor failure", "Critical alert. IMU sensor failure detected."),
            ("barometer", packet.sensor_health.barometer, "Barometer sensor failure", "Warning. Barometer sensor failure detected."),
        ):
            fault_key = f"{source_key}:sensor:{sensor_name}"
            failed = status in {SensorStatus.FAILED, SensorStatus.NO_DATA} or (
                sensor_name == "gnss" and status is not SensorStatus.VALID
            )
            if failed and fault_key not in self._active_faults:
                self._active_faults.add(fault_key)
                alert = self.emit(
                    event_id=f"{fault_key}:active:{int(now.timestamp())}",
                    alert_type=f"{sensor_name.upper()}_FAULT",
                    severity=NotificationSeverity.CRITICAL if sensor_name == "imu" else NotificationSeverity.WARNING,
                    title=fault_title,
                    message=f"{sensor_name.upper()} health is {status.value}.",
                    voice_message=voice,
                    source=source,
                    timestamp=now,
                )
                if alert:
                    created.append(alert)
            elif not failed and fault_key in self._active_faults:
                self._active_faults.discard(fault_key)
                if policy.announce_recovery:
                    recovered = self.emit(
                        event_id=f"{fault_key}:recovery:{int(now.timestamp())}",
                        alert_type=f"{sensor_name.upper()}_RECOVERY",
                        severity=NotificationSeverity.SUCCESS,
                        title=f"{sensor_name.upper()} recovered",
                        message=f"{sensor_name.upper()} health returned to VALID.",
                        voice_message=f"Information. {sensor_name.upper()} sensor recovered.",
                        source=source,
                        timestamp=now,
                    )
                    if recovered:
                        created.append(recovered)
        return created

    def on_link_change(self, *, source: DataSource, connected: bool) -> NotificationRecord | None:
        now = datetime.now(UTC)
        if connected:
            return self.emit(
                event_id=f"{source.value}:telemetry:restored:{int(now.timestamp())}",
                alert_type="TELEMETRY_RESTORED",
                severity=NotificationSeverity.SUCCESS,
                title="Telemetry restored",
                message="Telemetry link is restored.",
                voice_message="Information. Telemetry link restored.",
                source=source,
                timestamp=now,
            )
        return self.emit(
            event_id=f"{source.value}:telemetry:lost:{int(now.timestamp())}",
            alert_type="TELEMETRY_LOST",
            severity=NotificationSeverity.WARNING,
            title="Telemetry connection lost",
            message="Telemetry link was lost.",
            voice_message="Warning. Telemetry connection lost.",
            source=source,
            timestamp=now,
        )

    def on_stale(self, *, source: DataSource, stale: bool) -> NotificationRecord | None:
        now = datetime.now(UTC)
        source_key = source.value
        if stale and source_key not in self._stale_active:
            self._stale_active.add(source_key)
            return self.emit(
                event_id=f"{source.value}:telemetry:stale",
                alert_type="STALE_TELEMETRY",
                severity=NotificationSeverity.WARNING,
                title="Telemetry is stale",
                message="No recent validated telemetry packet is available.",
                voice_message="Warning. Telemetry is stale.",
                source=source,
                timestamp=now,
            )
        if not stale and source_key in self._stale_active:
            self._stale_active.discard(source_key)
            return self.emit(
                event_id=f"{source.value}:telemetry:stale-recovered",
                alert_type="STALE_TELEMETRY_RECOVERY",
                severity=NotificationSeverity.SUCCESS,
                title="Telemetry recovered",
                message="Validated telemetry packet flow resumed.",
                voice_message="Information. Telemetry recovered.",
                source=source,
                timestamp=now,
            )
        return None

    def on_failsafe_state(
        self,
        *,
        source: DataSource,
        active: bool,
        mission_id: str | None,
    ) -> NotificationRecord | None:
        source_key = source.value
        if active and source_key not in self._failsafe_active:
            self._failsafe_active.add(source_key)
            return self.from_mission_event(
                code="FAILSAFE_ACTIVATED",
                message="Failsafe monitoring requires inspection.",
                source=source,
                mission_id=mission_id,
            )
        if not active:
            self._failsafe_active.discard(source_key)
        return None

    def from_mission_event(
        self,
        *,
        code: str,
        message: str,
        source: DataSource,
        mission_id: str | None,
        state: MissionState | None = None,
        event_id: str | None = None,
    ) -> NotificationRecord | None:
        mapping: dict[str, tuple[str, NotificationSeverity, str]] = {
            "MISSION_START": ("Mission started", NotificationSeverity.INFORMATION, "Information. Mission started."),
            "WAYPOINT_REACHED": ("Waypoint reached", NotificationSeverity.INFORMATION, "Information. Waypoint reached."),
            "MISSION_ABORT": ("Mission aborted", NotificationSeverity.WARNING, "Mission aborted by operator."),
            "MISSION_ABORT_CONFIRMED": ("Mission aborted", NotificationSeverity.WARNING, "Mission aborted by operator."),
            "MISSION_COMPLETED": ("Mission completed", NotificationSeverity.SUCCESS, "Mission completed."),
            "FAILSAFE_ACTIVATED": ("Failsafe activated", NotificationSeverity.CRITICAL, "Critical alert. Failsafe activated."),
        }
        if code not in mapping:
            if state == MissionState.COMPLETED:
                code = "MISSION_COMPLETED"
            else:
                return None
        title, severity, voice = mapping[code]
        now = datetime.now(UTC)
        return self.emit(
            event_id=event_id or f"{source.value}:mission:{code}:{mission_id or 'none'}",
            alert_type=code,
            severity=severity,
            title=title,
            message=message,
            voice_message=voice,
            source=source,
            mission_id=mission_id,
            timestamp=now,
        )
