export type WaypointStatus = 'completed' | 'current' | 'pending'
export type MissionState = 'READY' | 'ACTIVE' | 'COMPLETED' | 'ABORTED'

export type Waypoint = {
  id: string
  label: string
  altitude: number
  status: WaypointStatus
}

export type TelemetrySnapshot = {
  roll: number
  pitch: number
  yaw: number
  groundSpeed: number
  relativeAltitude: number
  verticalSpeed: number
  batteryVoltage: number
  batteryLevel: number
}

export type TimelineEvent = {
  time: string
  label: string
  status: 'complete' | 'current' | 'pending'
}

export type ChartPoint = {
  time: string
  altitude: number
  voltage: number
}

export const mockMission = {
  name: 'Survey perimeter Alpha',
  state: 'ACTIVE' as MissionState,
  waypoints: [
    { id: 'wp1', label: 'WP 01', altitude: 100, status: 'completed' },
    { id: 'wp2', label: 'WP 02', altitude: 112, status: 'completed' },
    { id: 'wp3', label: 'WP 03', altitude: 118, status: 'completed' },
    { id: 'wp4', label: 'WP 04', altitude: 125, status: 'current' },
    { id: 'wp5', label: 'WP 05', altitude: 120, status: 'pending' },
  ] satisfies Waypoint[],
  telemetry: {
    roll: 1.8,
    pitch: -0.6,
    yaw: 84.2,
    groundSpeed: 12.8,
    relativeAltitude: 124.6,
    verticalSpeed: 0.4,
    batteryVoltage: 24.8,
    batteryLevel: 78,
  } satisfies TelemetrySnapshot,
  timeline: [
    { time: '13:17:54', label: 'Mission started', status: 'complete' },
    { time: '13:19:02', label: 'Takeoff', status: 'complete' },
    { time: '13:21:31', label: 'Waypoint 03 reached', status: 'complete' },
    { time: '13:23:54', label: 'Fault detected · none', status: 'complete' },
    { time: '13:24:08', label: 'Waypoint 04 reached · current', status: 'current' },
    { time: '—', label: 'Mission completed or aborted', status: 'pending' },
  ] satisfies TimelineEvent[],
  chartData: [
    { time: '13:18', altitude: 0, voltage: 25.2 },
    { time: '13:19', altitude: 28, voltage: 25.1 },
    { time: '13:20', altitude: 86, voltage: 25.0 },
    { time: '13:21', altitude: 112, voltage: 24.9 },
    { time: '13:22', altitude: 118, voltage: 24.9 },
    { time: '13:23', altitude: 121, voltage: 24.8 },
    { time: '13:24', altitude: 124.6, voltage: 24.8 },
  ] satisfies ChartPoint[],
} as const

export const missionCompletion = Math.round(
  (mockMission.waypoints.filter(({ status }) => status === 'completed').length / mockMission.waypoints.length) * 100,
)
