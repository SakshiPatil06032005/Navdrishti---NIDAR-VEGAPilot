export type SettingsState = {
  source: 'simulation' | 'hardware'
  serial: { port: string; baud_rate: number }
  dashboard: {
    refresh_rate_hz: number
    measurement_units: 'metric' | 'imperial'
    theme: 'dark' | 'light' | 'system'
    alerts_enabled: boolean
    sound_enabled: boolean
  }
  system: {
    controller_model: string | null
    firmware_version: string | null
    telemetry_schema_version: string
    device_id: string | null
  }
  safety: {
    geofence: Record<string, unknown> | null
    mission_limits: Record<string, unknown> | null
    failsafe_policy: Record<string, unknown> | null
    validation_status: string
  }
}

export type ProviderHealth = {
  provider_connected: string
  provider_stale: string
  provider_error: string
  packet_error_count: string
  timeout_count: string
  last_valid_packet_at: string
}

const API_BASE = 'http://localhost:8000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail ?? `Settings API request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export function fetchSettings() {
  return request<SettingsState>('/api/settings')
}

export function fetchSerialPorts() {
  return request<{ device: string; description: string }[]>('/api/settings/serial/ports')
}

export function fetchProviderHealth() {
  return request<ProviderHealth>('/api/health')
}

export function saveDashboardSettings(settings: SettingsState['dashboard']) {
  return request<SettingsState['dashboard']>('/api/settings/dashboard', { method: 'PUT', body: JSON.stringify(settings) })
}

export function saveSerialSettings(settings: SettingsState['serial']) {
  return request<SettingsState['serial']>('/api/settings/serial', { method: 'PUT', body: JSON.stringify(settings) })
}

export function selectTelemetrySource(source: SettingsState['source']) {
  return request<SettingsState>(`/api/settings/source?source=${source}`, { method: 'PUT' })
}

export function connectSerial() {
  return request<SettingsState>('/api/settings/serial/connect', { method: 'POST' })
}

export function disconnectSerial() {
  return request<SettingsState>('/api/settings/serial/disconnect', { method: 'POST' })
}
