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
import { useEffect, useState } from 'react'
import { MissionMap } from '../components/MissionMap'
import { FlightTimelinePanel, LiveTelemetryPanel, MissionProgressPanel } from '../components/MissionPanels'
import { Panel, StatusDot, SummaryCard } from '../components/Panel'
import { PositionAltitudePanel, SensorHealthPanel } from '../components/TelemetryPanels'
import { useTelemetry, type ConnectionState } from '../services/telemetry'
import { fetchSelectedMission, simulationCommand, uploadMissionToSimulator, type SelectedMission } from '../services/missions'
import { clearSimulationFaults, injectSimulationFault } from '../services/missions'
import { useNotificationCenter } from '../services/notificationCenter'

function commandId() {
  return `${Date.now()}-${crypto.randomUUID()}`
}

export function DashboardPage() {
  const { telemetry, connectionState, stale, history, ageMs, error } = useTelemetry()
  const { toast, speechAvailable, speechBlocked, voice, unlockVoice, testVoice, updateVoice } = useNotificationCenter()
  const [selectedMission, setSelectedMission] = useState<SelectedMission | null>(null)
  const [busyCommand, setBusyCommand] = useState<string | null>(null)
  const [commandMessage, setCommandMessage] = useState<string | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  useEffect(() => {
    const load = () => { void fetchSelectedMission().then(setSelectedMission).catch(() => undefined) }
    load()
    const timer = window.setInterval(load, 1500)
    return () => window.clearInterval(timer)
  }, [])
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
  const missionId = selectedMission?.id
  const runCommand = async (command: string) => {
    if (!missionId || busyCommand) return
    if (command === 'abort' && !window.confirm('Abort the simulation mission?')) return
    setBusyCommand(command)
    setCommandMessage(null)
    setCommandError(null)
    try {
      const result = command === 'upload'
        ? await uploadMissionToSimulator(missionId, commandId())
        : await simulationCommand(missionId, command, commandId())
      if (result.status !== 'COMPLETED') throw new Error(result.message)
      setCommandMessage(`${command.toUpperCase()} confirmed by simulator.`)
    } catch (reason: unknown) {
      setCommandError(reason instanceof Error ? reason.message : `${command} failed`)
    } finally {
      setBusyCommand(null)
    }
  }
  const runFault = async (fault: 'gnss' | 'battery' | 'communication' | 'clear') => {
    if (busyCommand) return
    setBusyCommand(fault)
    setCommandMessage(null)
    setCommandError(null)
    try {
      if (fault === 'clear') await clearSimulationFaults()
      else await injectSimulationFault(fault)
      setCommandMessage(fault === 'clear' ? 'SIMULATED FAULTS CLEARED.' : `${fault.toUpperCase()} FAULT INJECTED.`)
    } catch (reason: unknown) {
      setCommandError(reason instanceof Error ? reason.message : 'Fault injection failed')
    } finally {
      setBusyCommand(null)
    }
  }
  const enableVoice = () => {
    updateVoice({ enabled: true, unlocked: true, muted: false, muteNonCritical: false })
    unlockVoice()
  }

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
        {toast && <div className="settings-alert warning fixed right-5 top-5 z-50 max-w-sm" role="status"><AlertTriangle size={16} /><span><b>{toast.title}</b><br />{toast.message}</span></div>}
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
          <div className="rth-status"><div className="rth-ring"><Home size={21} /><span>{mission?.state ?? 'READY'}</span></div><div><p className="text-sm font-medium text-white">Simulation mission controls</p><p className="mt-1 text-[11px] text-slate-500">Hardware actions remain disabled until ARIES V3 validation.</p></div></div>
          {(commandMessage || commandError) && <p className={`settings-help mt-3 ${commandError ? 'text-amber-300' : 'text-emerald-300'}`}>{commandError ?? commandMessage}</p>}
          <div className="button-row mt-3">
            {(['upload', 'start', 'pause', 'resume', 'standby', 'rth', 'reset'] as const).map((command) => <button key={command} className="outline-button" disabled={!missionId || busyCommand !== null} onClick={() => void runCommand(command)}>{busyCommand === command ? 'WAITING…' : command === 'rth' ? 'REQUEST RTH' : command === 'reset' ? 'RESET DEMO' : command.toUpperCase()}</button>)}
            <button className="danger-button" disabled={!missionId || busyCommand !== null} onClick={() => void runCommand('abort')}><AlertOctagon size={13} /> {busyCommand === 'abort' ? 'WAITING…' : 'ABORT MISSION'}</button>
          </div>
        </Panel>

        <Panel title="Simulation Fault Injection" icon={AlertTriangle}>
          <div className="settings-card">
            <p className="settings-help">Simulation-only controls. Injected faults update the backend telemetry, logs, notifications, and sensor health. No hardware commands are sent.</p>
            <div className="settings-actions mt-3">
              <button className="outline-button" disabled={busyCommand !== null} onClick={() => void runFault('gnss')}>SIMULATE GNSS FAILURE</button>
              <button className="outline-button" disabled={busyCommand !== null} onClick={() => void runFault('battery')}>SIMULATE LOW BATTERY</button>
              <button className="outline-button" disabled={busyCommand !== null} onClick={() => void runFault('communication')}>SIMULATE COMMUNICATION LOSS</button>
              <button className="outline-button" disabled={busyCommand !== null} onClick={() => void runFault('clear')}>CLEAR SIMULATED FAULTS</button>
            </div>
            <div className="settings-actions mt-3">
              <button className="outline-button" disabled={!speechAvailable} onClick={enableVoice}>ENABLE VOICE ALERTS</button>
              <button className="outline-button" disabled={!speechAvailable || !voice.unlocked} onClick={testVoice}>TEST VOICE</button>
            </div>
            {!speechAvailable && <p className="settings-help text-amber-300">Browser speech synthesis is unavailable.</p>}
            {speechBlocked && <p className="settings-help text-amber-300">Voice playback was blocked or failed. Click Enable Voice Alerts again after allowing audio.</p>}
          </div>
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
