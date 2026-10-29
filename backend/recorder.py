"""Records telemetry packets, fault events and link transitions.

The recorder is the single writer into the SQLite log store. It keeps the
fault stream and the system event stream separate from the raw telemetry
stream, and it derives telemetry connection-loss events from the link status
carried by every packet.
"""

from __future__ import annotations

import logging

from .database import (
    EVENT_CLIENT_CONNECTED,
    EVENT_CLIENT_DISCONNECTED,
    EVENT_CONNECTION_LOST,
    EVENT_CONNECTION_RESTORED,
    SENSOR_LINK,
    SEVERITY_INFO,
    SEVERITY_WARNING,
    LogStore,
)
from .models import NotificationPolicy, Telemetry
from .notifications import NotificationManager

logger = logging.getLogger(__name__)


class TelemetryRecorder:
    """Stores telemetry packets and derives fault and link system events."""

    def __init__(self, store: LogStore, notifications: NotificationManager | None = None) -> None:
        self._store = store
        self._notifications = notifications
        self._policy = NotificationPolicy()
        self._link_connected: bool | None = None

    @property
    def store(self) -> LogStore:
        return self._store

    def set_notification_policy(self, policy: NotificationPolicy) -> None:
        self._policy = policy

    def record(self, packet: Telemetry) -> list:
        """Persist a telemetry packet together with its faults and link state."""
        created: list = []
        self._store.record_telemetry(packet)
        if self._notifications:
            created.extend(self._notifications.from_telemetry(packet, self._policy))
        for fault in packet.fault_events:
            self._store.record_fault(fault, packet.data_source.value, fault.sensor)
        link_alert = self._track_link(packet)
        if link_alert is not None:
            created.append(link_alert)
        return created

    def _track_link(self, packet: Telemetry):
        """Record connection loss and recovery when the link state changes."""
        connected = packet.telemetry_link.connected
        source = packet.data_source.value

        if self._link_connected is None:
            self._link_connected = connected
            if not connected:
                self._store.record_system_event(
                    EVENT_CONNECTION_LOST,
                    SEVERITY_WARNING,
                    "Telemetry link reported as disconnected when recording started.",
                    source,
                    SENSOR_LINK,
                )
            return self._notifications.on_link_change(source=packet.data_source, connected=False) if self._notifications else None

        if connected == self._link_connected:
            return None

        self._link_connected = connected
        if connected:
            self._store.record_system_event(
                EVENT_CONNECTION_RESTORED,
                SEVERITY_INFO,
                "Telemetry link re-established; packets resumed.",
                source,
                SENSOR_LINK,
            )
            return self._notifications.on_link_change(source=packet.data_source, connected=True) if self._notifications else None
        else:
            self._store.record_system_event(
                EVENT_CONNECTION_LOST,
                SEVERITY_WARNING,
                "Telemetry link lost; no packets received from the autopilot.",
                source,
                SENSOR_LINK,
            )
            return self._notifications.on_link_change(source=packet.data_source, connected=False) if self._notifications else None

    def record_client_connected(self, source: str) -> None:
        self._store.record_system_event(
            EVENT_CLIENT_CONNECTED,
            SEVERITY_INFO,
            "Ground control client connected to the telemetry stream.",
            source,
            SENSOR_LINK,
        )

    def record_client_disconnected(self, source: str) -> None:
        self._store.record_system_event(
            EVENT_CLIENT_DISCONNECTED,
            SEVERITY_WARNING,
            "Ground control client disconnected from the telemetry stream.",
            source,
            SENSOR_LINK,
        )
