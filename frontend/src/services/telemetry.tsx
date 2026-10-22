import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export type SensorStatus = 'VALID' | 'DEGRADED' | 'FAILED' | 'NO DATA'
export type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING'
export type DataSource = 'simulation' | 'hardware'

export type Telemetry = {
  timestamp: string
  data_source: DataSource
  flight_mode: 'MISSION' | 'LOITER' | 'MANUAL'
  gnss_position: {
    latitude_deg: number
    longitude_deg: number
    altitude_m: number
    ground_speed_mps: number
    heading_deg: number
    fix: string
    satellites: number
    hdop: number
  }
  imu_attitude: {
    roll_deg: number
    pitch_deg: number
    yaw_deg: number
    roll_rate_dps: number
    pitch_rate_dps: number
    yaw_rate_dps: number
  }
  barometer: {
    pressure_hpa: number
    relative_altitude_m: number
    vertical_speed_mps: number
  }
  battery: {
    voltage_v: number
    current_a: number
    remaining_percent: number
  }
  sensor_health: {
    imu: SensorStatus
    gnss: SensorStatus
    barometer: SensorStatus
    battery: SensorStatus
  }
  telemetry_link: {
    connected: boolean
    signal_strength_percent: number
    latency_ms: number
  }
  mission_status: {
    name: string
    state: 'READY' | 'ACTIVE' | 'COMPLETED' | 'ABORTED'
    current_waypoint: string
    completed_waypoints: number
    total_waypoints: number
  }
  fault_events: {
    timestamp: string
    severity: string
    code: string
    message: string
    sensor?: string | null
  }[]
}

type TelemetryContextValue = {
  telemetry: Telemetry | null
  history: Telemetry[]
  connectionState: ConnectionState
  lastPacketAt: number | null
  stale: boolean
  error: string | null
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null)
const WS_URL = 'ws://localhost:8000/ws/telemetry'
const STALE_AFTER_MS = 3_000
const RECONNECT_DELAY_MS = 1_500
const MAX_HISTORY = 60

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStatus(value: unknown): value is SensorStatus {
  return value === 'VALID' || value === 'DEGRADED' || value === 'FAILED' || value === 'NO DATA'
}

function isDataSource(value: unknown): value is DataSource {
  return value === 'simulation' || value === 'hardware'
}

function isTelemetry(value: unknown): value is Telemetry {
  if (!value || typeof value !== 'object') return false
  const packet = value as Record<string, unknown>
  const gnss = packet.gnss_position as Record<string, unknown> | undefined
  const imu = packet.imu_attitude as Record<string, unknown> | undefined
  const barometer = packet.barometer as Record<string, unknown> | undefined
  const battery = packet.battery as Record<string, unknown> | undefined
  const health = packet.sensor_health as Record<string, unknown> | undefined
  const link = packet.telemetry_link as Record<string, unknown> | undefined
  const mission = packet.mission_status as Record<string, unknown> | undefined
  return (
    typeof packet.timestamp === 'string' &&
    isDataSource(packet.data_source) &&
    typeof packet.flight_mode === 'string' &&
    !!gnss && isNumber(gnss.latitude_deg) && isNumber(gnss.longitude_deg) &&
    isNumber(gnss.altitude_m) && isNumber(gnss.ground_speed_mps) &&
    isNumber(gnss.heading_deg) && typeof gnss.fix === 'string' &&
    isNumber(gnss.satellites) && isNumber(gnss.hdop) &&
    !!imu && isNumber(imu.roll_deg) && isNumber(imu.pitch_deg) &&
    isNumber(imu.yaw_deg) && isNumber(imu.roll_rate_dps) &&
    isNumber(imu.pitch_rate_dps) && isNumber(imu.yaw_rate_dps) &&
    !!barometer && isNumber(barometer.pressure_hpa) &&
    isNumber(barometer.relative_altitude_m) && isNumber(barometer.vertical_speed_mps) &&
    !!battery && isNumber(battery.voltage_v) && isNumber(battery.current_a) &&
    isNumber(battery.remaining_percent) && !!health && isStatus(health.imu) &&
    isStatus(health.gnss) && isStatus(health.barometer) && isStatus(health.battery) &&
    !!link && typeof link.connected === 'boolean' &&
    isNumber(link.signal_strength_percent) && isNumber(link.latency_ms) &&
    !!mission && typeof mission.name === 'string' && typeof mission.state === 'string' &&
    typeof mission.current_waypoint === 'string' && isNumber(mission.completed_waypoints) &&
    isNumber(mission.total_waypoints) && Array.isArray(packet.fault_events)
  )
}

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [history, setHistory] = useState<Telemetry[]>([])
  const [connectionState, setConnectionState] = useState<ConnectionState>('CONNECTING')
  const [lastPacketAt, setLastPacketAt] = useState<number | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const intentionalCloseRef = useRef(false)

  useEffect(() => {
    intentionalCloseRef.current = false
    let retryAttempt = 0

    const connect = () => {
      setConnectionState(retryAttempt === 0 ? 'CONNECTING' : 'RECONNECTING')
      const socket = new WebSocket(WS_URL)
      socketRef.current = socket

      socket.onopen = () => {
        retryAttempt = 0
        setConnectionState('CONNECTED')
        setError(null)
      }
      socket.onmessage = (event) => {
        try {
          const candidate: unknown = JSON.parse(event.data)
          if (!isTelemetry(candidate)) {
            setError('Received telemetry failed validation')
            return
          }
          const packetTime = Date.parse(candidate.timestamp)
          if (!Number.isFinite(packetTime)) {
            setError('Received telemetry has an invalid timestamp')
            return
          }
          const receivedAt = Date.now()
          setTelemetry(candidate)
          setLastPacketAt(receivedAt)
          setHistory((previous) => [...previous, candidate].slice(-MAX_HISTORY))
        } catch {
          setError('Received telemetry was not valid JSON')
        }
      }
      socket.onerror = () => setError('Telemetry WebSocket connection error')
      socket.onclose = () => {
        if (intentionalCloseRef.current) return
        setConnectionState('DISCONNECTED')
        reconnectTimerRef.current = window.setTimeout(() => {
          retryAttempt += 1
          connect()
        }, RECONNECT_DELAY_MS)
      }
    }

    connect()
    return () => {
      intentionalCloseRef.current = true
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current)
      socketRef.current?.close()
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [])

  const stale = lastPacketAt === null || clock - lastPacketAt > STALE_AFTER_MS
  const value = useMemo(
    () => ({ telemetry, history, connectionState, lastPacketAt, stale, error }),
    [telemetry, history, connectionState, lastPacketAt, stale, error, clock],
  )
  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>
}

export function useTelemetry() {
  const value = useContext(TelemetryContext)
  if (!value) throw new Error('useTelemetry must be used inside TelemetryProvider')
  return value
}
