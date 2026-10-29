export type MissionState = 'READY' | 'STANDBY' | 'UPLOADED' | 'UPLOAD_PENDING' | 'CONFIRMED_ONBOARD' | 'EXECUTING' | 'ACTIVE' | 'PAUSED' | 'RETURNING_HOME' | 'AT_HOME' | 'ABORTED' | 'COMPLETED' | 'FAULT' | 'ERROR'
export type MissionWaypoint = { id: string; label: string; latitude_deg: number; longitude_deg: number; altitude_m: number; status: string }
export type MissionDraft = { id: string; name: string; revision: number; state: MissionState; waypoints: MissionWaypoint[]; active_waypoint_index: number; home_latitude_deg: number | null; home_longitude_deg: number | null; onboard_state: string }
export type SelectedMission = { id: string; name: string; state: MissionState; waypoints: MissionWaypoint[]; completion_percent: number; home_latitude_deg: number | null; home_longitude_deg: number | null }
export type MissionEvent = { id: string; mission_id: string; timestamp: string; level: string; code: string; message: string; command_id: string | null }
export type MissionCommandResult = { command_id: string; mission_id: string; command: string; status: string; state: MissionState; message: string; requested_at?: string; updated_at?: string; status_history?: string[] }
export type FailsafeCheck = { name: string; status: string; message: string; timestamp: string }
export type FailsafePolicy = { enabled: boolean; low_battery_percent: number; telemetry_timeout_s: number; require_gnss_fix: boolean; require_sensor_health: boolean; action: 'INSPECT_ONLY'; validation_status: string }
export type FailsafeStatus = { policy: FailsafePolicy; preflight_ready: boolean; checks: FailsafeCheck[]; evaluated_at: string; automatic_action_taken: boolean }

const API_BASE = 'http://localhost:8000'
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail ?? `Mission API request failed (${response.status})`)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

export const fetchMissions = () => request<MissionDraft[]>('/api/missions')
export const fetchSelectedMission = () => request<SelectedMission>('/api/mission')
export const fetchMissionEvents = (id: string) => request<MissionEvent[]>(`/api/missions/${id}/events`)
export const selectMission = (id: string) => request<MissionDraft>(`/api/missions/${id}/select`, { method: 'POST' })
export const saveMission = (mission: MissionDraft) => request<MissionDraft>(`/api/missions/${mission.id}`, { method: 'PUT', body: JSON.stringify(mission) })
export const createMission = (mission: MissionDraft) => request<MissionDraft>('/api/missions', { method: 'POST', body: JSON.stringify(mission) })
export const deleteMission = (id: string) => request<void>(`/api/missions/${id}`, { method: 'DELETE' })
export const commandMission = (id: string, command: string, commandId: string) => request<MissionCommandResult>(`/api/missions/${id}/commands/${command}?command_id=${commandId}`, { method: 'POST' })
export const simulationCommand = (id: string, command: string, commandId: string) => request<MissionCommandResult>(`/api/missions/${id}/simulation-command?command=${encodeURIComponent(command)}&command_id=${commandId}`, { method: 'POST' })
export const injectSimulationFault = (fault: 'gnss' | 'battery' | 'communication') => request<{ fault: string; status: string }>(`/api/simulation/faults?fault=${fault}`, { method: 'POST' })
export const clearSimulationFaults = () => request<{ status: string }>('/api/simulation/faults', { method: 'DELETE' })
export const uploadMissionToSimulator = (id: string, commandId: string) => request<MissionCommandResult>(`/api/missions/${id}/simulation-upload?command_id=${commandId}`, { method: 'POST' })
export const fetchCommandStatus = (commandId: string) => request<MissionCommandResult>(`/api/missions/commands/${commandId}`)
export const fetchMissionCommands = (id: string) => request<MissionCommandResult[]>(`/api/missions/${id}/commands`)
export const acknowledgeMissionCommand = (commandId: string, status: string) => request<MissionCommandResult>(`/api/missions/commands/${commandId}/ack?status=${status}`, { method: 'POST' })
export const fetchFailsafeStatus = () => request<FailsafeStatus>('/api/failsafe/status')
export const fetchFailsafePolicy = () => request<FailsafePolicy>('/api/failsafe/policy')
export const saveFailsafePolicy = (policy: FailsafePolicy) => request<FailsafePolicy>('/api/failsafe/policy', { method: 'PUT', body: JSON.stringify(policy) })
export const fetchMissionLimits = () => request<{ max_relative_altitude_m: number }>('/api/missions/limits')
export const fetchRouteLength = (id: string) => request<{ distance_m: number }>(`/api/missions/${id}/route-length`)
