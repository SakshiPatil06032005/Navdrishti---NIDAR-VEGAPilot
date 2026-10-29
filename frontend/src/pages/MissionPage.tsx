import { AlertTriangle, CheckCircle2, Circle, Play, Save, ShieldAlert, Square, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Panel } from '../components/Panel'
import { commandMission, createMission, deleteMission, fetchFailsafeStatus, fetchMissionCommands, fetchMissionEvents, fetchMissions, saveMission, selectMission, type FailsafeStatus, type MissionCommandResult, type MissionDraft, type MissionEvent } from '../services/missions'
import { useTelemetry } from '../services/telemetry'

function commandId() { return `${Date.now()}-${crypto.randomUUID()}` }

export function MissionPage() {
  const [missions, setMissions] = useState<MissionDraft[]>([])
  const [mission, setMission] = useState<MissionDraft | null>(null)
  const [events, setEvents] = useState<MissionEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmAbort, setConfirmAbort] = useState(false)
  const [commands, setCommands] = useState<MissionCommandResult[]>([])
  const [failsafe, setFailsafe] = useState<FailsafeStatus | null>(null)
  const { telemetry } = useTelemetry()

  const load = () => fetchMissions().then((items) => { setMissions(items); setMission(items[0] ?? null) }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load missions'))
  useEffect(() => { load() }, [])
  const missionId = mission?.id
  useEffect(() => {
    if (!missionId) return
    fetchMissionEvents(missionId).then(setEvents).catch(() => setEvents([]))
    fetchMissionCommands(missionId).then(setCommands).catch(() => setCommands([]))
  }, [missionId])
  useEffect(() => {
    const refresh = () => fetchFailsafeStatus().then(setFailsafe).catch(() => setFailsafe(null))
    refresh()
    const timer = window.setInterval(refresh, 3000)
    return () => window.clearInterval(timer)
  }, [])

  const progress = useMemo(() => mission ? Math.round((mission.waypoints.filter((waypoint) => waypoint.status === 'completed').length / mission.waypoints.length) * 100) : 0, [mission])
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(null); setMessage(null)
    try { await operation(); setMessage(success); await load() } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : 'Mission operation failed') } finally { setBusy(false) }
  }
  const execute = (command: string) => mission && run(async () => {
    const result = await commandMission(mission.id, command, commandId())
    setCommands((previous) => [...previous, result])
    setMessage(result.status === 'COMPLETED' ? `${command.toUpperCase()} completed by simulation.` : `${command.toUpperCase()} ${result.status.toLowerCase()}; onboard confirmation is required.`)
  }, '')
  const create = () => {
    const draft: MissionDraft = { id: crypto.randomUUID(), name: 'New mission', revision: 1, state: 'READY', active_waypoint_index: 0, home_latitude_deg: null, home_longitude_deg: null, onboard_state: 'NOT_CONFIRMED', waypoints: [1, 2, 3, 4, 5].map((id) => ({ id: `wp${id}`, label: `WP 0${id}`, latitude_deg: 18.52 + id * 0.001, longitude_deg: 73.85 + id * 0.001, altitude_m: 100, status: id === 1 ? 'current' : 'pending' })) }
    run(() => createMission(draft), 'Mission draft created.')
  }

  return <div className="mission-page">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow text-cyan-300">Ground control station / mission control</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Mission Management</h1></div><div className="source-badge simulation">EXECUTION · {telemetry?.data_source.toUpperCase() ?? 'NO TELEMETRY'}</div></div>
    {error && <div className="settings-alert error"><AlertTriangle size={16} />{error}</div>}{message && <div className="settings-alert success"><CheckCircle2 size={16} />{message}</div>}
    <div className="mission-toolbar"><select value={mission?.id ?? ''} onChange={(event) => run(() => selectMission(event.target.value), 'Mission selected.')}><option value="">Select mission</option>{missions.map((item) => <option value={item.id} key={item.id}>{item.name} · rev {item.revision}</option>)}</select><button className="outline-button" onClick={create}><Save size={13} /> NEW DRAFT</button><button className="danger-button" disabled={!mission || busy} onClick={() => mission && run(() => deleteMission(mission.id), 'Mission deleted.') }><Trash2 size={13} /> DELETE</button></div>
    {mission ? <div className="settings-grid">
      <Panel title="Mission Draft" icon={Save}><div className="settings-card"><label className="settings-field"><span>Name</span><input value={mission.name} disabled={mission.state === 'EXECUTING' || mission.state === 'UPLOADED'} onChange={(event) => setMission({ ...mission, name: event.target.value })} /></label><div className="settings-info-grid"><span>Revision</span><b>{mission.revision}</b><span>Waypoints</span><b>{mission.waypoints.length}</b><span>State</span><b>{mission.state}</b></div><button className="outline-button mt-4" disabled={busy || mission.state === 'EXECUTING' || mission.state === 'UPLOADED'} onClick={() => run(() => saveMission(mission), 'Mission draft saved.')}><Save size={13} /> SAVE DRAFT</button></div></Panel>
      <Panel title="Mission Controls" icon={Play}><div className="settings-card"><p className="settings-help">Commands use unique IDs and backend validation. Hardware commands remain non-successful until ARIES V3 reports onboard confirmation.</p><div className="settings-actions"><button className="outline-button" disabled={busy || mission.state !== 'READY'} onClick={() => execute('upload')}><Upload size={13} /> UPLOAD MISSION</button><button className="outline-button" disabled={busy || mission.state !== 'UPLOADED'} onClick={() => execute('start')}><Play size={13} /> START MISSION</button><button className="danger-button" disabled={busy || mission.state !== 'EXECUTING'} onClick={() => setConfirmAbort(true)}><Square size={13} /> ABORT MISSION</button></div><p className="settings-help mt-4"><CheckCircle2 size={13} /> Browser commands never cut motor power or bypass onboard failsafe logic.</p></div></Panel>
      <Panel title="Failsafe Monitoring" icon={ShieldAlert} className="settings-wide"><div className="settings-info-grid"><span>Preflight readiness</span><b className={failsafe?.preflight_ready ? 'text-emerald-400' : 'text-amber-400'}>{failsafe ? (failsafe.preflight_ready ? 'READY' : 'INSPECTION REQUIRED') : 'N/A'}</b><span>Policy action</span><b>{failsafe?.policy.action ?? 'N/A'}</b><span>Validation</span><b>{failsafe?.policy.validation_status ?? 'N/A'}</b></div><div className="log-lines mt-3">{failsafe?.checks.map((check) => <p key={check.name}><span>{check.name}</span> <b className={check.status === 'OK' ? 'text-emerald-400' : 'text-amber-400'}>{check.status}</b> {check.message}</p>)}</div></Panel>
      <Panel title="Progress Timeline" icon={Play}><div className="timeline mission-timeline">{mission.waypoints.map((waypoint, index) => <div className="timeline-row" key={waypoint.id}><span className="timeline-time">WP {String(index + 1).padStart(2, '0')}</span><i className={`timeline-dot ${waypoint.status === 'completed' ? 'green' : waypoint.status === 'current' ? 'cyan' : 'pending'}`}>{waypoint.status === 'completed' ? <CheckCircle2 size={10} /> : <Circle size={10} />}</i><span className="timeline-event">{waypoint.label} · {waypoint.altitude_m}m · {waypoint.status.toUpperCase()}</span></div>)}</div><div className="progress-track mission-progress-track"><div style={{ width: `${progress}%` }} /></div><div className="progress-meta"><span>{progress}% complete</span><b>{mission.waypoints[mission.active_waypoint_index]?.label ?? '--'} active</b></div></Panel>
      <Panel title="Mission Events" icon={AlertTriangle} className="settings-wide"><div className="log-lines">{events.slice().reverse().map((event) => <p key={event.id}><span>{new Date(event.timestamp).toLocaleTimeString()}</span> <b className={event.level === 'WARNING' ? 'text-amber-400' : 'text-emerald-400'}>{event.code}</b> {event.message}</p>)}{!events.length && <p><span>--</span> No mission events recorded</p>}</div></Panel>
      <Panel title="Command History" icon={ShieldAlert} className="settings-wide"><div className="log-lines">{commands.slice().reverse().map((item) => <p key={item.command_id}><span>{new Date(item.updated_at ?? '').toLocaleTimeString()}</span> <b className={item.status === 'COMPLETED' ? 'text-emerald-400' : item.status === 'REJECTED' || item.status === 'TIMEOUT' ? 'text-red-400' : 'text-amber-400'}>{item.status}</b> {item.command.toUpperCase()} · {item.command_id} · {item.message}</p>)}{!commands.length && <p><span>--</span> No commands recorded</p>}</div></Panel>
    </div> : <div className="empty-state"><p>No mission draft selected</p><span>Create or select a mission to manage it.</span></div>}
    {confirmAbort && mission && <div className="modal-backdrop" role="presentation"><div className="settings-card abort-dialog" role="dialog" aria-modal="true" aria-labelledby="abort-title"><button className="modal-close" onClick={() => setConfirmAbort(false)} aria-label="Close abort confirmation"><X size={16} /></button><ShieldAlert size={28} className="text-red-400" /><h2 id="abort-title">Confirm mission abort</h2><p>This sends a backend abort command for <b>{mission.name}</b>. In simulation, progression stops after the backend confirms. In hardware mode, this is not successful until ARIES V3 acknowledges completion; the browser will not cut motor power.</p><div className="settings-actions"><button className="outline-button" onClick={() => setConfirmAbort(false)}>CANCEL</button><button className="danger-button" disabled={busy} onClick={() => { setConfirmAbort(false); execute('abort') }}><Square size={13} /> CONFIRM ABORT</button></div></div></div>}
  </div>
}
