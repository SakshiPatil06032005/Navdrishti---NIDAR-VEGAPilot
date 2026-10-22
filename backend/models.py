"""Validated API models for simulated VEGA-Pilot telemetry."""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class DataSource(StrEnum):
    SIMULATION = "simulation"
    HARDWARE = "hardware"


class FlightMode(StrEnum):
    MISSION = "MISSION"
    LOITER = "LOITER"
    MANUAL = "MANUAL"


class SensorStatus(StrEnum):
    VALID = "VALID"
    DEGRADED = "DEGRADED"
    FAILED = "FAILED"
    NO_DATA = "NO DATA"


class MissionState(StrEnum):
    READY = "READY"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    ABORTED = "ABORTED"


class GnssPosition(BaseModel):
    latitude_deg: float = Field(ge=-90, le=90)
    longitude_deg: float = Field(ge=-180, le=180)
    altitude_m: float = Field(ge=-500, le=20_000)
    ground_speed_mps: float = Field(ge=0, le=200)
    heading_deg: float = Field(ge=0, lt=360)
    fix: str = Field(min_length=1, max_length=32)
    satellites: int = Field(ge=0, le=100)
    hdop: float = Field(gt=0, le=100)


class ImuAttitude(BaseModel):
    roll_deg: float = Field(ge=-180, le=180)
    pitch_deg: float = Field(ge=-90, le=90)
    yaw_deg: float = Field(ge=0, lt=360)
    roll_rate_dps: float = Field(ge=-2_000, le=2_000)
    pitch_rate_dps: float = Field(ge=-2_000, le=2_000)
    yaw_rate_dps: float = Field(ge=-2_000, le=2_000)


class BarometerData(BaseModel):
    pressure_hpa: float = Field(gt=100, lt=1_200)
    relative_altitude_m: float = Field(ge=-500, le=20_000)
    vertical_speed_mps: float = Field(ge=-200, le=200)


class BatteryData(BaseModel):
    voltage_v: float = Field(gt=0, le=100)
    current_a: float = Field(ge=-500, le=500)
    remaining_percent: float = Field(ge=0, le=100)


class SensorHealth(BaseModel):
    imu: SensorStatus
    gnss: SensorStatus
    barometer: SensorStatus
    battery: SensorStatus


class TelemetryLinkStatus(BaseModel):
    connected: bool
    signal_strength_percent: float = Field(ge=0, le=100)
    latency_ms: float = Field(ge=0, le=10_000)


class MissionStatus(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    state: MissionState
    current_waypoint: str = Field(min_length=1, max_length=32)
    completed_waypoints: int = Field(ge=0)
    total_waypoints: int = Field(ge=1)


class FaultEvent(BaseModel):
    timestamp: datetime
    severity: str = Field(min_length=1, max_length=16)
    code: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=240)
    sensor: str | None = Field(default=None, max_length=32)


class Telemetry(BaseModel):
    timestamp: datetime
    data_source: DataSource
    flight_mode: FlightMode
    gnss_position: GnssPosition
    imu_attitude: ImuAttitude
    barometer: BarometerData
    battery: BatteryData
    sensor_health: SensorHealth
    telemetry_link: TelemetryLinkStatus
    mission_status: MissionStatus
    fault_events: list[FaultEvent] = Field(default_factory=list, max_length=100)


class MissionWaypoint(BaseModel):
    id: str
    label: str
    altitude_m: float = Field(ge=0, le=20_000)
    status: str


class MissionResponse(BaseModel):
    name: str
    state: MissionState
    waypoints: list[MissionWaypoint]
    completion_percent: float = Field(ge=0, le=100)


class LogEntry(BaseModel):
    timestamp: datetime
    level: str
    message: str


class LogRecordModel(BaseModel):
    """A single stored telemetry, fault or system record."""

    uid: str
    timestamp: datetime
    recorded_at: datetime
    event_type: str
    severity: str
    data_source: str
    sensor: str | None = None
    code: str | None = None
    message: str
    flight_mode: str | None = None
    battery_voltage_v: float | None = None
    altitude_m: float | None = None
    relative_altitude_m: float | None = None
    link_connected: bool | None = None
    link_signal_percent: float | None = None


class LogRecordsResponse(BaseModel):
    total: int
    limit: int
    offset: int
    records: list[LogRecordModel]
    database_error: str | None = None


class LogHistoryPoint(BaseModel):
    timestamp: datetime
    battery_voltage_v: float
    altitude_m: float
    relative_altitude_m: float


class LogHistoryResponse(BaseModel):
    points: list[LogHistoryPoint]
    database_error: str | None = None


class LogStatsResponse(BaseModel):
    total: int = 0
    telemetry: int = 0
    faults: int = 0
    system: int = 0
    warnings: int = 0
    errors: int = 0
    connection_losses: int = 0
    database_error: str | None = None
