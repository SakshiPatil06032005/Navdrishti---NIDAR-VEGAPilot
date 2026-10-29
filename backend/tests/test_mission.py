"""Mission state-machine and command lifecycle tests."""

from time import sleep

import pytest

from backend.mission import MissionManager, MissionStore
from backend.models import CommandLifecycle, MissionState
from backend.models import MissionWaypoint


def test_simulation_upload_start_progress_and_abort_are_persisted(tmp_path):
    manager = MissionManager(MissionStore(tmp_path / "mission.db"))
    mission = manager.selected()

    uploaded = manager.execute("upload", "cmd-upload-1", hardware=False)
    assert uploaded.status is CommandLifecycle.COMPLETED
    assert manager.selected().state is MissionState.UPLOADED

    started = manager.execute("start", "cmd-start-1", hardware=False)
    assert started.state is MissionState.EXECUTING
    event = manager.tick()
    assert event is not None
    assert manager.selected().active_waypoint_index == 1

    aborted = manager.execute("abort", "cmd-abort-1", hardware=False)
    assert aborted.state is MissionState.ABORTED
    assert manager.tick() is None
    assert manager.store.events(mission.id)[-1].code == "MISSION_ABORT"


def test_duplicate_command_is_idempotent(tmp_path):
    manager = MissionManager(MissionStore(tmp_path / "mission.db"))
    first = manager.execute("upload", "same-command", hardware=False)
    second = manager.execute("upload", "same-command", hardware=False)
    assert second == first
    assert len(manager.store.events(manager.selected().id)) == 1


def test_invalid_transition_is_rejected(tmp_path):
    manager = MissionManager(MissionStore(tmp_path / "mission.db"))
    with pytest.raises(ValueError, match="Cannot start"):
        manager.execute("start", "cmd-invalid", hardware=False)


def test_hardware_command_times_out_without_ack(tmp_path):
    manager = MissionManager(MissionStore(tmp_path / "mission.db"))
    pending = manager.execute("upload", "cmd-hardware", hardware=True)
    assert pending.status is CommandLifecycle.SENT
    manager.command_timeout_s = 0
    assert manager.command_status("cmd-hardware").status == "TIMEOUT"


def test_abort_command_lifecycle_and_duplicate_failure_are_persisted(tmp_path):
    manager = MissionManager(MissionStore(tmp_path / "mission.db"))
    manager.execute("upload", "cmd-upload", hardware=False)
    manager.execute("start", "cmd-start", hardware=False)

    first = manager.execute("abort", "cmd-abort", hardware=False)
    duplicate = manager.execute("abort", "cmd-abort", hardware=False)
    assert first == duplicate
    assert first.status is CommandLifecycle.COMPLETED
    assert first.status_history[-1] is CommandLifecycle.COMPLETED
    assert manager.selected().state is MissionState.ABORTED
    assert manager.tick() is None

    with pytest.raises(ValueError, match="Cannot abort"):
        manager.execute("abort", "cmd-abort-again", hardware=False)
    rejected = manager.store.existing_command("cmd-abort-again")
    assert rejected is not None
    assert rejected.status is CommandLifecycle.REJECTED


def test_hardware_abort_waits_for_onboard_completion(tmp_path):
    manager = MissionManager(MissionStore(tmp_path / "mission.db"))
    manager.execute("upload", "hw-upload", hardware=True)
    assert manager.selected().state is MissionState.UPLOAD_PENDING
    assert manager.acknowledge("hw-upload", CommandLifecycle.COMPLETED).state is MissionState.UPLOADED
    manager.execute("start", "hw-start", hardware=True)
    assert manager.acknowledge("hw-start", CommandLifecycle.COMPLETED).state is MissionState.EXECUTING
    pending = manager.execute("abort", "hw-abort", hardware=True)
    assert pending.status is CommandLifecycle.SENT
    assert manager.selected().state is MissionState.EXECUTING
    assert manager.acknowledge("hw-abort", CommandLifecycle.ACKNOWLEDGED).status is CommandLifecycle.ACKNOWLEDGED
    assert manager.selected().state is MissionState.EXECUTING
    completed = manager.acknowledge("hw-abort", CommandLifecycle.COMPLETED)
    assert completed.state is MissionState.ABORTED


def test_waypoint_coordinates_and_altitude_are_validated(tmp_path, monkeypatch):
    monkeypatch.setenv("VEGA_MAX_RELATIVE_ALTITUDE_M", "150")
    manager = MissionManager(MissionStore(tmp_path / "mission.db"))
    mission = manager.selected()
    invalid = mission.model_copy(update={
        "waypoints": [waypoint.model_copy(update={"altitude_m": 151}) for waypoint in mission.waypoints],
    })
    with pytest.raises(ValueError, match="configured limit"):
        manager.store.save(invalid)
    with pytest.raises(ValueError):
        MissionWaypoint(id="bad", label="Bad", latitude_deg=91, longitude_deg=0, altitude_m=10, status="pending")
