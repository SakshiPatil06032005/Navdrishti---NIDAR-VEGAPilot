import { ArrowDown, ArrowUp, CheckCircle2, Eraser, MapPin, Save, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Panel } from '../components/Panel'
import { WaypointPlannerMap } from '../components/WaypointPlannerMap'
import { fetchMissionLimits, fetchMissions, fetchRouteLength, saveMission, selectMission, type MissionDraft } from '../services/missions'

function formatDistance(meters: number | null) {
  return meters === null ? '--' : meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(0)} m`
}

export function WaypointsPage() {
  const [missions, setMissions] = useState<MissionDraft[]>([])
  const [mission, setMission] = useState<MissionDraft | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [maxAltitude, setMaxAltitude] = useState(20_000)
  const [routeLength, setRouteLength] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = () => fetchMissions().then((items) => { setMissions(items); setMission(items[0] ?? null) }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load missions'))
  useEffect(() => { load(); fetchMissionLimits().then((limits) => setMaxAltitude(limits.max_relative_altitude_m)).catch(() => undefined) }, [])
  const missionId = mission?.id
  const missionRevision = mission?.revision
  useEffect(() => { if (missionId) fetchRouteLength(missionId).then((result) => setRouteLength(result.distance_m)).catch(() => setRouteLength(null)) }, [missionId, missionRevision])

  const selected = mission?.waypoints[selectedIndex]
  const invalidIndexes = useMemo(() => mission?.waypoints.map((waypoint, index) => waypoint.latitude_deg < -90 || waypoint.latitude_deg > 90 || waypoint.longitude_deg < -180 || waypoint.longitude_deg > 180 || waypoint.altitude_m < 0 || waypoint.altitude_m > maxAltitude ? index : -1).filter((index) => index >= 0) ?? [], [maxAltitude, mission])
  const updateWaypoint = (index: number, patch: Partial<NonNullable<typeof selected>>) => {
    if (!mission) return
    const waypoints = mission.waypoints.map((waypoint, waypointIndex) => waypointIndex === index ? { ...waypoint, ...patch } : waypoint)
    setMission({ ...mission, waypoints })
    setMessage(null)
  }
  const reorder = (direction: -1 | 1) => {
    if (!mission) return
    const target = selectedIndex + direction
    if (target < 0 || target >= mission.waypoints.length) return
    const waypoints = [...mission.waypoints]
    ;[waypoints[selectedIndex], waypoints[target]] = [waypoints[target], waypoints[selectedIndex]]
    setMission({ ...mission, waypoints })
    setSelectedIndex(target)
  }
  const clear = (index: number) => updateWaypoint(index, { latitude_deg: 0, longitude_deg: 0, altitude_m: 0, status: index === 0 ? 'current' : 'pending' })
  const save = async () => {
    if (!mission) return
    setError(null); setMessage(null)
    if (invalidIndexes.length) { setError(`Correct waypoint ${invalidIndexes.map((index) => index + 1).join(', ')} before saving.`); return }
    try { const saved = await saveMission(mission); setMission(saved); setMessage('Draft saved to SQLite.'); const result = await fetchRouteLength(saved.id); setRouteLength(result.distance_m) } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : 'Unable to save draft') }
  }
  const updateSelectedFromMap = (latitude: number, longitude: number) => updateWaypoint(selectedIndex, { latitude_deg: Number(latitude.toFixed(6)), longitude_deg: Number(longitude.toFixed(6)) })
  const select = (id: string) => selectMission(id).then(setMission).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to select mission'))

  return <div className="waypoints-page">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow text-cyan-300">Ground control station / mission planning</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Waypoints Planner</h1></div><div className="source-badge simulation"><MapPin size={12} /> FIVE-WAYPOINT PROTOTYPE</div></div>
    {error && <div className="settings-alert error">{error}</div>}{message && <div className="settings-alert success"><CheckCircle2 size={16} />{message}</div>}
    <div className="mission-toolbar"><select value={mission?.id ?? ''} onChange={(event) => select(event.target.value)}><option value="">Select saved draft</option>{missions.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.state}</option>)}</select>{mission && <button className="outline-button" disabled={mission.state !== 'READY'} onClick={save}><Save size={13} /> SAVE DRAFT</button>}</div>
    {mission ? <div className="waypoint-planner-grid">
      <Panel title="Route Map" icon={MapPin}><WaypointPlannerMap mission={mission} onMapClick={updateSelectedFromMap} /></Panel>
      <Panel title="Mission State" icon={Upload}><div className="settings-card"><div className="settings-info-grid"><span>Draft</span><b>{mission.state === 'READY' ? 'SAVED DRAFT' : 'LOCKED'}</b><span>Uploaded</span><b>{mission.state === 'UPLOAD_PENDING' ? 'AWAITING ACK' : ['UPLOADED', 'CONFIRMED_ONBOARD', 'EXECUTING'].includes(mission.state) ? 'UPLOADED' : 'NOT UPLOADED'}</b><span>Onboard</span><b>{mission.onboard_state}</b><span>Route estimate</span><b>{formatDistance(routeLength)}</b></div><p className="settings-help mt-4">Home is not assumed. {mission.home_latitude_deg === null ? 'No home position is configured.' : 'Configured home is shown separately on the map.'} Upload is available from the Mission Management page after draft validation.</p></div></Panel>
      <Panel title="Waypoint Coordinates" icon={MapPin} className="settings-wide"><div className="waypoint-editor">{mission.waypoints.map((waypoint, index) => <article className={`waypoint-editor-row ${selectedIndex === index ? 'selected' : ''}`} key={waypoint.id} onClick={() => setSelectedIndex(index)}><div className="waypoint-number">{index + 1}</div><div className="waypoint-inputs"><label>Label<input value={waypoint.label} onChange={(event) => updateWaypoint(index, { label: event.target.value })} /></label><label>Latitude<input type="number" min="-90" max="90" step="0.000001" value={waypoint.latitude_deg} onChange={(event) => updateWaypoint(index, { latitude_deg: Number(event.target.value) })} /></label><label>Longitude<input type="number" min="-180" max="180" step="0.000001" value={waypoint.longitude_deg} onChange={(event) => updateWaypoint(index, { longitude_deg: Number(event.target.value) })} /></label><label>Relative altitude (m)<input type="number" min="0" max={maxAltitude} step="0.1" value={waypoint.altitude_m} onChange={(event) => updateWaypoint(index, { altitude_m: Number(event.target.value) })} /></label></div><div className="waypoint-actions"><button title="Move up" disabled={index === 0} onClick={(event) => { event.stopPropagation(); setSelectedIndex(index); reorder(-1) }}><ArrowUp size={13} /></button><button title="Move down" disabled={index === 4} onClick={(event) => { event.stopPropagation(); setSelectedIndex(index); reorder(1) }}><ArrowDown size={13} /></button><button title="Clear waypoint" onClick={(event) => { event.stopPropagation(); clear(index) }}><Eraser size={13} /></button></div></article>)}</div><p className="settings-help">Click the map to set the selected waypoint. Exactly five waypoints are required. Altitude limit: {maxAltitude} m.</p></Panel>
      <Panel title="Home Position" icon={MapPin}><div className="settings-card"><p className="settings-help">Home is distinct from mission waypoints and is never inferred from dummy coordinates.</p><div className="settings-field"><span>Latitude</span><input type="number" min="-90" max="90" value={mission.home_latitude_deg ?? ''} placeholder="Not configured" onChange={(event) => setMission({ ...mission, home_latitude_deg: event.target.value === '' ? null : Number(event.target.value) })} /></div><div className="settings-field"><span>Longitude</span><input type="number" min="-180" max="180" value={mission.home_longitude_deg ?? ''} placeholder="Not configured" onChange={(event) => setMission({ ...mission, home_longitude_deg: event.target.value === '' ? null : Number(event.target.value) })} /></div><button className="outline-button" onClick={() => setMission({ ...mission, home_latitude_deg: null, home_longitude_deg: null })}><X size={13} /> CLEAR HOME</button></div></Panel>
      <Panel title="Selected Waypoint" icon={MapPin}><div className="settings-card"><p className="settings-help">{selected ? `${selected.label} is selected. Map clicks update this waypoint.` : 'Select a waypoint.'}</p><p className="text-xs text-slate-400">Route length is an estimate between consecutive waypoint coordinates; it excludes home.</p></div></Panel>
    </div> : <div className="empty-state"><p>No saved mission draft</p><span>Create a mission draft from Mission Management first.</span></div>}
  </div>
}
