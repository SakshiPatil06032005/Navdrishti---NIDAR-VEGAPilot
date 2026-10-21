import {
  Activity,
  Battery,
  Compass,
  Gauge,
  LocateFixed,
  MapPin,
  Navigation,
  Radio,
  Thermometer,
} from 'lucide-react'
import type { ComponentType } from 'react'

type SensorIcon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

export type SensorStatus = 'VALID' | 'DEGRADED' | 'FAILED' | 'NO DATA'

type SensorReading = {
  name: string
  icon: SensorIcon
  status: SensorStatus
  lastUpdate: string
  stale: boolean
  detail: string
  values: { label: string; value: string }[]
}

const sensorReadings: SensorReading[] = [
  {
    name: 'IMU · ACCELEROMETER',
    icon: Activity,
    status: 'VALID',
    lastUpdate: '0.8s ago',
    stale: false,
    detail: '6-axis inertial measurement',
    values: [
      { label: 'ROLL', value: '+1.8°' },
      { label: 'PITCH', value: '-0.6°' },
      { label: 'YAW', value: '084.2°' },
    ],
  },
  {
    name: 'IMU · GYROSCOPE',
    icon: Compass,
    status: 'VALID',
    lastUpdate: '0.8s ago',
    stale: false,
    detail: 'Angular velocity nominal',
    values: [
      { label: 'ROLL RATE', value: '0.02°/s' },
      { label: 'PITCH RATE', value: '0.01°/s' },
      { label: 'YAW RATE', value: '0.08°/s' },
    ],
  },
  {
    name: 'GNSS RECEIVER',
    icon: LocateFixed,
    status: 'VALID',
    lastUpdate: '1.1s ago',
    stale: false,
    detail: 'RTK FIX · 14 satellites',
    values: [
      { label: 'FIX', value: 'VALID' },
      { label: 'SPEED', value: '12.8 m/s' },
      { label: 'HDOP', value: '0.7' },
    ],
  },
  {
    name: 'BAROMETER',
    icon: Gauge,
    status: 'DEGRADED',
    lastUpdate: '18.4s ago',
    stale: true,
    detail: 'Reduced update freshness',
    values: [
      { label: 'PRESSURE', value: '998.4 hPa' },
      { label: 'REL. ALT', value: '124.6 m' },
    ],
  },
  {
    name: 'BATTERY MONITOR',
    icon: Battery,
    status: 'VALID',
    lastUpdate: '2.0s ago',
    stale: false,
    detail: 'Pack telemetry nominal',
    values: [
      { label: 'VOLTAGE', value: '24.8 V' },
      { label: 'LEVEL', value: '78%' },
    ],
  },
]

const statusColors: Record<SensorStatus, string> = {
  VALID: 'valid',
  DEGRADED: 'degraded',
  FAILED: 'failed',
  'NO DATA': 'no-data',
}

export function SensorStatusBadge({ status }: { status: SensorStatus }) {
  return (
    <span className={`sensor-status ${statusColors[status]}`}>
      <span className="status-dot" />
      {status}
    </span>
  )
}

function SensorRow({ reading }: { reading: SensorReading }) {
  const Icon = reading.icon

  return (
    <article className={`sensor-row ${reading.stale ? 'stale' : ''}`}>
      <div className={`sensor-icon ${statusColors[reading.status]}`}>
        <Icon size={15} />
      </div>
      <div className="sensor-main">
        <div className="sensor-row-heading">
          <div>
            <h3>{reading.name}</h3>
            <p>{reading.detail}</p>
          </div>
          <SensorStatusBadge status={reading.status} />
        </div>
        <div className="sensor-values">
          {reading.values.map(({ label, value }) => (
            <span key={label}><small>{label}</small><b>{value}</b></span>
          ))}
        </div>
        <div className={`sensor-freshness ${reading.stale ? 'stale' : ''}`}>
          <span className="freshness-pulse" />
          LAST UPDATE <b>{reading.lastUpdate}</b>
          {reading.stale && <em>STALE DATA</em>}
        </div>
      </div>
    </article>
  )
}

export function SensorHealthPanel() {
  return (
    <div className="sensor-health-panel">
      <div className="sensor-legend">
        {(['VALID', 'DEGRADED', 'FAILED', 'NO DATA'] as SensorStatus[]).map((status) => (
          <SensorStatusBadge key={status} status={status} />
        ))}
      </div>
      <div className="sensor-list">
        {sensorReadings.map((reading) => <SensorRow key={reading.name} reading={reading} />)}
      </div>
      <div className="sensor-simulated-note"><Radio size={12} /> Static simulated telemetry · no hardware connection</div>
    </div>
  )
}

type PositionMetric = {
  label: string
  value: string
  unit?: string
  icon: SensorIcon
  tone?: 'cyan' | 'green' | 'amber'
}

const positionMetrics: PositionMetric[] = [
  { label: 'Latitude', value: '18.52390', unit: '° N', icon: MapPin },
  { label: 'Longitude', value: '73.86410', unit: '° E', icon: MapPin },
  { label: 'Ground speed', value: '12.8', unit: 'm/s', icon: Navigation },
  { label: 'Heading', value: '084.2', unit: '° MAG', icon: Compass },
  { label: 'Altitude AGL', value: '124.6', unit: 'm', icon: Gauge },
  { label: 'Barometric pressure', value: '998.4', unit: 'hPa', icon: Thermometer, tone: 'amber' },
  { label: 'Battery voltage', value: '24.8', unit: 'V', icon: Battery, tone: 'green' },
  { label: 'Battery level', value: '78', unit: '%', icon: Battery, tone: 'green' },
]

function PositionMetric({ metric }: { metric: PositionMetric }) {
  const Icon = metric.icon
  return (
    <div className="position-metric">
      <div className={`position-metric-icon ${metric.tone ?? 'cyan'}`}><Icon size={13} /></div>
      <div>
        <span>{metric.label}</span>
        <strong>{metric.value}<small>{metric.unit}</small></strong>
      </div>
    </div>
  )
}

export function PositionAltitudePanel() {
  return (
    <div className="position-panel">
      <div className="position-fix-banner">
        <div className="fix-icon"><LocateFixed size={15} /></div>
        <div><span>GNSS FIX VALID</span><small>RTK FIX · 14 satellites · HDOP 0.7</small></div>
        <span className="position-freshness"><span className="status-dot" /> 1.1s</span>
      </div>
      <div className="position-metrics">
        {positionMetrics.map((metric) => <PositionMetric key={metric.label} metric={metric} />)}
      </div>
      <div className="position-footer">
        <span><Activity size={12} /> IMU attitude</span>
        <span>ROLL <b>+1.8°</b></span>
        <span>PITCH <b>-0.6°</b></span>
        <span>YAW <b>084.2°</b></span>
      </div>
    </div>
  )
}
