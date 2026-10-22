"""Tests for provider selection and serial ingestion without real hardware."""

import asyncio
import os
from datetime import UTC, datetime

import pytest

from backend.providers import SerialProvider, SimulationTelemetryProvider, provider_from_environment


class FakeSerial:
    def __init__(self, _port, _baudrate, _timeout):
        self.closed = False
        self.messages = [b"simulated-serial-packet\n", b""]

    def readline(self):
        if self.messages:
            return self.messages.pop(0)
        return b""

    def close(self):
        self.closed = True


def test_serial_provider_records_raw_simulated_message(monkeypatch, make_packet):
    monkeypatch.setenv("VEGA_SERIAL_ENABLED", "true")
    packet = make_packet(datetime.now(UTC))
    provider = SerialProvider(
        port="COM-SIMULATED",
        serial_factory=FakeSerial,
        decoder=lambda _raw: packet,
        timeout_s=0.2,
    )

    async def run():
        await provider.start()
        await asyncio.sleep(0.05)
        diagnostics = await provider.diagnostics()
        await provider.stop()
        return diagnostics

    diagnostics = asyncio.run(run())

    assert provider.latest() == packet
    assert any(message.status.startswith("received:") for message in diagnostics)
    assert diagnostics[0].payload_text == "simulated-serial-packet\n"


def test_simulation_is_the_default_provider(monkeypatch):
    monkeypatch.delenv("VEGA_TELEMETRY_PROVIDER", raising=False)
    assert isinstance(provider_from_environment(), SimulationTelemetryProvider)


def test_serial_requires_explicit_enable(monkeypatch):
    monkeypatch.setenv("VEGA_TELEMETRY_PROVIDER", "serial")
    monkeypatch.delenv("VEGA_SERIAL_ENABLED", raising=False)
    provider = provider_from_environment()
    with pytest.raises(RuntimeError, match="disabled"):
        asyncio.run(provider.start())
