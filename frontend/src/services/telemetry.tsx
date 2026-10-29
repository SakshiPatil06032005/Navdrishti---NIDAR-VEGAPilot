import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export type SensorStatus = 'VALID' | 'DEGRADED' | 'FAILED' | 'NO DATA'
export type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING' | 'ERROR'
export type DataSource = 'simulation' | 'hardware'

export type Telemetry = {
  timestamp: string
  packet_sequence?: number | null
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

export type TelemetryDiagnostics = {
  validPacketCount: number
  invalidPacketCount: number
  reconnectAttempts: number
  packetSequence: number
  packetErrorCount: number
  timeoutCount: number
  providerConnected: boolean | null
  providerStale: boolean | null
  lastValidPacketAt: string | null
}

type TelemetryContextValue = {
  telemetry: Telemetry | null
  history: Telemetry[]
  connectionState: ConnectionState
  lastPacketAt: number | null
  stale: boolean
  ageMs: number | null
  error: string | null
  diagnostics: TelemetryDiagnostics
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null)
const WS_URL = 'ws://localhost:8000/ws/telemetry'
const STALE_AFTER_MS = 3_000
const RECONNECT_DELAY_MS = 1_500
const MAX_HISTORY = 60

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRange(value: unknown, minimum: number, maximum: number): value is number {
  return isNumber(value) && value >= minimum && value <= maximum
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
    !!gnss && isRange(gnss.latitude_deg, -90, 90) && isRange(gnss.longitude_deg, -180, 180) &&
    isRange(gnss.altitude_m, -500, 20_000) && isRange(gnss.ground_speed_mps, 0, 200) &&
    isRange(gnss.heading_deg, 0, 360) && typeof gnss.fix === 'string' &&
    isRange(gnss.satellites, 0, 100) && isRange(gnss.hdop, 0, 100) &&
    !!imu && isRange(imu.roll_deg, -180, 180) && isRange(imu.pitch_deg, -90, 90) &&
    isRange(imu.yaw_deg, 0, 360) && isNumber(imu.roll_rate_dps) &&
    isNumber(imu.pitch_rate_dps) && isNumber(imu.yaw_rate_dps) &&
    !!barometer && isRange(barometer.pressure_hpa, 100, 1_200) &&
    isRange(barometer.relative_altitude_m, -500, 20_000) && isRange(barometer.vertical_speed_mps, -200, 200) &&
    !!battery && isRange(battery.voltage_v, 0, 100) && isRange(battery.current_a, -500, 500) &&
    isRange(battery.remaining_percent, 0, 100) && !!health && isStatus(health.imu) &&
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
  const [diagnostics, setDiagnostics] = useState<TelemetryDiagnostics>({
    validPacketCount: 0,
    invalidPacketCount: 0,
    reconnectAttempts: 0,
    packetSequence: 0,
    packetErrorCount: 0,
    timeoutCount: 0,
    providerConnected: null,
    providerStale: null,
    lastValidPacketAt: null,
  })
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const intentionalCloseRef = useRef(false)

  useEffect(() => {
    intentionalCloseRef.current = false
    let retryAttempt = 0
    let reconnectAttempts = 0

    const connect = () => {
      setConnectionState(retryAttempt === 0 ? 'CONNECTING' : 'RECONNECTING')
      if (retryAttempt > 0) {
        reconnectAttempts += 1
        setDiagnostics((previous) => ({ ...previous, reconnectAttempts }))
      }
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
          if (candidate && typeof candidate === 'object' && 'type' in candidate &&
              ((candidate as { type?: unknown }).type === 'mission_event' ||
               (candidate as { type?: unknown }).type === 'status' ||
               (candidate as { type?: unknown }).type === 'notification_event')) {
            return
          }
          if (!isTelemetry(candidate)) {
            setDiagnostics((previous) => ({ ...previous, invalidPacketCount: previous.invalidPacketCount + 1 }))
            setError('Received telemetry failed validation')
            return
          }
          const packetTime = Date.parse(candidate.timestamp)
          if (!Number.isFinite(packetTime)) {
            setDiagnostics((previous) => ({ ...previous, invalidPacketCount: previous.invalidPacketCount + 1 }))
            setError('Received telemetry has an invalid timestamp')
            return
          }
          const receivedAt = Date.now()
          setTelemetry(candidate)
          setLastPacketAt(receivedAt)
          setHistory((previous) => [...previous, candidate].slice(-MAX_HISTORY))
          setDiagnostics((previous) => ({
            ...previous,
            validPacketCount: previous.validPacketCount + 1,
            packetSequence: candidate.packet_sequence ?? previous.packetSequence + 1,
            lastValidPacketAt: candidate.timestamp,
          }))
        } catch {
          setDiagnostics((previous) => ({ ...previous, invalidPacketCount: previous.invalidPacketCount + 1 }))
          setError('Received telemetry was not valid JSON')
        }
      }
      socket.onerror = () => {
        setError('Telemetry WebSocket connection error')
        setConnectionState('ERROR')
      }
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
    let cancelled = false
    const loadDiagnostics = async () => {
      try {
        const response = await fetch('http://localhost:8000/api/health')
        if (!response.ok) return
        const health = await response.json() as Record<string, string>
        if (cancelled) return
        setDiagnostics((previous) => ({
          ...previous,
          packetErrorCount: Number(health.packet_error_count) || 0,
          timeoutCount: Number(health.timeout_count) || 0,
          providerConnected: health.provider_connected === 'true',
          providerStale: health.provider_stale === 'true',
          lastValidPacketAt: health.last_valid_packet_at || previous.lastValidPacketAt,
        }))
      } catch {
        // The WebSocket remains the source of truth when diagnostics polling is unavailable.
      }
    }
    void loadDiagnostics()
    const timer = window.setInterval(() => { void loadDiagnostics() }, 2_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [])

  const ageMs = lastPacketAt === null ? null : Math.max(0, clock - lastPacketAt)
  const stale = ageMs === null || ageMs > STALE_AFTER_MS
  const value = useMemo(
    () => ({ telemetry, history, connectionState, lastPacketAt, stale, ageMs, error, diagnostics }),
    [telemetry, history, connectionState, lastPacketAt, stale, ageMs, error, diagnostics],
  )
  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>
}

export function useTelemetry() {
  const value = useContext(TelemetryContext)
  if (!value) throw new Error('useTelemetry must be used inside TelemetryProvider')
  return value
}
