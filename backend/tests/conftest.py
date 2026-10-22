"""Shared fixtures for the VEGA-Pilot backend tests."""

from datetime import UTC, datetime

import pytest

from backend.models import (
    BarometerData,
    BatteryData,
    DataSource,
    FlightMode,
    GnssPosition,
    ImuAttitude,
    MissionState,
    MissionStatus,
    SensorHealth,
    SensorStatus,
    Telemetry,
    TelemetryLinkStatus,
)


@pytest.fixture
def make_packet():
    """Return a factory that builds a valid telemetry packet."""

    def _make(
        timestamp: datetime | None = None,
        *,
        connected: bool = True,
        imu: SensorStatus = SensorStatus.VALID,
        gnss: SensorStatus = SensorStatus.VALID,
        barometer: SensorStatus = SensorStatus.VALID,
        battery: SensorStatus = SensorStatus.VALID,
        faults: list | None = None,
        data_source: DataSource = DataSource.SIMULATION,
    ) -> Telemetry:
        moment = timestamp or datetime.now(UTC)
        return Telemetry(
            timestamp=moment,
            data_source=data_source,
            flight_mode=FlightMode.MISSION,
            gnss_position=GnssPosition(
                latitude_deg=18.52390,
                longitude_deg=73.86410,
                altitude_m=124.6,
                ground_speed_mps=12.8,
                heading_deg=84.2,
                fix="RTK FIX",
                satellites=14,
                hdop=0.7,
            ),
            imu_attitude=ImuAttitude(
                roll_deg=1.8,
                pitch_deg=-0.6,
                yaw_deg=84.2,
                roll_rate_dps=0.02,
                pitch_rate_dps=0.01,
                yaw_rate_dps=0.08,
            ),
            barometer=BarometerData(
                pressure_hpa=998.4,
                relative_altitude_m=124.6,
                vertical_speed_mps=0.2,
            ),
            battery=BatteryData(voltage_v=24.8, current_a=8.4, remaining_percent=78.0),
            sensor_health=SensorHealth(
                imu=imu,
                gnss=gnss,
                barometer=barometer,
                battery=battery,
            ),
            telemetry_link=TelemetryLinkStatus(
                connected=connected,
                signal_strength_percent=96.0 if connected else 0.0,
                latency_ms=42.0 if connected else 0.0,
            ),
            mission_status=MissionStatus(
                name="Survey perimeter Alpha",
                state=MissionState.ACTIVE,
                current_waypoint="WP 04",
                completed_waypoints=3,
                total_waypoints=5,
            ),
            fault_events=faults or [],
        )

    return _make
