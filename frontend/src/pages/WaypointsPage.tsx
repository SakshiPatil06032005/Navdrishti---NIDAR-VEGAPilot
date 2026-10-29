import { ArrowDown, ArrowUp, CheckCircle2, Eraser, MapPin, Play, Save, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Panel } from '../components/Panel'
import { WaypointPlannerMap } from '../components/WaypointPlannerMap'
import {
  createMission,
  fetchMissionLimits,
  fetchMissions,
  fetchRouteLength,
  saveMission,
  selectMission,
  uploadMissionToSimulator,
  type MissionDraft,
  type MissionWaypoint,
} from '../services/missions'

const SAMPLE_COORDINATES = [
  [18.5204, 73.8567, 100],
  [18.5222, 73.8602, 112],
  [18.5248, 73.8625, 118],
  [18.5264, 73.8668, 125],
  [18.5239, 73.8701, 120],
] as const

function commandId() {
  return `${Date.now()}-${crypto.randomUUID()}`
}

function emptyMission(name = 'New simulation mission'): MissionDraft {
  return {
    id: crypto.randomUUID(),
    name,
    revision: 1,
    state: 'READY',
    active_waypoint_index: 0,
    home_latitude_deg: null,
    home_longitude_deg: null,
    onboard_state: 'NOT_CONFIRMED',
    waypoints: SAMPLE_COORDINATES.map(([latitude, longitude, altitude], index) => ({
      id: `wp${index + 1}`,
      label: `WP 0${index + 1}`,
      latitude_deg: latitude,
      longitude_deg: longitude,
      altitude_m: altitude,
      status: index === 0 ? 'current' : 'pending',
    })),
  }
}

function sampleMission(): MissionDraft {
  return {
    ...emptyMission('SIMULATION DEMO · Five Waypoint Survey'),
    home_latitude_deg: 18.5204,
    home_longitude_deg: 73.8567,
  }
}

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
  const [busy, setBusy] = useState(false)

  const load = async (selectId?: string) => {
    const items = await fetchMissions()
    setMissions(items)
    const next = items.find((item) => item.id === selectId) ?? items[0] ?? null
    setMission(next)
    setSelectedIndex(0)
  }

  useEffect(() => {
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load saved missions'))
    void fetchMissionLimits().then((limits) => setMaxAltitude(limits.max_relative_altitude_m))
      .catch(() => setError('Unable to load the configured altitude limit'))
  }, [])

  const missionId = mission?.id
  const missionRevision = mission?.revision
  useEffect(() => {
    if (!missionId) {
      setRouteLength(null)
      return
    }
    void fetchRouteLength(missionId).then((result) => setRouteLength(result.distance_m))
      .catch(() => setRouteLength(null))
  }, [missionId, missionRevision])

  const invalidIndexes = useMemo(() => mission?.waypoints.map((waypoint, index) => {
    const valid = Number.isFinite(waypoint.latitude_deg) &&
      Number.isFinite(waypoint.longitude_deg) &&
      Number.isFinite(waypoint.altitude_m) &&
      waypoint.latitude_deg >= -90 && waypoint.latitude_deg <= 90 &&
      waypoint.longitude_deg >= -180 && waypoint.longitude_deg <= 180 &&
      waypoint.altitude_m >= 0 && waypoint.altitude_m <= maxAltitude
    return valid ? -1 : index
  }).filter((index) => index >= 0) ?? [], [maxAltitude, mission])

  const updateWaypoint = (index: number, patch: Partial<MissionWaypoint>) => {
    if (!mission) return
    setMission({
      ...mission,
      waypoints: mission.waypoints.map((waypoint, waypointIndex) =>
        waypointIndex === index ? { ...waypoint, ...patch } : waypoint),
    })
    setMessage(null)
  }

  const clearWaypoint = (index: number) => updateWaypoint(index, {
    latitude_deg: 0,
    longitude_deg: 0,
    altitude_m: 0,
    status: index === 0 ? 'current' : 'pending',
  })

  const reorder = (direction: -1 | 1) => {
    if (!mission) return
    const target = selectedIndex + direction
    if (target < 0 || target >= mission.waypoints.length) return
    const waypoints = [...mission.waypoints]
    ;[waypoints[selectedIndex], waypoints[target]] = [waypoints[target], waypoints[selectedIndex]]
    setMission({ ...mission, waypoints })
    setSelectedIndex(target)
  }

  const createNewMission = async (next = emptyMission(), success = 'New mission created. Enter five waypoint coordinates, then save it.') => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const created = await createMission(next)
      await selectMission(created.id)
      await load(created.id)
      setMessage(success)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to create mission')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!mission) return
    setBusy(true)
    setError(null)
    setMessage(null)
    if (!mission.name.trim()) {
      setError('Enter a mission name before saving.')
      setBusy(false)
      return
    }
    if (invalidIndexes.length) {
      setError(`Correct waypoint ${invalidIndexes.map((index) => index + 1).join(', ')} before saving.`)
      setBusy(false)
      return
    }
    try {
      const saved = await saveMission({ ...mission, name: mission.name.trim() })
      await selectMission(saved.id)
      await load(saved.id)
      setMessage('Mission saved to SQLite.')
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to save mission')
    } finally {
      setBusy(false)
    }
  }

  const upload = async () => {
    if (!mission) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      if (invalidIndexes.length) throw new Error('Correct all waypoint coordinates and altitudes before uploading.')
      const saved = await saveMission(mission)
      await selectMission(saved.id)
      const result = await uploadMissionToSimulator(saved.id, commandId())
      if (result.status !== 'COMPLETED') throw new Error(`Simulator upload was not acknowledged: ${result.status}`)
      await load(saved.id)
      setMessage('Mission uploaded and acknowledged by the simulation provider.')
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Mission upload failed')
    } finally {
      setBusy(false)
    }
  }

  const select = async (id: string) => {
    if (!id) return
    setError(null)
    try {
      const selected = await selectMission(id)
      setMission(selected)
      setSelectedIndex(0)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to select mission')
    }
  }

  const selected = mission?.waypoints[selectedIndex]
  const updateSelectedFromMap = (latitude: number, longitude: number) =>
    updateWaypoint(selectedIndex, { latitude_deg: Number(latitude.toFixed(6)), longitude_deg: Number(longitude.toFixed(6)) })

  return <div className="waypoints-page">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><p className="eyebrow text-cyan-300">Ground control station / mission planning</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Waypoints Planner</h1></div>
      <div className="source-badge simulation"><MapPin size={12} /> SIMULATION MISSION PLANNER</div>
    </div>
    {error && <div className="settings-alert error">{error}</div>}
    {message && <div className="settings-alert success"><CheckCircle2 size={16} />{message}</div>}

    <div className="mission-toolbar">
      <button className="primary-button" disabled={busy} onClick={() => void createNewMission()}><Save size={13} /> CREATE NEW MISSION</button>
      <button className="outline-button" disabled={busy} onClick={() => void createNewMission(sampleMission(), 'Sample simulation mission loaded. Edit it if needed, then save or upload it.')}><MapPin size={13} /> LOAD SAMPLE MISSION</button>
      <select aria-label="Saved missions" value={mission?.id ?? ''} onChange={(event) => void select(event.target.value)}>
        <option value="">Select saved mission</option>
        {missions.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.state}</option>)}
      </select>
      {mission && <><button className="outline-button" disabled={busy || mission.state !== 'READY'} onClick={() => void save()}><Save size={13} /> SAVE MISSION</button><button className="outline-button" disabled={busy || mission.state !== 'READY'} onClick={() => void upload()}><Upload size={13} /> UPLOAD TO SIMULATOR</button></>}
    </div>

    {mission ? <div className="waypoint-planner-grid">
      <Panel title="Mission Details" icon={Save}>
        <div className="settings-card">
          <label className="settings-field"><span>Mission name</span><input value={mission.name} disabled={mission.state !== 'READY'} onChange={(event) => setMission({ ...mission, name: event.target.value })} /></label>
          <div className="settings-info-grid"><span>State</span><b>{mission.state}</b><span>Waypoints</span><b>{mission.waypoints.length} / 5</b><span>Route estimate</span><b>{formatDistance(routeLength)}</b></div>
        </div>
      </Panel>
      <Panel title="Home Position" icon={MapPin}>
        <div className="settings-card">
          <p className="settings-help">Home is the simulator return position. Enter decimal degrees, for example latitude 18.5204 and longitude 73.8567.</p>
          <label className="settings-field"><span>Home latitude</span><input type="number" min="-90" max="90" step="0.000001" value={mission.home_latitude_deg ?? ''} placeholder="Required for RTH" onChange={(event) => setMission({ ...mission, home_latitude_deg: event.target.value === '' ? null : Number(event.target.value) })} /></label>
          <label className="settings-field"><span>Home longitude</span><input type="number" min="-180" max="180" step="0.000001" value={mission.home_longitude_deg ?? ''} placeholder="Required for RTH" onChange={(event) => setMission({ ...mission, home_longitude_deg: event.target.value === '' ? null : Number(event.target.value) })} /></label>
          <button className="outline-button" onClick={() => setMission({ ...mission, home_latitude_deg: null, home_longitude_deg: null })}><X size={13} /> CLEAR HOME</button>
        </div>
      </Panel>
      <Panel title="Route Map" icon={MapPin} className="settings-wide"><WaypointPlannerMap mission={mission} onMapClick={updateSelectedFromMap} /></Panel>
      <Panel title="Five Waypoints" icon={MapPin} className="settings-wide">
        <p className="settings-help mb-3">Select a row, then click the map to fill its latitude and longitude. Exactly five rows are required for this demonstration.</p>
        <div className="waypoint-editor">{mission.waypoints.map((waypoint, index) => <article className={`waypoint-editor-row ${selectedIndex === index ? 'selected' : ''}`} key={waypoint.id} onClick={() => setSelectedIndex(index)}>
          <div className="waypoint-number">{index + 1}</div>
          <div className="waypoint-inputs">
            <label>Label<input value={waypoint.label} onChange={(event) => updateWaypoint(index, { label: event.target.value })} /></label>
            <label>Latitude<input type="number" min="-90" max="90" step="0.000001" value={waypoint.latitude_deg} onChange={(event) => updateWaypoint(index, { latitude_deg: Number(event.target.value) })} /></label>
            <label>Longitude<input type="number" min="-180" max="180" step="0.000001" value={waypoint.longitude_deg} onChange={(event) => updateWaypoint(index, { longitude_deg: Number(event.target.value) })} /></label>
            <label>Relative altitude (m)<input type="number" min="0" max={maxAltitude} step="0.1" value={waypoint.altitude_m} onChange={(event) => updateWaypoint(index, { altitude_m: Number(event.target.value) })} /></label>
          </div>
          <div className="waypoint-actions">
            <button title="Move up" disabled={index === 0} onClick={(event) => { event.stopPropagation(); setSelectedIndex(index); reorder(-1) }}><ArrowUp size={13} /></button>
            <button title="Move down" disabled={index === 4} onClick={(event) => { event.stopPropagation(); setSelectedIndex(index); reorder(1) }}><ArrowDown size={13} /></button>
            <button title="Clear waypoint" onClick={(event) => { event.stopPropagation(); clearWaypoint(index) }}><Eraser size={13} /></button>
          </div>
        </article>)}</div>
        <p className="settings-help mt-3">{selected ? `${selected.label} is selected. Map clicks will update it.` : 'Select a waypoint row.'} Altitude limit: {maxAltitude} m.</p>
      </Panel>
      <Panel title="How to use mission planning" icon={Play} className="settings-wide">
        <div className="settings-card"><p className="settings-help">A waypoint is a geographic point the simulated aircraft visits. Enter decimal-degree latitude and longitude, and a relative altitude in metres. Use <b>Create New Mission</b> or <b>Load Sample Mission</b>, edit the five rows or select a row and click the map, then choose <b>Save Mission</b>. After saving, choose <b>Upload to Simulator</b> and wait for the acknowledgement. Start the simulation from the Mission page using <b>Start Mission</b>; the dashboard then shows the selected mission.</p></div>
      </Panel>
    </div> : <div className="empty-state"><p>No mission selected</p><span>Create a new mission or load the sample mission to begin.</span></div>}
  </div>
}
