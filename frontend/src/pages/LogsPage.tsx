import {
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  List,
  Radio,
  RefreshCw,
  Search,
  WifiOff,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Panel, SummaryCard } from '../components/Panel'
import { downloadLogCsv, fetchLogHistory, fetchLogRecords, fetchLogStats } from '../services/logs'
import type {
  LogHistoryPoint,
  LogHistoryResponse,
  LogQuery,
  LogRecord,
  LogRecordsResponse,
  LogStats,
} from '../types'

const PAGE_SIZE = 50
const REFRESH_INTERVAL_MS = 15_000

type FilterState = {
  search: string
  start: string
  end: string
  sensor: string
  severity: string
  category: string
  data_source: string
}

const EMPTY_FILTERS: FilterState = {
  search: '',
  start: '',
  end: '',
  sensor: '',
  severity: '',
  category: '',
  data_source: '',
}

const SENSOR_OPTIONS = [
  { value: '', label: 'All sensors' },
  { value: 'imu', label: 'IMU' },
  { value: 'gnss', label: 'GNSS' },
  { value: 'barometer', label: 'Barometer' },
  { value: 'battery', label: 'Battery' },
  { value: 'link', label: 'Telemetry link' },
]

const SEVERITY_OPTIONS = [
  { value: '', label: 'All severities' },
  { value: 'INFO', label: 'INFO' },
  { value: 'WARNING', label: 'WARNING' },
  { value: 'ERROR', label: 'ERROR' },
  { value: 'CRITICAL', label: 'CRITICAL' },
]

const EVENT_TYPE_OPTIONS = [
  { value: '', label: 'All categories' },
  { value: 'Telemetry', label: 'Telemetry' },
  { value: 'Mission', label: 'Mission' },
  { value: 'Waypoint', label: 'Waypoint' },
  { value: 'Sensor', label: 'Sensor' },
  { value: 'Battery', label: 'Battery' },
  { value: 'Communication', label: 'Communication' },
  { value: 'Failsafe', label: 'Failsafe' },
  { value: 'System', label: 'System' },
]

const DATA_SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'simulation', label: 'SIMULATED' },
  { value: 'hardware', label: 'HARDWARE' },
]

function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}

type LogPayloads = {
  records: LogRecordsResponse
  history: LogHistoryResponse
  stats: LogStats
}

async function fetchLogPayloads(query: LogQuery, signal?: AbortSignal): Promise<LogPayloads> {
  const [records, history, stats] = await Promise.all([
    fetchLogRecords(query, signal),
    fetchLogHistory(query, signal),
    fetchLogStats(query, signal),
  ])
  return { records, history, stats }
}

function HistoryChart({
  points,
  dataKey,
  label,
  unit,
  color,
}: {
  points: LogHistoryPoint[]
  dataKey: 'battery_voltage_v' | 'altitude_m'
  label: string
  unit: string
  color: string
}) {
  const data = points.map((point) => ({
    time: new Date(point.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    battery_voltage_v: point.battery_voltage_v,
    altitude_m: point.altitude_m,
  }))

  return (
    <div className="telemetry-chart-card">
      <div className="chart-card-heading"><span>{label}</span><b>{unit}</b></div>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid stroke="#17324c" strokeDasharray="3 3" />
          <XAxis dataKey="time" tick={{ fill: '#668397', fontSize: 8 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: '#668397', fontSize: 8 }} tickLine={false} axisLine={false} width={38} />
          <Tooltip
            contentStyle={{ background: '#071a2b', border: '1px solid #286079', fontSize: 10 }}
            labelStyle={{ color: '#9cb8c8' }}
            formatter={(value) => [`${Number(value).toFixed(2)} ${unit}`, label]}
          />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function LogRow({ record }: { record: LogRecord }) {
  const connectionLoss = record.code === 'CONNECTION_LOST'
  return (
    <tr className={connectionLoss ? 'connection-loss' : ''}>
      <td className="log-time">{formatTimestamp(record.timestamp)}</td>
      <td><span className={`log-badge ${record.event_type.toLowerCase()}`}>{record.event_type}</span></td>
      <td><span className={`log-badge ${record.severity.toLowerCase()}`}>{record.severity}</span></td>
      <td><span className={`log-badge ${record.data_source === 'hardware' ? 'hardware' : 'simulation'}`}>{record.data_source.toUpperCase()}</span></td>
      <td className="log-sensor">{record.sensor ?? '--'}</td>
      <td className="log-code">{record.code ?? '--'}</td>
      <td className="log-message">
        {connectionLoss && <WifiOff size={12} />}
        {record.message}
      </td>
    </tr>
  )
}

export function LogsPage() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [offset, setOffset] = useState(0)
  const [records, setRecords] = useState<LogRecord[]>([])
  const [total, setTotal] = useState(0)
  const [history, setHistory] = useState<LogHistoryPoint[]>([])
  const [stats, setStats] = useState<LogStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [databaseError, setDatabaseError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  const query = useMemo<LogQuery>(() => ({
    start: filters.start ? new Date(filters.start).toISOString() : undefined,
    end: filters.end ? new Date(filters.end).toISOString() : undefined,
    sensor: filters.sensor || undefined,
    severity: filters.severity || undefined,
    category: filters.category || undefined,
    data_source: filters.data_source || undefined,
    search: filters.search.trim() || undefined,
    limit: PAGE_SIZE,
    offset,
  }), [filters, offset])

  const applyPayloads = useCallback((payloads: LogPayloads) => {
    setRecords(payloads.records.records)
    setTotal(payloads.records.total)
    setDatabaseError(payloads.records.database_error)
    setHistory(payloads.history.points)
    setStats(payloads.stats)
    setUpdatedAt(new Date().toLocaleTimeString())
    setError(null)
  }, [])

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      applyPayloads(await fetchLogPayloads(query, signal))
    } catch (cause) {
      if (signal?.aborted) return
      setError(cause instanceof Error ? cause.message : 'Unable to reach the VEGA-Pilot log API')
    } finally {
      setLoading(false)
    }
  }, [query, applyPayloads])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    const run = async () => {
      try {
        const payloads = await fetchLogPayloads(query, controller.signal)
        if (cancelled) return
        applyPayloads(payloads)
      } catch (cause) {
        if (cancelled || controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : 'Unable to reach the VEGA-Pilot log API')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [query, applyPayloads])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => { void load() }, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [autoRefresh, load])

  function updateFilter(key: keyof FilterState, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value }))
    setOffset(0)
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS)
    setOffset(0)
  }

  async function handleExport() {
    setExporting(true)
    try {
      await downloadLogCsv(query)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'CSV export failed')
    } finally {
      setExporting(false)
    }
  }

  const linkEvents = records.filter(
    (record) => record.code === 'CONNECTION_LOST' || record.code === 'CONNECTION_RESTORED',
  )
  const sourceLabel = filters.data_source === 'simulation'
    ? 'SIMULATED DATA'
    : filters.data_source === 'hardware'
      ? 'HARDWARE DATA'
      : 'MIXED SOURCES'
  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + PAGE_SIZE, total)

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-cyan-300">Ground control station / event records</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Event Logs</h1>
        </div>
        <div className="simulated-label"><Radio size={12} /> {sourceLabel}</div>
      </div>

      {databaseError && (
        <div className="logs-notice error"><AlertTriangle size={13} /> Log store degraded: {databaseError}</div>
      )}
      {error && (
        <div className="logs-notice error"><AlertTriangle size={13} /> {error}</div>
      )}

      <div className="summary-grid">
        <SummaryCard label="Stored records" value={String(stats?.total ?? 0)} detail={`${stats?.telemetry ?? 0} telemetry · ${stats?.mission ?? 0} mission · ${stats?.system ?? 0} system`} icon={List} />
        <SummaryCard label="Fault events" value={String(stats?.faults ?? 0)} detail={`${stats?.warnings ?? 0} warnings raised`} icon={AlertTriangle} tone="amber" />
        <SummaryCard label="Errors" value={String(stats?.errors ?? 0)} detail="Error and critical severity" icon={AlertOctagon} tone="red" />
        <SummaryCard label="Connection losses" value={String(stats?.connection_losses ?? 0)} detail="Telemetry link dropouts" icon={WifiOff} tone="red" />
      </div>

      <Panel title="Filters" icon={Filter} className="logs-filter-panel mt-4" action={<span className="text-[10px] text-slate-500">{total} MATCHING RECORDS</span>}>
        <div className="logs-filter-grid">
          <label className="logs-field">
            <span>Search</span>
            <div className="logs-input-wrap"><Search size={12} /><input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="message or fault code" /></div>
          </label>
          <label className="logs-field">
            <span>From date & time</span>
              <input type="datetime-local" value={filters.start} onChange={(event) => updateFilter('start', event.target.value)} />
          </label>
          <label className="logs-field">
            <span>To date & time</span>
            <input type="datetime-local" value={filters.end} onChange={(event) => updateFilter('end', event.target.value)} />
          </label>
          <label className="logs-field">
            <span>Sensor</span>
            <select value={filters.sensor} onChange={(event) => updateFilter('sensor', event.target.value)}>
              {SENSOR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="logs-field">
            <span>Severity</span>
            <select value={filters.severity} onChange={(event) => updateFilter('severity', event.target.value)}>
              {SEVERITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="logs-field">
            <span>Event category</span>
            <select value={filters.category} onChange={(event) => updateFilter('category', event.target.value)}>
              {EVENT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="logs-field">
            <span>Data source</span>
            <select value={filters.data_source} onChange={(event) => updateFilter('data_source', event.target.value)}>
              {DATA_SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="logs-filter-actions">
            <button className="outline-button" onClick={resetFilters}><X size={13} /> CLEAR FILTERS</button>
            <button className="outline-button" onClick={() => { void load() }}><RefreshCw size={13} /> REFRESH</button>
            <button className="primary-button" onClick={() => { void handleExport() }} disabled={exporting}>
              <Download size={13} /> {exporting ? 'EXPORTING' : 'EXPORT CSV'}
            </button>
          </div>
        </div>
        <div className="logs-filter-footer">
          <span className={autoRefresh ? 'logs-toggle active' : 'logs-toggle'} onClick={() => setAutoRefresh((value) => !value)} role="switch" aria-checked={autoRefresh} tabIndex={0}>
            <i /> AUTO-REFRESH {autoRefresh ? 'ON' : 'OFF'}
          </span>
          <span>{updatedAt ? `UPDATED ${updatedAt}` : 'AWAITING FIRST RESPONSE'}</span>
          <span>{loading ? 'LOADING…' : `${total} RECORDS STORED`}</span>
        </div>
      </Panel>

      <div className="logs-grid mt-4">
        <Panel title="Historical Telemetry" icon={BarChart3} action={<span className="text-[10px] text-slate-500">{history.length} SAMPLES</span>}>
          <div className="logs-charts">
            <HistoryChart points={history} dataKey="battery_voltage_v" label="BATTERY VOLTAGE" unit="V" color="#fbbf24" />
            <HistoryChart points={history} dataKey="altitude_m" label="ALTITUDE" unit="m" color="#22d3ee" />
          </div>
        </Panel>

        <Panel title="Telemetry Connection Events" icon={WifiOff} action={<span className="text-[10px] text-slate-500">CURRENT PAGE</span>}>
          <div className="logs-connection-list">
            {linkEvents.map((event) => (
              <div key={event.uid} className={event.code === 'CONNECTION_LOST' ? 'logs-connection-item lost' : 'logs-connection-item restored'}>
                <span className="logs-connection-time">{formatTimestamp(event.timestamp)}</span>
                <span className="logs-connection-code">{event.code === 'CONNECTION_LOST' ? 'LINK LOST' : 'LINK RESTORED'}</span>
                <span className="logs-connection-message">{event.message}</span>
              </div>
            ))}
            {!linkEvents.length && (
              <div className="empty-state"><Radio size={20} className="text-emerald-400" /><p>No link events recorded</p><span>The telemetry link has stayed up for this selection</span></div>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Records" icon={List} className="mt-4" action={<span className="text-[10px] text-slate-500">SHOWING {pageStart}–{pageEnd} OF {total}</span>}>
        <div className="logs-table-wrap">
          <table className="logs-table">
            <thead>
              <tr>
                <th>Timestamp (UTC)</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Source</th>
                <th>Sensor</th>
                <th>Code</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => <LogRow key={record.uid} record={record} />)}
            </tbody>
          </table>
          {!records.length && !loading && (
            <div className="empty-state"><Search size={22} className="text-slate-500" /><p>No records match these filters</p><span>Adjust the date range, sensor, severity or event type</span></div>
          )}
        </div>
        <div className="logs-pagination">
          <button className="outline-button" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}><ChevronLeft size={13} /> PREVIOUS</button>
          <span>PAGE {Math.floor(offset / PAGE_SIZE) + 1} OF {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
          <button className="outline-button" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total}><ChevronRight size={13} /> NEXT</button>
        </div>
      </Panel>
    </>
  )
}
