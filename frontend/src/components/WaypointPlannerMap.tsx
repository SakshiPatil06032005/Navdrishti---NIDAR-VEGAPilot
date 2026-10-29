import { MapContainer, Marker, Polyline, Popup, TileLayer, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useMemo } from 'react'
import type { MissionDraft } from '../services/missions'

const viewCenter: [number, number] = [20, 78]
const homeIcon = L.divIcon({ className: 'home-leaflet-icon', html: '<span>H</span>', iconSize: [26, 26], iconAnchor: [13, 13] })

function waypointIcon(index: number) {
  return L.divIcon({ className: 'waypoint-leaflet-icon current', html: `<span>${index + 1}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] })
}

function ClickCapture({ onClick }: { onClick: (latitude: number, longitude: number) => void }) {
  useMapEvents({ click: (event) => onClick(event.latlng.lat, event.latlng.lng) })
  return null
}

export function WaypointPlannerMap({ mission, onMapClick }: { mission: MissionDraft; onMapClick: (latitude: number, longitude: number) => void }) {
  const points = useMemo(() => mission.waypoints.map((waypoint) => [waypoint.latitude_deg, waypoint.longitude_deg] as [number, number]), [mission.waypoints])
  const center = points[0] ?? viewCenter
  const home = mission.home_latitude_deg !== null && mission.home_longitude_deg !== null
    ? [mission.home_latitude_deg, mission.home_longitude_deg] as [number, number]
    : null
  return <div className="planner-map"><MapContainer center={center} zoom={points.length ? 13 : 5} scrollWheelZoom className="leaflet-map"><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" /><ClickCapture onClick={onMapClick} />{home && <Marker position={home} icon={homeIcon}><Popup>HOME · configured position</Popup></Marker>}{points.length > 1 && <Polyline positions={points} pathOptions={{ color: '#22d3ee', weight: 3 }} />}{points.map((point, index) => <Marker key={mission.waypoints[index].id} position={point} icon={waypointIcon(index)}><Popup><strong>WP {index + 1} · {mission.waypoints[index].label}</strong><br />{mission.waypoints[index].altitude_m} m relative altitude</Popup></Marker>)}</MapContainer><div className="map-simulated-stamp">CLICK MAP TO SET SELECTED WAYPOINT</div></div>
}
