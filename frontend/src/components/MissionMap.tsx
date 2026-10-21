import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useState } from 'react'

type SimulatedCoordinate = [number, number]

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

type SimulatedWaypoint = {
  id: string
  label: string
  coordinate: SimulatedCoordinate
  altitude: number
  status: 'complete' | 'current' | 'pending'
}

const simulatedHome: SimulatedCoordinate = [18.5204, 73.8567]
const simulatedDrone: SimulatedCoordinate = [18.5239, 73.8641]
const simulatedWaypoints: SimulatedWaypoint[] = [
  { id: 'wp1', label: 'WP1', coordinate: [18.5204, 73.8567], altitude: 100, status: 'complete' },
  { id: 'wp2', label: 'WP2', coordinate: [18.5222, 73.8602], altitude: 112, status: 'complete' },
  { id: 'wp3', label: 'WP3', coordinate: [18.5248, 73.8625], altitude: 118, status: 'complete' },
  { id: 'wp4', label: 'WP4', coordinate: [18.5264, 73.8668], altitude: 125, status: 'current' },
  { id: 'wp5', label: 'WP5', coordinate: [18.5239, 73.8701], altitude: 120, status: 'pending' },
]

const droneIcon = L.divIcon({
  className: 'drone-leaflet-icon',
  html: '<span>▲</span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
})

const homeIcon = L.divIcon({
  className: 'home-leaflet-icon',
  html: '<span>H</span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

function waypointIcon(status: SimulatedWaypoint['status'], selected: boolean) {
  return L.divIcon({
    className: `waypoint-leaflet-icon ${status} ${selected ? 'selected' : ''}`,
    html: `<span>${status === 'current' ? '●' : ''}</span>`,
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
  const [selectedWaypointId, setSelectedWaypointId] = useState('wp4')
  const selectedWaypoint = simulatedWaypoints.find(({ id }) => id === selectedWaypointId) ?? simulatedWaypoints[0]
  const route = useMemo<SimulatedCoordinate[]>(
    () => [simulatedHome, ...simulatedWaypoints.map(({ coordinate }) => coordinate), simulatedHome],
    [],
  )
  const bounds = useMemo<LatLngBoundsExpression>(() => route, [route])

  return (
    <div className="mission-map">
      <MapContainer
        center={simulatedDrone}
        zoom={14}
        scrollWheelZoom
        zoomControl
        className="leaflet-map"
        attributionControl
      >
        <TileLayer
          url={tileProvider.url}
          attribution={tileProvider.attribution}
          maxZoom={tileProvider.maxZoom ?? 19}
        />
        <FitMissionBounds bounds={bounds} />
        <Polyline positions={route} pathOptions={{ color: '#28c8d7', weight: 2, dashArray: '7 7' }} />
        <Marker position={simulatedHome} icon={homeIcon}>
          <Popup>
            <strong>HOME · SIMULATED</strong>
            <br />
            Launch and return point
            <br />
            {formatCoordinate(simulatedHome[0], 'N', 'S')} · {formatCoordinate(simulatedHome[1], 'E', 'W')}
          </Popup>
        </Marker>
        {simulatedWaypoints.map((waypoint) => (
          <Marker
            key={waypoint.id}
            position={waypoint.coordinate}
            icon={waypointIcon(waypoint.status, selectedWaypointId === waypoint.id)}
            eventHandlers={{ click: () => setSelectedWaypointId(waypoint.id) }}
          >
            <Popup>
              <strong>{waypoint.label} · SIMULATED</strong>
              <br />
              Mission waypoint · {waypoint.status}
              <br />
              Altitude: {waypoint.altitude} m AGL
              <br />
              {formatCoordinate(waypoint.coordinate[0], 'N', 'S')} · {formatCoordinate(waypoint.coordinate[1], 'E', 'W')}
            </Popup>
          </Marker>
        ))}
        <Marker position={simulatedDrone} icon={droneIcon}>
          <Popup>
            <strong>DRONE · SIMULATED GNSS</strong>
            <br />
            Current simulated aircraft position
          </Popup>
        </Marker>
        <CircleMarker
          center={simulatedDrone}
          radius={25}
          pathOptions={{ color: '#67e8f9', fillColor: '#22d3ee', fillOpacity: 0.08, weight: 1, dashArray: '4 5' }}
        />
      </MapContainer>

      <div className="map-info-panel">
        <div className="map-info-title"><span className="status-dot cyan" /> SIMULATED GNSS · {tileProvider.name.toUpperCase()}</div>
        <div className="map-info-grid">
          <span>LAT <b>{formatCoordinate(simulatedDrone[0], 'N', 'S')}</b></span>
          <span>LNG <b>{formatCoordinate(simulatedDrone[1], 'E', 'W')}</b></span>
          <span>ALT <b>124.6 m AGL</b></span>
          <span>GNSS <b className="valid">VALID · RTK FIX</b></span>
        </div>
      </div>
      <div className="selected-waypoint">
        <span>SELECTED WAYPOINT</span>
        <strong>{selectedWaypoint.label}</strong>
        <small>{selectedWaypoint.altitude} m AGL</small>
      </div>
      <div className="map-simulated-stamp">ALL POSITIONS SIMULATED</div>
    </div>
  )
}
