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
from .models import Telemetry

logger = logging.getLogger(__name__)


class TelemetryRecorder:
    """Stores telemetry packets and derives fault and link system events."""

    def __init__(self, store: LogStore) -> None:
        self._store = store
        self._link_connected: bool | None = None

    @property
    def store(self) -> LogStore:
        return self._store

    def record(self, packet: Telemetry) -> None:
        """Persist a telemetry packet together with its faults and link state."""
        self._store.record_telemetry(packet)
        for fault in packet.fault_events:
            self._store.record_fault(fault, packet.data_source.value, fault.sensor)
        self._track_link(packet)

    def _track_link(self, packet: Telemetry) -> None:
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
            return

        if connected == self._link_connected:
            return

        self._link_connected = connected
        if connected:
            self._store.record_system_event(
                EVENT_CONNECTION_RESTORED,
                SEVERITY_INFO,
                "Telemetry link re-established; packets resumed.",
                source,
                SENSOR_LINK,
            )
        else:
            self._store.record_system_event(
                EVENT_CONNECTION_LOST,
                SEVERITY_WARNING,
                "Telemetry link lost; no packets received from the autopilot.",
                source,
                SENSOR_LINK,
            )

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
