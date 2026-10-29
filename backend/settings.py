"""Persisted, backend-owned dashboard and telemetry settings."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .models import NotificationPolicy

class DashboardPreferences(BaseModel):
    refresh_rate_hz: float = Field(default=2.0, ge=0.5, le=10)
    measurement_units: str = Field(default="metric", pattern="^(metric|imperial)$")
    theme: str = Field(default="dark", pattern="^(dark|light|system)$")
    alerts_enabled: bool = True
    sound_enabled: bool = False


class SerialSettings(BaseModel):
    port: str = ""
    baud_rate: int = Field(default=115200, ge=1_200, le=4_000_000)


class SystemInformation(BaseModel):
    controller_model: str | None = None
    firmware_version: str | None = None
    telemetry_schema_version: str = "1.0"
    device_id: str | None = None


class SafetyInformation(BaseModel):
    geofence: dict[str, Any] | None = None
    mission_limits: dict[str, Any] | None = None
    failsafe_policy: dict[str, Any] | None = None
    validation_status: str = "UNCONFIGURED"


class SettingsState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str = Field(default="simulation", pattern="^(simulation|hardware)$")
    serial: SerialSettings = SerialSettings()
    dashboard: DashboardPreferences = DashboardPreferences()
    system: SystemInformation = SystemInformation()
    safety: SafetyInformation = SafetyInformation()
    notifications: NotificationPolicy = NotificationPolicy()


class SettingsStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialise()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialise(self) -> None:
        with self._connect() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
            )

    def load(self) -> SettingsState:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT value FROM app_settings WHERE key = 'settings'"
            ).fetchone()
        if row is None:
            return SettingsState()
        try:
            return SettingsState.model_validate(json.loads(row["value"]))
        except (ValueError, TypeError):
            return SettingsState()

    def save(self, settings: SettingsState) -> SettingsState:
        payload = json.dumps(settings.model_dump(mode="json"), sort_keys=True)
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO app_settings(key, value) VALUES('settings', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (payload,),
            )
        return settings
