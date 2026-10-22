import type { LogHistoryResponse, LogQuery, LogRecordsResponse, LogStats } from '../types'

const API_BASE = 'http://localhost:8000'

function buildParams(query: LogQuery): URLSearchParams {
  const params = new URLSearchParams()
  const entries: [string, string | number | undefined][] = [
    ['start', query.start],
    ['end', query.end],
    ['sensor', query.sensor],
    ['severity', query.severity],
    ['event_type', query.event_type],
    ['data_source', query.data_source],
    ['search', query.search],
    ['limit', query.limit],
    ['offset', query.offset],
  ]
  entries.forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    params.set(key, String(value))
  })
  return params
}

async function getJson<T>(path: string, query: LogQuery, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}?${buildParams(query).toString()}`, { signal })
  if (!response.ok) throw new Error(`VEGA-Pilot log API request failed (${response.status})`)
  return (await response.json()) as T
}

export function fetchLogRecords(query: LogQuery, signal?: AbortSignal) {
  return getJson<LogRecordsResponse>('/api/logs/records', query, signal)
}

export function fetchLogHistory(query: LogQuery, signal?: AbortSignal) {
  return getJson<LogHistoryResponse>('/api/logs/history', query, signal)
}

export function fetchLogStats(query: LogQuery, signal?: AbortSignal) {
  return getJson<LogStats>('/api/logs/stats', query, signal)
}

export async function downloadLogCsv(query: LogQuery): Promise<void> {
  const response = await fetch(`${API_BASE}/api/logs/export.csv?${buildParams(query).toString()}`)
  if (!response.ok) throw new Error(`VEGA-Pilot CSV export failed (${response.status})`)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `vega-pilot-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
