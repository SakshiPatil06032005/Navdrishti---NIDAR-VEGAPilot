export type LogQuery = {
  start?: string
  end?: string
  sensor?: string
  severity?: string
  event_type?: string
  data_source?: string
  search?: string
  limit?: number
  offset?: number
}

export type LogRecord = {
  uid: string
  timestamp: string
  recorded_at: string
  event_type: string
  severity: string
  data_source: string
  sensor: string | null
  code: string | null
  message: string
  flight_mode: string | null
  battery_voltage_v: number | null
  altitude_m: number | null
  relative_altitude_m: number | null
  link_connected: boolean | null
  link_signal_percent: number | null
}

export type LogRecordsResponse = {
  total: number
  limit: number
  offset: number
  records: LogRecord[]
  database_error: string | null
}

export type LogHistoryPoint = {
  timestamp: string
  battery_voltage_v: number
  altitude_m: number
  relative_altitude_m: number
}

export type LogHistoryResponse = {
  points: LogHistoryPoint[]
  database_error: string | null
}

export type LogStats = {
  total: number
  telemetry: number
  faults: number
  system: number
  warnings: number
  errors: number
  connection_losses: number
  database_error: string | null
}
