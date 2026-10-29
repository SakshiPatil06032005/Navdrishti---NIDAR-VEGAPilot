import { Gauge, LineChart as LineChartIcon, Radio } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useTelemetry, type Telemetry } from '../services/telemetry'

function unavailable(message = 'No validated telemetry available') {
  return <div className="empty-state"><Radio size={20} className="text-amber-400" /><p>{message}</p><span>Values are not substituted from simulation data</span></div>
}

export function MissionProgressPanel() {
  const { telemetry } = useTelemetry()
  const mission = telemetry?.mission_status
  if (!mission) return unavailable('Mission progress unavailable')
  const completion = Math.round((mission.completed_waypoints / mission.total_waypoints) * 100)
  return <div className="mission-progress-panel"><div className="progress-top"><span>{mission.name}</span><strong>{completion}%</strong></div><div className="progress-track"><div style={{ width: `${completion}%` }} /></div><div className="progress-meta"><span>{mission.completed_waypoints} / {mission.total_waypoints} waypoints completed</span><span className="mission-state active">{mission.state}</span></div><div className="waypoint-list"><div className="waypoint-row current"><span className="waypoint-name">Current waypoint</span><span className="waypoint-alt">{mission.current_waypoint}</span><span className="waypoint-status">FROM TELEMETRY</span></div></div></div>
}

function Chart({ dataKey, color, unit, history }: { dataKey: 'altitude' | 'voltage'; color: string; unit: string; history: Telemetry[] }) {
  const data = history.map((packet) => ({ time: new Date(packet.timestamp).toLocaleTimeString(), altitude: packet.barometer.relative_altitude_m, voltage: packet.battery.voltage_v }))
  return <div className="telemetry-chart-card"><div className="chart-card-heading"><span>{dataKey === 'altitude' ? 'ALTITUDE' : 'BATTERY VOLTAGE'}</span><b>{unit}</b></div><ResponsiveContainer width="100%" height={116}><LineChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}><CartesianGrid stroke="#17324c" strokeDasharray="3 3" /><XAxis dataKey="time" tick={{ fill: '#668397', fontSize: 8 }} tickLine={false} axisLine={false} /><YAxis tick={{ fill: '#668397', fontSize: 8 }} tickLine={false} axisLine={false} width={34} /><Tooltip contentStyle={{ background: '#071a2b', border: '1px solid #286079', fontSize: 10 }} formatter={(value) => [`${Number(value).toFixed(1)} ${unit}`, dataKey === 'altitude' ? 'Altitude' : 'Voltage']} /><Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
}

export function LiveTelemetryPanel() {
  const { telemetry, history, ageMs, stale } = useTelemetry()
  if (!telemetry) return unavailable('Live telemetry unavailable')
  const metrics = [
    ['ROLL', `${telemetry.imu_attitude.roll_deg >= 0 ? '+' : ''}${telemetry.imu_attitude.roll_deg.toFixed(1)}°`],
    ['PITCH', `${telemetry.imu_attitude.pitch_deg.toFixed(1)}°`],
    ['YAW', `${telemetry.imu_attitude.yaw_deg.toFixed(1)}°`],
    ['GROUND SPEED', `${telemetry.gnss_position.ground_speed_mps.toFixed(1)} m/s`],
    ['RELATIVE ALTITUDE', `${telemetry.barometer.relative_altitude_m.toFixed(1)} m`],
    ['VERTICAL SPEED', `${telemetry.barometer.vertical_speed_mps >= 0 ? '+' : ''}${telemetry.barometer.vertical_speed_mps.toFixed(1)} m/s`],
  ]
  return <div className="live-telemetry-panel"><div className="attitude-metrics">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="telemetry-charts"><Chart dataKey="altitude" color="#22d3ee" unit="m" history={history} /><Chart dataKey="voltage" color="#fbbf24" unit="V" history={history} /></div><div className="telemetry-source"><Radio size={12} /> {telemetry.data_source.toUpperCase()} · packet {ageMs === null ? '--' : `${(ageMs / 1000).toFixed(1)}s old`}{stale && ' · STALE'}</div></div>
}

export function FlightTimelinePanel() {
  const { telemetry, history } = useTelemetry()
  if (!telemetry) return unavailable('Flight timeline unavailable')
  return <div className="timeline mission-timeline">{history.slice(-5).reverse().map((packet) => <div className="timeline-row complete" key={packet.timestamp}><span className="timeline-time">{new Date(packet.timestamp).toLocaleTimeString()}</span><i className="timeline-dot green" /><span className="timeline-event">Telemetry packet · {packet.data_source.toUpperCase()}</span></div>)}<div className="timeline-footer"><Gauge size={12} /> Mission state: <b>{telemetry.mission_status.state}</b></div></div>
}

export function TelemetryChartIcon() {
  return <LineChartIcon size={15} className="text-cyan-300" />
}
