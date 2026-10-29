"""Persisted mission drafts and backend-owned mission command execution."""

from __future__ import annotations

import json
import os
import sqlite3
from math import asin, cos, radians, sin, sqrt
from time import monotonic
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from uuid import uuid4

from pydantic import BaseModel, Field

from .models import CommandLifecycle, MissionLimits, MissionState, MissionStatus, MissionWaypoint


class MissionDraft(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(min_length=1, max_length=120)
    revision: int = Field(ge=1)
    state: MissionState
    waypoints: list[MissionWaypoint] = Field(min_length=5, max_length=5)
    active_waypoint_index: int = Field(ge=0, le=4)
    home_latitude_deg: float | None = Field(default=None, ge=-90, le=90)
    home_longitude_deg: float | None = Field(default=None, ge=-180, le=180)
    onboard_state: str = "NOT_CONFIRMED"


class MissionEvent(BaseModel):
    id: str
    mission_id: str
    timestamp: datetime
    level: str
    code: str
    message: str
    command_id: str | None = None


class MissionCommandResult(BaseModel):
    command_id: str
    mission_id: str
    command: str
    status: CommandLifecycle
    state: MissionState
    message: str
    requested_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    status_history: list[CommandLifecycle] = Field(default_factory=list)


class MissionStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = RLock()
        self._initialise()
        self._ensure_default()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialise(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS mission_drafts (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL,
                    state TEXT NOT NULL, waypoints TEXT NOT NULL,
                    active_waypoint_index INTEGER NOT NULL,
                    home_latitude_deg REAL, home_longitude_deg REAL,
                    onboard_state TEXT NOT NULL DEFAULT 'NOT_CONFIRMED'
                );
                CREATE TABLE IF NOT EXISTS mission_events (
                    id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, timestamp TEXT NOT NULL,
                    level TEXT NOT NULL, code TEXT NOT NULL, message TEXT NOT NULL,
                    command_id TEXT
                );
                CREATE TABLE IF NOT EXISTS mission_commands (
                    command_id TEXT PRIMARY KEY, mission_id TEXT NOT NULL,
                    command TEXT NOT NULL, status TEXT NOT NULL, state TEXT NOT NULL,
                    message TEXT NOT NULL, requested_at TEXT, updated_at TEXT,
                    status_history TEXT NOT NULL DEFAULT '[]'
                );
                """
            )
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(mission_drafts)")}
            for name, definition in (
                ("home_latitude_deg", "REAL"),
                ("home_longitude_deg", "REAL"),
                ("onboard_state", "TEXT NOT NULL DEFAULT 'NOT_CONFIRMED'"),
            ):
                if name not in columns:
                    connection.execute(f"ALTER TABLE mission_drafts ADD COLUMN {name} {definition}")
            command_columns = {row["name"] for row in connection.execute("PRAGMA table_info(mission_commands)")}
            for name, definition in (
                ("requested_at", "TEXT"),
                ("updated_at", "TEXT"),
                ("status_history", "TEXT NOT NULL DEFAULT '[]'"),
            ):
                if name not in command_columns:
                    connection.execute(f"ALTER TABLE mission_commands ADD COLUMN {name} {definition}")

    def _ensure_default(self) -> None:
        if self.list_missions():
            return
        waypoints = [
            MissionWaypoint(id=f"wp{i}", label=f"WP 0{i}", latitude_deg=18.5204 + i * 0.001,
                            longitude_deg=73.8567 + i * 0.001, altitude_m=altitude, status="pending")
            for i, altitude in enumerate((100, 112, 118, 125, 120), 1)
        ]
        self.save(MissionDraft(
            id="mission-alpha", name="Survey perimeter Alpha", revision=1,
            state=MissionState.READY, waypoints=waypoints, active_waypoint_index=0,
        ))

    def list_missions(self) -> list[MissionDraft]:
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM mission_drafts ORDER BY name").fetchall()
        return [self._row(row) for row in rows]

    def get(self, mission_id: str) -> MissionDraft:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM mission_drafts WHERE id = ?", (mission_id,)).fetchone()
        if row is None:
            raise KeyError(mission_id)
        return self._row(row)

    def save(self, mission: MissionDraft) -> MissionDraft:
        self.validate(mission)
        with self.lock, self._connect() as connection:
            connection.execute(
                "INSERT INTO mission_drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET name=excluded.name, revision=excluded.revision, "
                "state=excluded.state, waypoints=excluded.waypoints, active_waypoint_index=excluded.active_waypoint_index",
                (mission.id, mission.name, mission.revision, mission.state.value,
                 json.dumps([waypoint.model_dump(mode="json") for waypoint in mission.waypoints]),
                 mission.active_waypoint_index, mission.home_latitude_deg,
                 mission.home_longitude_deg, mission.onboard_state),
            )
        return mission

    @staticmethod
    def validate(mission: MissionDraft) -> None:
        limit = float(os.getenv("VEGA_MAX_RELATIVE_ALTITUDE_M", "20000"))
        if any(waypoint.altitude_m > limit for waypoint in mission.waypoints):
            raise ValueError(f"Waypoint altitude exceeds configured limit of {limit:g} m.")
        if (mission.home_latitude_deg is None) != (mission.home_longitude_deg is None):
            raise ValueError("Home latitude and longitude must be supplied together.")

    @staticmethod
    def route_length_m(mission: MissionDraft) -> float:
        points = [(waypoint.latitude_deg, waypoint.longitude_deg) for waypoint in mission.waypoints]
        total = 0.0
        for first, second in zip(points, points[1:]):
            lat1, lon1 = map(radians, first)
            lat2, lon2 = map(radians, second)
            dlat, dlon = lat2 - lat1, lon2 - lon1
            arc = 2 * asin(sqrt(sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2))
            total += 6_371_000 * arc
        return total

    @staticmethod
    def limits() -> MissionLimits:
        return MissionLimits(max_relative_altitude_m=float(os.getenv("VEGA_MAX_RELATIVE_ALTITUDE_M", "20000")))

    def delete(self, mission_id: str) -> None:
        with self.lock, self._connect() as connection:
            connection.execute("DELETE FROM mission_drafts WHERE id = ?", (mission_id,))
            connection.execute("DELETE FROM mission_events WHERE mission_id = ?", (mission_id,))

    def event(self, mission_id: str, level: str, code: str, message: str, command_id: str | None = None) -> MissionEvent:
        result = MissionEvent(id=str(uuid4()), mission_id=mission_id, timestamp=datetime.now(UTC),
                              level=level, code=code, message=message, command_id=command_id)
        with self._connect() as connection:
            connection.execute("INSERT INTO mission_events VALUES (?, ?, ?, ?, ?, ?, ?)",
                               (result.id, result.mission_id, result.timestamp.isoformat(), result.level,
                                result.code, result.message, result.command_id))
        return result

    def events(self, mission_id: str) -> list[MissionEvent]:
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM mission_events WHERE mission_id = ? ORDER BY timestamp", (mission_id,)).fetchall()
        return [MissionEvent(id=row["id"], mission_id=row["mission_id"], timestamp=row["timestamp"],
                             level=row["level"], code=row["code"], message=row["message"], command_id=row["command_id"]) for row in rows]

    def command(self, result: MissionCommandResult) -> MissionCommandResult:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO mission_commands
                    (command_id, mission_id, command, status, state, message, requested_at, updated_at, status_history)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(command_id) DO UPDATE SET
                    status=excluded.status, state=excluded.state, message=excluded.message,
                    updated_at=excluded.updated_at, status_history=excluded.status_history
                """,
                (result.command_id, result.mission_id, result.command, result.status.value,
                 result.state.value, result.message, result.requested_at.isoformat(),
                 result.updated_at.isoformat(), json.dumps([item.value for item in result.status_history])),
            )
        return result

    def existing_command(self, command_id: str) -> MissionCommandResult | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM mission_commands WHERE command_id = ?", (command_id,)).fetchone()
        if row is None:
            return None
        requested_at = row["requested_at"] or datetime.now(UTC).isoformat()
        updated_at = row["updated_at"] or requested_at
        history = json.loads(row["status_history"] or "[]")
        return MissionCommandResult(command_id=row["command_id"], mission_id=row["mission_id"], command=row["command"],
                                    status=row["status"], state=row["state"], message=row["message"],
                                    requested_at=requested_at, updated_at=updated_at,
                                    status_history=history or [row["status"]])

    def commands(self, mission_id: str) -> list[MissionCommandResult]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT command_id FROM mission_commands WHERE mission_id = ? ORDER BY requested_at",
                (mission_id,),
            ).fetchall()
        return [result for row in rows if (result := self.existing_command(row["command_id"])) is not None]

    @staticmethod
    def _row(row: sqlite3.Row) -> MissionDraft:
        waypoints = json.loads(row["waypoints"])
        fallback_coordinates = (
            (18.5214, 73.8577), (18.5224, 73.8587), (18.5234, 73.8597),
            (18.5244, 73.8607), (18.5254, 73.8617),
        )
        for index, waypoint in enumerate(waypoints):
            waypoint.setdefault("latitude_deg", fallback_coordinates[index][0])
            waypoint.setdefault("longitude_deg", fallback_coordinates[index][1])
        return MissionDraft(id=row["id"], name=row["name"], revision=row["revision"], state=row["state"],
                            waypoints=waypoints, active_waypoint_index=row["active_waypoint_index"],
                            home_latitude_deg=row["home_latitude_deg"],
                            home_longitude_deg=row["home_longitude_deg"],
                            onboard_state=row["onboard_state"])


class MissionManager:
    def __init__(self, store: MissionStore) -> None:
        self.store = store
        self.selected_id = self.store.list_missions()[0].id
        self.pending_since: dict[str, float] = {}
        self.command_timeout_s = 5.0

    def selected(self) -> MissionDraft:
        return self.store.get(self.selected_id)

    def select(self, mission_id: str) -> MissionDraft:
        mission = self.store.get(mission_id)
        if mission.state == MissionState.EXECUTING:
            raise ValueError("An executing mission cannot be replaced.")
        self.selected_id = mission_id
        return mission

    def status(self, mission: MissionDraft | None = None) -> MissionStatus:
        mission = mission or self.selected()
        active = mission.waypoints[mission.active_waypoint_index]
        completed = sum(waypoint.status == "completed" for waypoint in mission.waypoints)
        return MissionStatus(name=mission.name, state=mission.state, current_waypoint=active.label,
                             completed_waypoints=completed, total_waypoints=len(mission.waypoints))

    def execute(self, command: str, command_id: str, hardware: bool) -> MissionCommandResult:
        existing = self.store.existing_command(command_id)
        if existing:
            return existing
        mission = self.selected()
        transitions = {
            "upload": (MissionState.READY, MissionState.UPLOAD_PENDING),
            "start": (MissionState.UPLOADED, MissionState.EXECUTING),
            "abort": (MissionState.EXECUTING, MissionState.ABORTED),
        }
        if command not in transitions:
            raise ValueError("Unsupported mission command.")
        required, target = transitions[command]
        if mission.state != required:
            now = datetime.now(UTC)
            rejected = MissionCommandResult(
                command_id=command_id, mission_id=mission.id, command=command,
                status=CommandLifecycle.REJECTED, state=mission.state,
                message=f"Cannot {command} mission in {mission.state.value} state.",
                requested_at=now, updated_at=now, status_history=[CommandLifecycle.REQUESTED, CommandLifecycle.REJECTED],
            )
            self.store.command(rejected)
            self.store.event(mission.id, "WARNING", f"MISSION_{command.upper()}_REJECTED", rejected.message, command_id)
            raise ValueError(rejected.message)
        now = datetime.now(UTC)
        status = CommandLifecycle.SENT if hardware else CommandLifecycle.COMPLETED
        result_state = mission.state if hardware else target
        message = "Command sent; awaiting ARIES V3 acknowledgement." if hardware else f"Simulation {command} completed."
        history = (
            [CommandLifecycle.REQUESTED, CommandLifecycle.SENT]
            if hardware
            else [CommandLifecycle.REQUESTED, CommandLifecycle.SENT, CommandLifecycle.ACKNOWLEDGED,
                  CommandLifecycle.EXECUTING, CommandLifecycle.COMPLETED]
        )
        if hardware and command == "upload":
            result_state = MissionState.UPLOAD_PENDING
            mission = mission.model_copy(update={"state": MissionState.UPLOAD_PENDING, "revision": mission.revision + 1})
            self.store.save(mission)
        if not hardware:
            state = MissionState.UPLOADED if command == "upload" else target
            onboard_state = "SIMULATED_CONFIRMED" if command == "upload" else mission.onboard_state
            result_state = state
            mission = mission.model_copy(update={"state": state, "onboard_state": onboard_state, "revision": mission.revision + 1})
            self.store.save(mission)
        result = MissionCommandResult(command_id=command_id, mission_id=mission.id, command=command,
                                      status=status, state=result_state, message=message,
                                      requested_at=now, updated_at=datetime.now(UTC), status_history=history)
        self.store.command(result)
        if status is CommandLifecycle.SENT:
            self.pending_since[command_id] = monotonic()
        self.store.event(mission.id, "INFO" if not hardware else "WARNING", f"MISSION_{command.upper()}",
                         message, command_id)
        return result

    def command_status(self, command_id: str) -> MissionCommandResult:
        result = self.store.existing_command(command_id)
        if result is None:
            raise KeyError(command_id)
        if result.status is CommandLifecycle.SENT and monotonic() - self.pending_since.get(command_id, monotonic()) >= self.command_timeout_s:
            result = result.model_copy(update={
                "status": CommandLifecycle.TIMEOUT,
                "message": "ARIES V3 acknowledgement timed out.",
                "updated_at": datetime.now(UTC),
                "status_history": [*result.status_history, CommandLifecycle.TIMEOUT],
            })
            self.store.command(result)
        return result

    def acknowledge(self, command_id: str, status: CommandLifecycle) -> MissionCommandResult:
        result = self.command_status(command_id)
        allowed_current = {
            CommandLifecycle.SENT: {
                CommandLifecycle.ACKNOWLEDGED, CommandLifecycle.EXECUTING,
                CommandLifecycle.COMPLETED, CommandLifecycle.REJECTED,
            },
            CommandLifecycle.ACKNOWLEDGED: {
                CommandLifecycle.EXECUTING, CommandLifecycle.COMPLETED,
                CommandLifecycle.REJECTED,
            },
            CommandLifecycle.EXECUTING: {
                CommandLifecycle.COMPLETED, CommandLifecycle.REJECTED,
            },
        }
        if status not in allowed_current.get(result.status, set()):
            raise ValueError("Command acknowledgement is not valid for its current lifecycle.")
        updated = result.model_copy(update={
            "status": status, "updated_at": datetime.now(UTC),
            "status_history": [*result.status_history, status],
            "message": f"ARIES V3 reported {status.value}.",
        })
        if status is CommandLifecycle.COMPLETED:
            mission = self.selected()
            if mission.id != result.mission_id:
                raise ValueError("Command completion does not match the selected mission.")
            target_state = {
                "upload": MissionState.UPLOADED,
                "start": MissionState.EXECUTING,
                "abort": MissionState.ABORTED,
            }[result.command]
            if result.command == "abort" and mission.state != MissionState.EXECUTING:
                raise ValueError("Abort completion does not match the executing mission.")
            mission = mission.model_copy(update={"state": target_state, "revision": mission.revision + 1})
            self.store.save(mission)
            updated = updated.model_copy(update={"state": target_state})
            self.store.event(mission.id, "WARNING" if result.command == "abort" else "INFO",
                             f"MISSION_{result.command.upper()}_CONFIRMED", updated.message, command_id)
        elif status is CommandLifecycle.REJECTED:
            self.store.event(result.mission_id, "WARNING", "MISSION_COMMAND_REJECTED", updated.message, command_id)
        self.store.command(updated)
        return updated

    def tick(self) -> MissionEvent | None:
        mission = self.selected()
        if mission.state != MissionState.EXECUTING:
            return None
        index = mission.active_waypoint_index
        if index >= len(mission.waypoints) - 1:
            return None
        waypoints = [waypoint.model_copy() for waypoint in mission.waypoints]
        waypoints[index] = waypoints[index].model_copy(update={"status": "completed"})
        next_index = index + 1
        waypoints[next_index] = waypoints[next_index].model_copy(update={"status": "current"})
        mission = mission.model_copy(update={"waypoints": waypoints, "active_waypoint_index": next_index, "revision": mission.revision + 1})
        self.store.save(mission)
        return self.store.event(mission.id, "INFO", "WAYPOINT_REACHED", f"Reached {waypoints[index].label}.")
