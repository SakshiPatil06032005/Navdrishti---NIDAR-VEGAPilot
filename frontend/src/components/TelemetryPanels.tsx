import { Activity, Battery, Compass, Gauge, LocateFixed, MapPin, Navigation, Radio, Thermometer } from 'lucide-react'
import type { ComponentType } from 'react'
import { useTelemetry, type SensorStatus } from '../services/telemetry'

type SensorIcon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

const statusColors: Record<SensorStatus, string> = {
  VALID: 'valid',
  DEGRADED: 'degraded',
  FAILED: 'failed',
  'NO DATA': 'no-data',
}

export function SensorStatusBadge({ status }: { status: SensorStatus }) {
  return <span className={`sensor-status ${statusColors[status]}`}><span className="status-dot" />{status}</span>
}

function ageLabel(ageMs: number | null) {
  return ageMs === null ? '--' : `${(ageMs / 1000).toFixed(1)}s ago`
}

export function SensorHealthPanel() {
  const { telemetry, ageMs, stale } = useTelemetry()
  const statuses: { name: string; icon: SensorIcon; status: SensorStatus; detail: string; values: { label: string; value: string }[] }[] = [
    { name: 'IMU · ATTITUDE', icon: Activity, status: telemetry?.sensor_health.imu ?? 'NO DATA', detail: 'Roll, pitch and yaw', values: [
      { label: 'ROLL', value: telemetry ? `${telemetry.imu_attitude.roll_deg >= 0 ? '+' : ''}${telemetry.imu_attitude.roll_deg.toFixed(1)}°` : '--' },
      { label: 'PITCH', value: telemetry ? `${telemetry.imu_attitude.pitch_deg.toFixed(1)}°` : '--' },
      { label: 'YAW', value: telemetry ? `${telemetry.imu_attitude.yaw_deg.toFixed(1)}°` : '--' },
    ] },
    { name: 'IMU · GYROSCOPE', icon: Compass, status: telemetry?.sensor_health.imu ?? 'NO DATA', detail: 'Angular velocity', values: [
      { label: 'ROLL RATE', value: telemetry ? `${telemetry.imu_attitude.roll_rate_dps.toFixed(2)}°/s` : '--' },
      { label: 'PITCH RATE', value: telemetry ? `${telemetry.imu_attitude.pitch_rate_dps.toFixed(2)}°/s` : '--' },
      { label: 'YAW RATE', value: telemetry ? `${telemetry.imu_attitude.yaw_rate_dps.toFixed(2)}°/s` : '--' },
    ] },
    { name: 'GNSS RECEIVER', icon: LocateFixed, status: telemetry?.sensor_health.gnss ?? 'NO DATA', detail: telemetry ? `${telemetry.gnss_position.fix} · ${telemetry.gnss_position.satellites} satellites` : 'No packet received', values: [
      { label: 'FIX', value: telemetry?.gnss_position.fix ?? '--' },
      { label: 'SPEED', value: telemetry ? `${telemetry.gnss_position.ground_speed_mps.toFixed(1)} m/s` : '--' },
      { label: 'HDOP', value: telemetry ? telemetry.gnss_position.hdop.toFixed(1) : '--' },
    ] },
    { name: 'BAROMETER', icon: Gauge, status: telemetry?.sensor_health.barometer ?? 'NO DATA', detail: 'Relative altitude', values: [
      { label: 'PRESSURE', value: telemetry ? `${telemetry.barometer.pressure_hpa.toFixed(1)} hPa` : '--' },
      { label: 'REL. ALT', value: telemetry ? `${telemetry.barometer.relative_altitude_m.toFixed(1)} m` : '--' },
    ] },
    { name: 'BATTERY MONITOR', icon: Battery, status: telemetry?.sensor_health.battery ?? 'NO DATA', detail: 'Power telemetry', values: [
      { label: 'VOLTAGE', value: telemetry ? `${telemetry.battery.voltage_v.toFixed(1)} V` : '--' },
      { label: 'LEVEL', value: telemetry ? `${telemetry.battery.remaining_percent.toFixed(0)}%` : '--' },
    ] },
  ]

  return <div className="sensor-health-panel">
    <div className="sensor-legend">{(['VALID', 'DEGRADED', 'FAILED', 'NO DATA'] as SensorStatus[]).map((status) => <SensorStatusBadge key={status} status={status} />)}</div>
    <div className="sensor-list">{statuses.map(({ name, icon: Icon, status, detail, values }) => <article className={`sensor-row ${stale ? 'stale' : ''}`} key={name}>
      <div className={`sensor-icon ${statusColors[status]}`}><Icon size={15} /></div>
      <div className="sensor-main"><div className="sensor-row-heading"><div><h3>{name}</h3><p>{detail}</p></div><SensorStatusBadge status={status} /></div>
        <div className="sensor-values">{values.map(({ label, value }) => <span key={label}><small>{label}</small><b>{value}</b></span>)}</div>
        <div className={`sensor-freshness ${stale ? 'stale' : ''}`}><span className="freshness-pulse" /> LAST UPDATE <b>{ageLabel(ageMs)}</b>{stale && <em>STALE DATA</em>}</div>
      </div>
    </article>)}</div>
    <div className="sensor-simulated-note"><Radio size={12} /> {telemetry ? `${telemetry.data_source.toUpperCase()} telemetry · validated packet` : 'No telemetry packet available'}</div>
  </div>
}

type PositionMetric = { label: string; value: string; unit?: string; icon: SensorIcon; tone?: 'cyan' | 'green' | 'amber' }

export function PositionAltitudePanel() {
  const { telemetry, ageMs, stale } = useTelemetry()
  const position = telemetry?.gnss_position
  const metrics: PositionMetric[] = [
    { label: 'Latitude', value: position ? Math.abs(position.latitude_deg).toFixed(5) : '--', unit: position ? (position.latitude_deg >= 0 ? '° N' : '° S') : undefined, icon: MapPin },
    { label: 'Longitude', value: position ? Math.abs(position.longitude_deg).toFixed(5) : '--', unit: position ? (position.longitude_deg >= 0 ? '° E' : '° W') : undefined, icon: MapPin },
    { label: 'Ground speed', value: position?.ground_speed_mps.toFixed(1) ?? '--', unit: 'm/s', icon: Navigation },
    { label: 'Heading', value: position?.heading_deg.toFixed(1) ?? '--', unit: '° MAG', icon: Compass },
    { label: 'Altitude AGL', value: telemetry?.barometer.relative_altitude_m.toFixed(1) ?? '--', unit: 'm', icon: Gauge },
    { label: 'Barometric pressure', value: telemetry?.barometer.pressure_hpa.toFixed(1) ?? '--', unit: 'hPa', icon: Thermometer, tone: 'amber' },
    { label: 'Battery voltage', value: telemetry?.battery.voltage_v.toFixed(1) ?? '--', unit: 'V', icon: Battery, tone: 'green' },
    { label: 'Battery level', value: telemetry?.battery.remaining_percent.toFixed(0) ?? '--', unit: '%', icon: Battery, tone: 'green' },
  ]
  const fixStatus = telemetry?.sensor_health.gnss ?? 'NO DATA'
  return <div className="position-panel">
    <div className="position-fix-banner"><div className="fix-icon"><LocateFixed size={15} /></div><div><span>GNSS {fixStatus}</span><small>{position ? `${position.fix} · ${position.satellites} satellites · HDOP ${position.hdop.toFixed(1)}` : 'No packet received'}</small></div><span className="position-freshness"><span className="status-dot" /> {ageLabel(ageMs)}</span></div>
    <div className="position-metrics">{metrics.map((metric) => { const Icon = metric.icon; return <div className="position-metric" key={metric.label}><div className={`position-metric-icon ${metric.tone ?? 'cyan'}`}><Icon size={13} /></div><div><span>{metric.label}</span><strong>{metric.value}<small>{metric.unit}</small></strong></div></div> })}</div>
    <div className="position-footer"><span><Activity size={12} /> IMU attitude</span><span>ROLL <b>{telemetry?.imu_attitude.roll_deg.toFixed(1) ?? '--'}°</b></span><span>PITCH <b>{telemetry?.imu_attitude.pitch_deg.toFixed(1) ?? '--'}°</b></span><span>YAW <b>{telemetry?.imu_attitude.yaw_deg.toFixed(1) ?? '--'}°</b></span>{stale && <span className="text-amber-400">STALE</span>}</div>
  </div>
}
