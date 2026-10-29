import {
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  Battery,
  CheckCircle2,
  Gauge,
  Home,
  Map,
  Navigation,
  Plane,
  Radio,
  Route,
  Signal,
  Terminal,
  Timer,
} from 'lucide-react'
import { MissionMap } from '../components/MissionMap'
import { FlightTimelinePanel, LiveTelemetryPanel, MissionProgressPanel } from '../components/MissionPanels'
import { Panel, StatusDot, SummaryCard } from '../components/Panel'
import { PositionAltitudePanel, SensorHealthPanel } from '../components/TelemetryPanels'
import { useTelemetry, type ConnectionState } from '../services/telemetry'

export function DashboardPage() {
  const { telemetry, connectionState, stale, history, ageMs, error } = useTelemetry()
  const mission = telemetry?.mission_status
  const connectionTone = connectionState === 'CONNECTED' && !stale ? 'green' : connectionState === 'CONNECTING' || connectionState === 'RECONNECTING' || stale ? 'amber' : 'red'
  const connectionLabel: Record<ConnectionState, string> = {
    CONNECTING: 'CONNECTING',
    CONNECTED: 'CONNECTED',
    DISCONNECTED: 'DISCONNECTED',
    RECONNECTING: 'RECONNECTING',
    ERROR: 'ERROR',
  }
  const faults = telemetry?.fault_events ?? []
  const sourceLabel = telemetry
    ? telemetry.data_source === 'hardware'
      ? 'HARDWARE DATA'
      : 'SIMULATED DATA'
    : 'NO TELEMETRY'

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-cyan-300">Ground control station / overview</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Mission Dashboard</h1>
        </div>
        <div className="simulated-label"><Radio size={12} /> {sourceLabel}</div>
      </div>

      <div className="summary-grid">
        <SummaryCard label="Flight mode" value={telemetry?.flight_mode ?? '--'} detail={telemetry ? `${telemetry.data_source.toUpperCase()} source` : 'Awaiting telemetry'} icon={Plane} />
        <SummaryCard label="Mission status" value={mission?.state ?? '--'} detail={mission ? `${mission.current_waypoint} · ${Math.round((mission.completed_waypoints / mission.total_waypoints) * 100)}%` : 'Awaiting telemetry'} icon={Route} tone="green" />
        <SummaryCard label="Telemetry link" value={stale ? 'STALE' : connectionLabel[connectionState]} detail={telemetry ? `${telemetry.telemetry_link.signal_strength_percent.toFixed(1)}% signal · ${ageMs === null ? '--' : `${(ageMs / 1000).toFixed(1)}s old`}` : 'No packet received'} icon={Signal} tone={connectionTone === 'red' ? 'red' : 'green'} />
        <SummaryCard label="Battery status" value={telemetry ? `${telemetry.battery.remaining_percent.toFixed(0)}%` : '--'} detail={telemetry ? `${telemetry.battery.voltage_v.toFixed(1)} V · ${telemetry.data_source.toUpperCase()}` : 'Awaiting telemetry'} icon={Battery} tone="amber" />
      </div>

      <div className="dashboard-grid mt-4">
        <Panel title="Mission Map" icon={Map} className="map-panel">
          <MissionMap />
        </Panel>

        <Panel title="Position & Altitude" icon={Navigation}>
          <PositionAltitudePanel />
        </Panel>

        <Panel title="Sensor Health" icon={Gauge}>
          <SensorHealthPanel />
        </Panel>

        <Panel title="Fault Alerts" icon={AlertTriangle} action={<span className={`badge ${faults.length ? 'degraded' : 'green'}`}>{faults.length} ACTIVE</span>}>
          {faults.length ? <div className="empty-state"><AlertTriangle size={25} className="text-amber-400" /><p>{faults.length} fault event{faults.length === 1 ? '' : 's'} reported</p>{faults.map((fault) => <span key={`${fault.timestamp}-${fault.code}`}>{fault.code}: {fault.message}</span>)}</div> : <div className="empty-state"><CheckCircle2 size={25} className="text-emerald-400" /><p>{telemetry ? 'All systems operating normally' : 'Awaiting telemetry'}</p><span>{telemetry ? `No unresolved ${telemetry.data_source} faults reported` : 'No fault state available'}</span></div>}
        </Panel>

        <Panel title="Return to Home / Abort Status" icon={Home}>
          <div className="rth-status"><div className="rth-ring"><Home size={21} /><span>READY</span></div><div><p className="text-sm font-medium text-white">Return to Home available</p><p className="mt-1 text-[11px] text-slate-500">Failsafe altitude: <b className="text-slate-300">100 m</b></p></div></div>
          <div className="button-row"><button className="outline-button"><Home size={13} /> RTH STANDBY</button><button className="danger-button"><AlertOctagon size={13} /> ABORT</button></div>
        </Panel>

        <Panel title="Mission Progress" icon={BarChart3}>
          <MissionProgressPanel />
        </Panel>

        <Panel title="Live Telemetry" icon={Radio} className="telemetry-panel" action={<span className="live-indicator"><StatusDot color={connectionTone} /> {connectionLabel[connectionState]}</span>}>
          <LiveTelemetryPanel />
        </Panel>

        <Panel title="Flight Timeline" icon={Timer}>
          <FlightTimelinePanel />
        </Panel>

        <Panel title="System Log" icon={Terminal} className="log-panel" action={<span className="text-[10px] text-slate-500">AUTO-SCROLL</span>}>
          <div className="log-lines">
            {history.slice(-4).reverse().map((packet) => <p key={packet.timestamp}><span>{new Date(packet.timestamp).toLocaleTimeString()}</span> <b className="text-emerald-400">INFO</b> Telemetry packet received · {packet.data_source.toUpperCase()}</p>)}
            {!history.length && <p><span>--</span> <b className="text-amber-400">WARN</b> {error ?? 'Waiting for telemetry packets'}</p>}
          </div>
        </Panel>
      </div>
    </>
  )
}
