"""Deterministic simulated telemetry provider; no hardware access is performed.

The provider produces one stable packet per wall-clock second so that every
consumer of the stream sees the same timestamp. That keeps the persisted log
free of duplicates and lets the simulator raise realistic transient faults and
link dropouts that the fault and connection-loss logging can be exercised with.
"""

from datetime import UTC, datetime
from math import sin
from time import monotonic

from .models import (
    BarometerData,
    BatteryData,
    DataSource,
    FaultEvent,
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

#: Fault raised when a sensor stops reporting nominal status.
SENSOR_FAULTS: dict[str, tuple[str, str]] = {
    "imu": ("IMU_NOISE", "IMU noise above the nominal threshold."),
    "gnss": ("GNSS_DEGRADED", "GNSS fix quality degraded; horizontal accuracy below limit."),
    "barometer": ("BARO_DRIFT", "Barometric altitude drifting away from the GNSS reference."),
    "battery": ("BATTERY_DEGRADED", "Battery pack reporting degraded health."),
}


class SimulationProvider:
    """Produces a deterministic telemetry snapshot once per second."""

    #: The telemetry link drops out for ``OUTAGE_DURATION_S`` seconds every period.
    OUTAGE_PERIOD_S = 180
    OUTAGE_OFFSET_S = 90
    OUTAGE_DURATION_S = 6

    def __init__(self) -> None:
        self.started_at = monotonic()
        self._cached: Telemetry | None = None
        self._cached_second: int | None = None

    def latest(self) -> Telemetry:
        """Return the packet for the current second, building it once per second."""
        elapsed = monotonic() - self.started_at
        second = int(elapsed)
        if self._cached is not None and self._cached_second == second:
            return self._cached
        packet = self._build(elapsed, second)
        self._cached = packet
        self._cached_second = second
        return packet

    def _build(self, elapsed: float, second: int) -> Telemetry:
        altitude = 124.6 + sin(elapsed / 8) * 1.5
        voltage = 24.8 - min(elapsed / 3_600, 0.4)
        yaw = (84.2 + elapsed * 0.05) % 360
        now = datetime.now(UTC)

        health = self._health(second)
        link = self._link(second)

        return Telemetry(
            timestamp=now,
            packet_sequence=second + 1,
            data_source=DataSource.SIMULATION,
            flight_mode=FlightMode.MISSION,
            gnss_position=GnssPosition(
                latitude_deg=18.52390 + sin(elapsed / 30) * 0.00005,
                longitude_deg=73.86410 + sin(elapsed / 35) * 0.00005,
                altitude_m=altitude,
                ground_speed_mps=12.8 + sin(elapsed / 6) * 0.3,
                heading_deg=yaw,
                fix="RTK FIX" if health.gnss == SensorStatus.VALID else "FLOAT FIX",
                satellites=14 if health.gnss == SensorStatus.VALID else 7,
                hdop=0.7 if health.gnss == SensorStatus.VALID else 2.4,
            ),
            imu_attitude=ImuAttitude(
                roll_deg=1.8 + sin(elapsed / 4) * 0.2,
                pitch_deg=-0.6 + sin(elapsed / 5) * 0.15,
                yaw_deg=yaw,
                roll_rate_dps=0.02,
                pitch_rate_dps=0.01,
                yaw_rate_dps=0.08,
            ),
            barometer=BarometerData(
                pressure_hpa=998.4,
                relative_altitude_m=altitude,
                vertical_speed_mps=sin(elapsed / 8) * 0.2,
            ),
            battery=BatteryData(
                voltage_v=voltage,
                current_a=8.4,
                remaining_percent=max(0, 78 - elapsed / 180),
            ),
            sensor_health=health,
            telemetry_link=link,
            mission_status=MissionStatus(
                name="Survey perimeter Alpha",
                state=MissionState.ACTIVE,
                current_waypoint="WP 04",
                completed_waypoints=3,
                total_waypoints=5,
            ),
            fault_events=self._faults(now, health, link.connected),
        )

    def _health(self, second: int) -> SensorHealth:
        """Return the sensor health for the given second of the flight."""
        return SensorHealth(
            imu=SensorStatus.DEGRADED if 200 <= second % 400 < 215 else SensorStatus.VALID,
            gnss=SensorStatus.DEGRADED if 120 <= second % 300 < 150 else SensorStatus.VALID,
            barometer=SensorStatus.DEGRADED if 40 <= second % 240 < 70 else SensorStatus.VALID,
            battery=SensorStatus.VALID,
        )

    def _link(self, second: int) -> TelemetryLinkStatus:
        """Return the telemetry link status, including simulated outages."""
        if self._in_outage(second):
            return TelemetryLinkStatus(
                connected=False,
                signal_strength_percent=0.0,
                latency_ms=0.0,
            )
        signal = 96.0 - (second % 30) * 0.4
        return TelemetryLinkStatus(
            connected=True,
            signal_strength_percent=round(signal, 1),
            latency_ms=float(42 + (second % 11) * 2),
        )

    def _in_outage(self, second: int) -> bool:
        phase = second % self.OUTAGE_PERIOD_S
        return self.OUTAGE_OFFSET_S <= phase < self.OUTAGE_OFFSET_S + self.OUTAGE_DURATION_S

    def _faults(self, now: datetime, health: SensorHealth, link_connected: bool) -> list[FaultEvent]:
        """Build the active fault list for the current packet."""
        faults: list[FaultEvent] = []
        for sensor, status in (
            ("imu", health.imu),
            ("gnss", health.gnss),
            ("barometer", health.barometer),
            ("battery", health.battery),
        ):
            if status == SensorStatus.VALID:
                continue
            code, message = SENSOR_FAULTS[sensor]
            faults.append(
                FaultEvent(
                    timestamp=now,
                    severity="WARNING",
                    code=code,
                    message=message,
                    sensor=sensor,
                )
            )
        if not link_connected:
            faults.append(
                FaultEvent(
                    timestamp=now,
                    severity="ERROR",
                    code="LINK_DOWN",
                    message="Telemetry link down; autopilot packets stopped.",
                    sensor="link",
                )
            )
        return faults


def mission_snapshot() -> dict:
    return {
        "name": "Survey perimeter Alpha",
        "state": MissionState.ACTIVE,
        "waypoints": [
            {"id": "wp1", "label": "WP 01", "altitude_m": 100, "status": "completed"},
            {"id": "wp2", "label": "WP 02", "altitude_m": 112, "status": "completed"},
            {"id": "wp3", "label": "WP 03", "altitude_m": 118, "status": "completed"},
            {"id": "wp4", "label": "WP 04", "altitude_m": 125, "status": "current"},
            {"id": "wp5", "label": "WP 05", "altitude_m": 120, "status": "pending"},
        ],
        "completion_percent": 60,
    }
