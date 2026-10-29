import { Activity, Battery, Cpu, Download, Gauge, Radio, Satellite, Thermometer, Wifi } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Panel } from '../components/Panel'
import { downloadLogCsv, fetchLogRecords } from '../services/logs'
import { useTelemetry, type SensorStatus } from '../services/telemetry'
import type { LogRecord } from '../types'

const numberValue = (value: number | null | undefined, digits = 1, unit = '') =>
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : 'N/A'

function SensorRow({ name, icon: Icon, status, timestamp, ageMs, detail }: {
  name: string
  icon: typeof Activity
  status: SensorStatus
  timestamp: string | null
  ageMs: number | null
  detail: string
}) {
  const age = timestamp && ageMs !== null ? `${(ageMs / 1000).toFixed(1)}s ago` : 'N/A'
  return <div className="sensor-row">
    <div className={`sensor-icon ${status.toLowerCase().replace(' ', '-')}`}><Icon size={15} /></div>
    <div className="sensor-main"><div className="sensor-row-heading"><div><h3>{name}</h3><p>{detail}</p></div><span className={`sensor-status ${status.toLowerCase().replace(' ', '-')}`}><span className="status-dot" />{status}</span></div><div className="sensor-freshness"><span className="freshness-pulse" /> LAST VALID UPDATE <b>{status === 'NO DATA' ? 'N/A' : age}</b></div></div>
  </div>
}

export function TelemetryPage() {
  const { telemetry, history, connectionState, stale, ageMs, error, diagnostics } = useTelemetry()
  const [faults, setFaults] = useState<LogRecord[]>([])
  const [logError, setLogError] = useState<string | null>(null)
  const source = telemetry?.data_source.toUpperCase() ?? 'NO SOURCE'
  const position = telemetry?.gnss_position
  const battery = telemetry?.battery
  const power = battery && battery.voltage_v > 0 && Number.isFinite(battery.current_a)
    ? battery.voltage_v * battery.current_a
    : null
  const chartData = useMemo(() => history.map((packet) => ({
    time: new Date(packet.timestamp).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' }),
    altitude: packet.gnss_position.altitude_m,
    voltage: packet.battery.voltage_v,
    speed: packet.gnss_position.ground_speed_mps,
  })), [history])

  useEffect(() => {
    const controller = new AbortController()
    fetchLogRecords({ event_type: 'FAULT', limit: 8, offset: 0 }, controller.signal)
      .then((response) => setFaults(response.records))
      .catch((cause) => { if (!controller.signal.aborted) setLogError(cause instanceof Error ? cause.message : 'Unable to load fault history') })
    return () => controller.abort()
  }, [telemetry?.timestamp])

  async function exportLogs() {
    try {
      await downloadLogCsv({ limit: 200, offset: 0 })
      setLogError(null)
    } catch (cause) {
      setLogError(cause instanceof Error ? cause.message : 'CSV export failed')
    }
  }

  const sensorTimestamp = telemetry?.timestamp ?? null
  return <>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><p className="eyebrow text-cyan-300">Validated WebSocket stream / diagnostics</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Telemetry</h1></div>
      <div className="simulated-label"><Radio size={12} /> {source} DATA</div>
    </div>

    <div className="summary-grid">
      <div className="summary-card"><div className="summary-icon cyan"><Radio size={19} /></div><div><p className="eyebrow">Source mode</p><p className="mt-1 text-lg font-semibold text-slate-100">{source}</p><p className="mt-1 text-[11px] text-cyan-300">{telemetry ? 'Validated packet source' : 'No packet received'}</p></div></div>
      <div className="summary-card"><div className="summary-icon green"><Wifi size={19} /></div><div><p className="eyebrow">Device status</p><p className="mt-1 text-lg font-semibold text-slate-100">{stale ? 'STALE' : connectionState}</p><p className="mt-1 text-[11px] text-slate-400">{ageMs === null ? 'No valid update' : `${(ageMs / 1000).toFixed(1)}s packet age`}</p></div></div>
      <div className="summary-card"><div className="summary-icon amber"><Battery size={19} /></div><div><p className="eyebrow">Battery</p><p className="mt-1 text-lg font-semibold text-slate-100">{numberValue(battery?.remaining_percent, 0, '%')}</p><p className="mt-1 text-[11px] text-slate-400">{numberValue(battery?.voltage_v, 2, ' V')} · {numberValue(power, 1, ' W')}</p></div></div>
      <div className="summary-card"><div className="summary-icon cyan"><Cpu size={19} /></div><div><p className="eyebrow">Packet sequence</p><p className="mt-1 text-lg font-semibold text-slate-100">{diagnostics.packetSequence || 'N/A'}</p><p className="mt-1 text-[11px] text-slate-400">{diagnostics.validPacketCount} valid · {diagnostics.invalidPacketCount} invalid</p></div></div>
    </div>

    <div className="dashboard-grid mt-4">
      <Panel title="Live Flight Data" icon={Activity} className="telemetry-panel">
        <div className="position-metrics">
          {[['Latitude', position ? `${position.latitude_deg.toFixed(5)}°` : 'N/A'], ['Longitude', position ? `${position.longitude_deg.toFixed(5)}°` : 'N/A'], ['Altitude', numberValue(position?.altitude_m, 1, ' m')], ['Speed', numberValue(position?.ground_speed_mps, 1, ' m/s')], ['Heading', numberValue(position?.heading_deg, 1, '°')], ['Vertical speed', numberValue(telemetry?.barometer.vertical_speed_mps, 2, ' m/s')], ['Roll', numberValue(telemetry?.imu_attitude.roll_deg, 1, '°')], ['Pitch', numberValue(telemetry?.imu_attitude.pitch_deg, 1, '°')], ['Yaw', numberValue(telemetry?.imu_attitude.yaw_deg, 1, '°')]].map(([label, value]) => <div className="position-metric" key={label}><div className="position-metric-icon cyan"><Gauge size={13} /></div><div><span>{label}</span><strong>{value}</strong></div></div>)}
        </div>
        <div className="position-footer"><span>FLIGHT <b>{telemetry?.flight_mode ?? 'N/A'}</b></span><span>MISSION <b>{telemetry?.mission_status.state ?? 'N/A'}</b></span><span>ACTIVE WP <b>{telemetry?.mission_status.current_waypoint ?? 'N/A'}</b></span></div>
      </Panel>

      <Panel title="Sensor Health" icon={Satellite} action={<span className={stale ? 'badge degraded' : 'badge green'}>{stale ? 'STALE' : 'FRESH'}</span>}>
        <div className="sensor-list">
          <SensorRow name="IMU" icon={Activity} status={telemetry?.sensor_health.imu ?? 'NO DATA'} timestamp={sensorTimestamp} ageMs={ageMs} detail="Attitude and angular rates" />
          <SensorRow name="GNSS" icon={Satellite} status={telemetry?.sensor_health.gnss ?? 'NO DATA'} timestamp={sensorTimestamp} ageMs={ageMs} detail={position ? `${position.fix} · ${position.satellites} satellites` : 'Fix and satellites unavailable'} />
          <SensorRow name="BAROMETER" icon={Thermometer} status={telemetry?.sensor_health.barometer ?? 'NO DATA'} timestamp={sensorTimestamp} ageMs={ageMs} detail="Pressure and vertical speed" />
          <SensorRow name="BATTERY MONITOR" icon={Battery} status={telemetry?.sensor_health.battery ?? 'NO DATA'} timestamp={sensorTimestamp} ageMs={ageMs} detail="Voltage and current telemetry" />
        </div>
      </Panel>

      <Panel title="Battery Monitoring" icon={Battery}>
        <div className="summary-grid">
          {[['Voltage', numberValue(battery?.voltage_v, 2, ' V')], ['Current', numberValue(battery?.current_a, 2, ' A')], ['Power', numberValue(power, 1, ' W')], ['Percentage', numberValue(battery?.remaining_percent, 0, '%')]].map(([label, value]) => <div className="summary-card" key={label}><div><p className="eyebrow">{label}</p><p className="mt-1 text-xl font-semibold text-white">{value}</p></div></div>)}
        </div>
        <p className="settings-help mt-4">Power is calculated only when voltage and current are valid. Unsupported measurements display N/A.</p>
      </Panel>

      <Panel title="Communication Diagnostics" icon={Wifi}>
        <div className="diagnostic-grid">
          {[['Source mode', source], ['Link status', telemetry?.telemetry_link.connected ? 'CONNECTED' : telemetry ? 'DISCONNECTED' : 'N/A'], ['Packet sequence', diagnostics.packetSequence || 'N/A'], ['Valid packets', diagnostics.validPacketCount], ['Invalid packets', diagnostics.invalidPacketCount], ['Stale data', stale ? 'YES' : 'NO'], ['Reconnect attempts', diagnostics.reconnectAttempts], ['Latency', numberValue(telemetry?.telemetry_link.latency_ms, 0, ' ms')]].map(([label, value]) => <div className="diagnostic-item" key={label}><span>{label}</span><b>{value}</b></div>)}
        </div>
        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
      </Panel>

      <Panel title="History and Logs" icon={Gauge} className="telemetry-panel">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="telemetry-chart-card"><div className="chart-card-heading"><span>Altitude</span><b>m</b></div><ResponsiveContainer width="100%" height={150}><LineChart data={chartData}><CartesianGrid stroke="#17324c" strokeDasharray="3 3" /><XAxis dataKey="time" hide /><YAxis tick={{ fill: '#668397', fontSize: 8 }} /><Tooltip /><Line dataKey="altitude" stroke="#38bdf8" dot={false} /></LineChart></ResponsiveContainer></div>
          <div className="telemetry-chart-card"><div className="chart-card-heading"><span>Battery voltage</span><b>V</b></div><ResponsiveContainer width="100%" height={150}><LineChart data={chartData}><CartesianGrid stroke="#17324c" strokeDasharray="3 3" /><XAxis dataKey="time" hide /><YAxis tick={{ fill: '#668397', fontSize: 8 }} /><Tooltip /><Line dataKey="voltage" stroke="#34d399" dot={false} /></LineChart></ResponsiveContainer></div>
        </div>
        <div className="mt-4 flex items-center justify-between"><p className="eyebrow">Recent fault events</p><button className="outline-button" onClick={() => void exportLogs()}><Download size={13} /> CSV EXPORT</button></div>
        {logError && <p className="mt-2 text-xs text-red-300">{logError}</p>}
        <div className="log-lines mt-2">{faults.length ? faults.map((fault) => <p key={fault.uid}><span>{new Date(fault.timestamp).toLocaleTimeString()}</span> <b className="text-amber-400">{fault.severity}</b> {fault.code ?? 'FAULT'} · {fault.message}</p>) : <p><span>--</span> <b className="text-slate-500">INFO</b> No persisted fault events available</p>}</div>
      </Panel>
    </div>
  </>
}
