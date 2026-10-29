import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useState } from 'react'
import { fetchSelectedMission, type SelectedMission } from '../services/missions'
import { useTelemetry } from '../services/telemetry'

type Coordinate = [number, number]

export type TileProvider = {
  name: string
  url: string
  attribution: string
  maxZoom?: number
}

const openStreetMapProvider: TileProvider = {
  name: 'OpenStreetMap',
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
}

const droneIcon = L.divIcon({ className: 'drone-leaflet-icon', html: '<span>▲</span>', iconSize: [30, 30], iconAnchor: [15, 15] })
const homeIcon = L.divIcon({ className: 'home-leaflet-icon', html: '<span>H</span>', iconSize: [26, 26], iconAnchor: [13, 13] })

function waypointIcon(status: string) {
  const markerStatus = status === 'completed' ? 'complete' : status === 'current' ? 'current' : 'pending'
  return L.divIcon({
    className: `waypoint-leaflet-icon ${markerStatus}`,
    html: `<span>${markerStatus === 'current' ? '●' : ''}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

function FitMissionBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap()
  useEffect(() => {
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 })
  }, [bounds, map])
  return null
}

function formatCoordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(5)}° ${value >= 0 ? positive : negative}`
}

export function MissionMap({ tileProvider = openStreetMapProvider }: { tileProvider?: TileProvider }) {
  const { telemetry } = useTelemetry()
  const [mission, setMission] = useState<SelectedMission | null>(null)
  const latitude = telemetry?.gnss_position.latitude_deg
  const longitude = telemetry?.gnss_position.longitude_deg
  const currentPosition = useMemo<Coordinate>(
    () => latitude !== undefined && longitude !== undefined ? [latitude, longitude] : [0, 0],
    [latitude, longitude],
  )

  useEffect(() => {
    const load = () => { void fetchSelectedMission().then(setMission).catch(() => setMission(null)) }
    load()
    const timer = window.setInterval(load, 2000)
    return () => window.clearInterval(timer)
  }, [])

  const points = useMemo<Coordinate[]>(() => mission?.waypoints.map((waypoint) => [waypoint.latitude_deg, waypoint.longitude_deg]) ?? [], [mission])
  const home = useMemo<Coordinate | null>(() => {
    if (!mission || mission.home_latitude_deg === null || mission.home_longitude_deg === null) return null
    return [mission.home_latitude_deg, mission.home_longitude_deg]
  }, [mission])
  const route = useMemo<Coordinate[]>(() => {
    const planned = home ? [home, ...points, home] : points
    return planned.length ? planned : (telemetry ? [currentPosition] : [])
  }, [currentPosition, home, points, telemetry])
  const bounds = useMemo<LatLngBoundsExpression>(() => route.length ? route : [[0, 0], [1, 1]], [route])
  const selectedWaypoint = mission?.waypoints.find((waypoint) => waypoint.status === 'current') ?? mission?.waypoints[0]

  return <div className="mission-map">
    <MapContainer center={currentPosition} zoom={14} scrollWheelZoom zoomControl className="leaflet-map" attributionControl>
      <TileLayer url={tileProvider.url} attribution={tileProvider.attribution} maxZoom={tileProvider.maxZoom ?? 19} />
      <FitMissionBounds bounds={bounds} />
      {points.length > 1 && <Polyline positions={points} pathOptions={{ color: '#28c8d7', weight: 3 }} />}
      {home && <Marker position={home} icon={homeIcon}><Popup><strong>HOME · SIMULATOR</strong><br />Configured mission home position</Popup></Marker>}
      {mission?.waypoints.map((waypoint, index) => <Marker key={waypoint.id} position={[waypoint.latitude_deg, waypoint.longitude_deg]} icon={waypointIcon(waypoint.status)}>
        <Popup><strong>WP {index + 1} · {waypoint.label}</strong><br />{waypoint.status}<br />{waypoint.altitude_m} m relative altitude<br />{formatCoordinate(waypoint.latitude_deg, 'N', 'S')} · {formatCoordinate(waypoint.longitude_deg, 'E', 'W')}</Popup>
      </Marker>)}
      {telemetry && <Marker position={currentPosition} icon={droneIcon}><Popup><strong>DRONE · {telemetry.data_source.toUpperCase()}</strong><br />Current validated telemetry position</Popup></Marker>}
      {telemetry && <CircleMarker center={currentPosition} radius={25} pathOptions={{ color: '#67e8f9', fillColor: '#22d3ee', fillOpacity: 0.08, weight: 1, dashArray: '4 5' }} />}
    </MapContainer>
    <div className="map-info-panel">
      <div className="map-info-title"><span className="status-dot cyan" /> {mission ? mission.name.toUpperCase() : 'NO SELECTED MISSION'} · {tileProvider.name.toUpperCase()}</div>
      <div className="map-info-grid"><span>LAT <b>{telemetry ? formatCoordinate(currentPosition[0], 'N', 'S') : '--'}</b></span><span>LNG <b>{telemetry ? formatCoordinate(currentPosition[1], 'E', 'W') : '--'}</b></span><span>ALT <b>{telemetry ? `${telemetry.gnss_position.altitude_m.toFixed(1)} m AGL` : '--'}</b></span><span>MISSION <b className="valid">{mission?.state ?? 'NO DATA'}</b></span></div>
    </div>
    <div className="selected-waypoint"><span>SELECTED WAYPOINT</span><strong>{selectedWaypoint?.label ?? '--'}</strong><small>{selectedWaypoint ? `${selectedWaypoint.altitude_m} m relative altitude` : 'No mission loaded'}</small></div>
    <div className="map-simulated-stamp">{telemetry?.data_source === 'simulation' ? 'BACKEND SIMULATION POSITIONS' : telemetry ? 'HARDWARE POSITION' : 'AWAITING POSITION'}</div>
  </div>
}
