"""Backend-owned failsafe inspection without automatic flight actions."""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel, Field

from .models import SensorStatus, Telemetry


class FailsafePolicy(BaseModel):
    enabled: bool = True
    low_battery_percent: float = Field(default=20, ge=0, le=100)
    telemetry_timeout_s: float = Field(default=3, gt=0, le=300)
    require_gnss_fix: bool = True
    require_sensor_health: bool = True
    action: str = Field(default="INSPECT_ONLY", pattern="^INSPECT_ONLY$")
    validation_status: str = "UNVALIDATED"


class FailsafeCheck(BaseModel):
    name: str
    status: str
    message: str
    timestamp: datetime


class FailsafeStatus(BaseModel):
    policy: FailsafePolicy
    preflight_ready: bool
    checks: list[FailsafeCheck]
    evaluated_at: datetime
    automatic_action_taken: bool = False


def evaluate_failsafe(
    telemetry: Telemetry | None,
    policy: FailsafePolicy,
    *,
    stale: bool,
    mission_state: str,
) -> FailsafeStatus:
    now = datetime.now(UTC)
    checks: list[FailsafeCheck] = []

    def add(name: str, status: str, message: str) -> None:
        checks.append(FailsafeCheck(name=name, status=status, message=message, timestamp=now))

    if telemetry is None:
        add("preflight_sensor_readiness", "UNAVAILABLE", "No validated telemetry packet is available.")
        add("telemetry_timeout", "TRIGGERED", "Telemetry timeout; no automatic flight action was taken.")
    else:
        sensor_statuses = (
            telemetry.sensor_health.imu,
            telemetry.sensor_health.gnss,
            telemetry.sensor_health.barometer,
            telemetry.sensor_health.battery,
        )
        sensors_ready = all(status is SensorStatus.VALID for status in sensor_statuses)
        add(
            "preflight_sensor_readiness",
            "OK" if sensors_ready else "NOT_READY",
            "All required sensors report VALID." if sensors_ready else "One or more required sensors are not VALID.",
        )
        add(
            "low_battery",
            "TRIGGERED" if telemetry.battery.remaining_percent <= policy.low_battery_percent else "OK",
            f"Battery {telemetry.battery.remaining_percent:.1f}% "
            f"(threshold {policy.low_battery_percent:.1f}%).",
        )
        add(
            "gnss_loss",
            "TRIGGERED" if policy.require_gnss_fix and telemetry.sensor_health.gnss is not SensorStatus.VALID else "OK",
            "GNSS fix is unavailable or degraded." if policy.require_gnss_fix and telemetry.sensor_health.gnss is not SensorStatus.VALID else "GNSS health is valid.",
        )
        add(
            "telemetry_timeout",
            "TRIGGERED" if stale else "OK",
            "Telemetry is stale; no automatic flight action was taken." if stale else "Telemetry is fresh.",
        )
        add("state_estimation", "INSPECTION_REQUIRED", "State-estimation validity is not supplied by the current telemetry schema.")

    add(
        "mission_abort",
        "ACTIVE" if mission_state == "ABORTED" else "OK",
        "Mission is aborted; onboard failsafe handling remains authoritative." if mission_state == "ABORTED" else "Mission has not been aborted.",
    )
    failures = {"TRIGGERED", "NOT_READY", "UNAVAILABLE", "INSPECTION_REQUIRED"}
    ready = policy.enabled and all(check.status not in failures for check in checks)
    return FailsafeStatus(policy=policy, preflight_ready=ready, checks=checks, evaluated_at=now)
