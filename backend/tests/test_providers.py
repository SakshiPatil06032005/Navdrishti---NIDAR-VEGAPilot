"""Tests for provider selection and serial ingestion without real hardware."""

import asyncio
import os
from datetime import UTC, datetime

import pytest

from backend.models import DataSource, Telemetry
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
    packet = make_packet(datetime.now(UTC), data_source=DataSource.HARDWARE)
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
    assert provider.valid_packet_count == 1
    assert provider.invalid_packet_count == 0
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


def test_hardware_provider_does_not_invent_a_packet_when_input_is_empty(monkeypatch):
    monkeypatch.setenv("VEGA_SERIAL_ENABLED", "true")
    provider = SerialProvider(
        port="COM-SIMULATED",
        serial_factory=lambda *_args: FakeSerial(),
        timeout_s=0.01,
    )

    async def run():
        await provider.start()
        await asyncio.sleep(2)
        stale = provider.stale
        connected = provider.connected
        await provider.stop()
        return stale, connected

    stale, connected = asyncio.run(run())

    assert provider.latest() is None
    assert stale is True
    assert connected is False


def test_serial_decoder_preserves_hardware_data_source(monkeypatch, make_packet):
    monkeypatch.setenv("VEGA_SERIAL_ENABLED", "true")
    packet = make_packet(data_source=DataSource.HARDWARE)
    provider = SerialProvider(
        port="COM-SIMULATED",
        serial_factory=FakeSerial,
        decoder=lambda _raw: packet,
        timeout_s=0.2,
    )

    async def run():
        await provider.start()
        await asyncio.sleep(0.05)
        await provider.stop()

    asyncio.run(run())

    assert provider.latest() is not None
    assert provider.latest().data_source is DataSource.HARDWARE


def test_serial_provider_rejects_simulation_packet_in_hardware_mode(monkeypatch, make_packet):
    monkeypatch.setenv("VEGA_SERIAL_ENABLED", "true")
    packet = make_packet(data_source=DataSource.SIMULATION)
    provider = SerialProvider(
        port="COM-SIMULATED",
        serial_factory=FakeSerial,
        decoder=lambda _raw: packet,
        timeout_s=0.2,
    )

    async def run():
        await provider.start()
        await asyncio.sleep(0.05)
        await provider.stop()

    asyncio.run(run())

    assert provider.latest() is None
    assert provider.invalid_packet_count >= 1
    assert provider.packet_error_count >= 1


def test_telemetry_model_rejects_invalid_measurements(make_packet):
    packet = make_packet(datetime.now(UTC)).model_dump()
    packet["battery"]["voltage_v"] = -1
    with pytest.raises(ValueError):
        Telemetry.model_validate(packet)
