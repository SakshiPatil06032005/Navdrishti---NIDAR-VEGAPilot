import { Check, Circle, Crosshair, Gauge, LineChart as LineChartIcon, Zap } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { missionCompletion, mockMission, type TimelineEvent, type WaypointStatus } from '../services/mockMission'

const statusLabel: Record<WaypointStatus, string> = {
  completed: 'COMPLETED',
  current: 'CURRENT',
  pending: 'PENDING',
}

function WaypointIcon({ status }: { status: WaypointStatus }) {
  if (status === 'completed') return <Check size={12} />
  if (status === 'current') return <Crosshair size={12} />
  return <Circle size={9} />
}

export function MissionProgressPanel() {
  const completedCount = mockMission.waypoints.filter(({ status }) => status === 'completed').length

  return (
    <div className="mission-progress-panel">
      <div className="progress-top">
        <span>{mockMission.name}</span>
        <strong>{missionCompletion}%</strong>
      </div>
      <div className="progress-track"><div style={{ width: `${missionCompletion}%` }} /></div>
      <div className="progress-meta">
        <span>{completedCount} / {mockMission.waypoints.length} waypoints completed</span>
        <span className="mission-state active">{mockMission.state}</span>
      </div>
      <div className="waypoint-list">
        {mockMission.waypoints.map((waypoint) => (
          <div className={`waypoint-row ${waypoint.status}`} key={waypoint.id}>
            <span className="waypoint-marker"><WaypointIcon status={waypoint.status} /></span>
            <span className="waypoint-name">{waypoint.label}</span>
            <span className="waypoint-alt">{waypoint.altitude} m AGL</span>
            <span className="waypoint-status">{statusLabel[waypoint.status]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Chart({ dataKey, color, unit }: { dataKey: 'altitude' | 'voltage'; color: string; unit: string }) {
  return (
    <div className="telemetry-chart-card">
      <div className="chart-card-heading"><span>{dataKey === 'altitude' ? 'ALTITUDE' : 'BATTERY VOLTAGE'}</span><b>{unit}</b></div>
      <ResponsiveContainer width="100%" height={116}>
        <LineChart data={mockMission.chartData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid stroke="#17324c" strokeDasharray="3 3" />
          <XAxis dataKey="time" tick={{ fill: '#668397', fontSize: 8 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: '#668397', fontSize: 8 }} tickLine={false} axisLine={false} width={34} />
          <Tooltip
            contentStyle={{ background: '#071a2b', border: '1px solid #286079', fontSize: 10 }}
            labelStyle={{ color: '#9cb8c8' }}
            formatter={(value) => [`${Number(value).toFixed(1)} ${unit}`, dataKey === 'altitude' ? 'Altitude' : 'Voltage']}
          />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function LiveTelemetryPanel() {
  const { telemetry } = mockMission
  const metrics = [
    ['ROLL', `${telemetry.roll >= 0 ? '+' : ''}${telemetry.roll.toFixed(1)}°`],
    ['PITCH', `${telemetry.pitch >= 0 ? '+' : ''}${telemetry.pitch.toFixed(1)}°`],
    ['YAW', `${telemetry.yaw.toFixed(1)}°`],
    ['GROUND SPEED', `${telemetry.groundSpeed.toFixed(1)} m/s`],
    ['RELATIVE ALTITUDE', `${telemetry.relativeAltitude.toFixed(1)} m`],
    ['VERTICAL SPEED', `${telemetry.verticalSpeed >= 0 ? '+' : ''}${telemetry.verticalSpeed.toFixed(1)} m/s`],
  ]

  return (
    <div className="live-telemetry-panel">
      <div className="attitude-metrics">
        {metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      <div className="telemetry-charts">
        <Chart dataKey="altitude" color="#22d3ee" unit="m" />
        <Chart dataKey="voltage" color="#fbbf24" unit="V" />
      </div>
      <div className="telemetry-source"><Zap size={12} /> Shared simulated telemetry source · updated 1.1s ago</div>
    </div>
  )
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  return (
    <div className={`timeline-row ${event.status}`}>
      <span className="timeline-time">{event.time}</span>
      <i className={`timeline-dot ${event.status === 'complete' ? 'green' : event.status === 'current' ? 'cyan' : 'pending'}`} />
      <span className="timeline-event">{event.label}</span>
    </div>
  )
}

export function FlightTimelinePanel() {
  return (
    <div className="timeline mission-timeline">
      {mockMission.timeline.map((event) => <TimelineRow key={`${event.time}-${event.label}`} event={event} />)}
      <div className="timeline-footer"><Gauge size={12} /> Mission state: <b>{mockMission.state}</b></div>
    </div>
  )
}

export function TelemetryChartIcon() {
  return <LineChartIcon size={15} className="text-cyan-300" />
}
