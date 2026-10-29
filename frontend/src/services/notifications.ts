export type NotificationSeverity = 'CRITICAL' | 'WARNING' | 'INFORMATION' | 'SUCCESS'
export type NotificationSource = 'simulation' | 'hardware'

export type NotificationRecord = {
  id: string
  event_id: string
  alert_type: string
  severity: NotificationSeverity
  title: string
  message: string
  voice_message: string
  timestamp: string
  source: NotificationSource
  read: boolean
  acknowledged: boolean
  dismissed: boolean
  mission_id: string | null
}

export type NotificationPolicy = {
  low_battery_warning_percent: number
  low_battery_critical_percent: number
  low_battery_hysteresis_percent: number
  alert_cooldown_s: number
  announce_recovery: boolean
}

const API_BASE = 'http://localhost:8000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail ?? `Notification request failed (${response.status})`)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

export const fetchNotifications = (includeDismissed = false) =>
  request<NotificationRecord[]>(`/api/notifications?include_dismissed=${includeDismissed ? 'true' : 'false'}`)
export const fetchUnreadCount = () => request<{ unread_count: number }>('/api/notifications/unread-count')
export const markRead = (id: string) => request<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: 'POST' })
export const dismissNotification = (id: string) => request<{ ok: boolean }>(`/api/notifications/${id}/dismiss`, { method: 'POST' })
export const markAllRead = () => request<{ updated: number }>('/api/notifications/read-all', { method: 'POST' })
export const fetchNotificationPolicy = () => request<NotificationPolicy>('/api/notifications/policy')
export const saveNotificationPolicy = (policy: NotificationPolicy) =>
  request<NotificationPolicy>('/api/notifications/policy', { method: 'PUT', body: JSON.stringify(policy) })
export const sendTestNotification = (severity: NotificationSeverity) =>
  request<NotificationRecord>(`/api/notifications/test?severity=${severity}`, { method: 'POST' })
