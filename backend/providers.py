"""Pluggable telemetry sources.

Hardware providers deliberately do not define an ARIES packet decoder. The
decoder must be supplied once the flight-controller and wireless-link
specifications are available.
"""

from __future__ import annotations

import asyncio
import logging
import os
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from time import monotonic

from .models import Telemetry
from .simulation import SimulationProvider

UTC = timezone.utc

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DiagnosticMessage:
    timestamp: datetime
    source: str
    direction: str
    payload_hex: str
    payload_text: str
    status: str


class TelemetryProvider(ABC):
    """Common lifecycle and health contract for telemetry sources."""

    name: str
    hardware_enabled: bool = False

    @abstractmethod
    async def start(self) -> None:
        """Start receiving packets."""

    @abstractmethod
    async def stop(self) -> None:
        """Stop receiving packets and release resources."""

    @abstractmethod
    def latest(self) -> Telemetry | None:
        """Return the most recent decoded telemetry packet."""

    @abstractmethod
    async def diagnostics(self) -> list[DiagnosticMessage]:
        """Return recent raw receive diagnostics."""

    @property
    @abstractmethod
    def connected(self) -> bool:
        """Whether the source is currently connected and receiving."""

    @property
    @abstractmethod
    def stale(self) -> bool:
        """Whether no valid packet arrived within the configured timeout."""


class SimulationTelemetryProvider(TelemetryProvider):
    name = "simulation"

    def __init__(self) -> None:
        self._provider = SimulationProvider()

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    def latest(self) -> Telemetry:
        return self._provider.latest()

    async def diagnostics(self) -> list[DiagnosticMessage]:
        packet = self.latest()
        return [
            DiagnosticMessage(
                timestamp=packet.timestamp,
                source=self.name,
                direction="rx",
                payload_hex="",
                payload_text=packet.model_dump_json(),
                status="decoded",
            )
        ]

    @property
    def connected(self) -> bool:
        return True

    @property
    def stale(self) -> bool:
        return False


TelemetryDecoder = Callable[[bytes], Telemetry | None]


class SerialProvider(TelemetryProvider):
    """Read raw bytes from a configured serial port.

    No packet framing or ARIES decoding is assumed. Pass a decoder supplied by
    the hardware integration once its protocol is documented.
    """

    name = "serial"
    hardware_enabled = True

    def __init__(
        self,
        port: str | None = None,
        baudrate: int | None = None,
        timeout_s: float | None = None,
        decoder: TelemetryDecoder | None = None,
        serial_factory: Callable[..., object] | None = None,
    ) -> None:
        self.port = port or os.getenv("VEGA_SERIAL_PORT", "")
        self.baudrate = baudrate or int(os.getenv("VEGA_SERIAL_BAUD", "115200"))
        self.protocol = os.getenv("VEGA_SERIAL_PROTOCOL", "raw")
        self.timeout_s = timeout_s or float(os.getenv("VEGA_PACKET_TIMEOUT_S", "3"))
        self._decoder = decoder
        self._serial_factory = serial_factory
        self._serial: object | None = None
        self._task: asyncio.Task[None] | None = None
        self._latest: Telemetry | None = None
        self._last_packet_at: float | None = None
        self._connected = False
        self._diagnostics: list[DiagnosticMessage] = []
        self._stop = asyncio.Event()

    async def start(self) -> None:
        if os.getenv("VEGA_SERIAL_ENABLED", "false").lower() != "true":
            raise RuntimeError("Serial provider is disabled; set VEGA_SERIAL_ENABLED=true explicitly.")
        if not self.port:
            raise RuntimeError("VEGA_SERIAL_PORT is required for the serial provider.")
        if self._task is not None:
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._read_loop())

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            await self._task
        self._task = None
        self._close_serial()

    def latest(self) -> Telemetry | None:
        return self._latest

    async def diagnostics(self) -> list[DiagnosticMessage]:
        return list(self._diagnostics[-100:])

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def stale(self) -> bool:
        return self._last_packet_at is None or monotonic() - self._last_packet_at > self.timeout_s

    async def _read_loop(self) -> None:
        while not self._stop.is_set():
            try:
                if self._serial is None:
                    self._serial = self._open_serial()
                    self._connected = True
                raw = await asyncio.to_thread(self._serial.readline)  # type: ignore[union-attr]
                if not raw:
                    self._connected = not self.stale
                    continue
                self._last_packet_at = monotonic()
                self._connected = True
                self._record(raw, f"received:{self.protocol}")
                if self._decoder is not None:
                    decoded = self._decoder(raw)
                    if decoded is not None:
                        self._latest = decoded
                        self._record(raw, "decoded")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._connected = False
                self._record(str(exc).encode(), "error")
                self._close_serial()
                await asyncio.sleep(1)

    def _open_serial(self) -> object:
        if self._serial_factory is not None:
            return self._serial_factory(self.port, self.baudrate, self.timeout_s)
        try:
            import serial
        except ImportError as exc:
            raise RuntimeError("PySerial is required for the serial provider.") from exc
        return serial.Serial(self.port, self.baudrate, timeout=self.timeout_s)

    def _close_serial(self) -> None:
        if self._serial is not None:
            close = getattr(self._serial, "close", None)
            if close is not None:
                close()
        self._serial = None
        self._connected = False

    def _record(self, payload: bytes, status: str) -> None:
        self._diagnostics.append(
            DiagnosticMessage(
                timestamp=datetime.now(UTC),
                source=self.name,
                direction="rx",
                payload_hex=payload.hex(" "),
                payload_text=payload.decode("utf-8", errors="replace"),
                status=status,
            )
        )
        del self._diagnostics[:-100]


class MavlinkProvider(SerialProvider):
    """Optional MAVLink transport; disabled until a compatible source is confirmed."""

    name = "mavlink"

    async def start(self) -> None:
        if os.getenv("VEGA_MAVLINK_CONFIRMED", "false").lower() != "true":
            raise RuntimeError(
                "MAVLink provider is disabled until a compatible MAVLink source and dialect are confirmed."
            )
        try:
            import pymavlink  # noqa: F401
        except ImportError as exc:
            raise RuntimeError("Install the optional pymavlink package after MAVLink is confirmed.") from exc
        await super().start()


def provider_from_environment() -> TelemetryProvider:
    """Select a provider without ever enabling hardware implicitly."""
    kind = os.getenv("VEGA_TELEMETRY_PROVIDER", "simulation").lower()
    if kind == "simulation":
        return SimulationTelemetryProvider()
    if kind == "serial":
        return SerialProvider()
    if kind == "mavlink":
        return MavlinkProvider()
    raise ValueError(f"Unsupported VEGA_TELEMETRY_PROVIDER: {kind}")
