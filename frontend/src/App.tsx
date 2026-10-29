import { ChevronRight, Crosshair, LayoutDashboard, List, MapPin, Menu, Radio, Route, Settings, ShieldCheck, Signal, X } from 'lucide-react'
import { useState } from 'react'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'
import { MissionPage } from './pages/MissionPage'
import { WaypointsPage } from './pages/WaypointsPage'
import { TelemetryPage } from './pages/TelemetryPage'
import { LogsPage } from './pages/LogsPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { useTelemetry, type ConnectionState } from './services/telemetry'
import { NotificationBell } from './components/NotificationBell'

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Mission', icon: Route },
  { label: 'Waypoints', icon: MapPin },
  { label: 'Telemetry', icon: Signal },
  { label: 'Notifications', icon: List },
  { label: 'Logs', icon: List },
  { label: 'Settings', icon: Settings },
]

function statusColor(state: ConnectionState, stale: boolean) {
  if (state === 'CONNECTED' && !stale) return 'green'
  if (state === 'CONNECTING' || state === 'RECONNECTING' || stale) return 'amber'
  return 'red'
}

function App() {
  const [activeNav, setActiveNav] = useState('Dashboard')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { telemetry, connectionState, stale, ageMs } = useTelemetry()
  const source = telemetry?.data_source.toUpperCase() ?? 'NO SOURCE'
  const stateLabel = stale && telemetry ? 'STALE' : connectionState
  const color = statusColor(connectionState, stale)

  return (
    <div className="min-h-screen bg-[#050e1b] text-slate-200">
      <aside className={`sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark"><Crosshair size={22} /></div>
          <div>
            <p className="text-sm font-bold tracking-[0.12em] text-white">NAVDRISHTI</p>
            <p className="text-[9px] tracking-[0.3em] text-cyan-300">VEGA-PILOT</p>
          </div>
          <button className="ml-auto text-slate-500 lg:hidden" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation">
            <X size={19} />
          </button>
        </div>
        <div className="px-4 py-5">
          <p className="eyebrow mb-3 px-3">Operations</p>
          <nav className="space-y-1">
            {navItems.map(({ label, icon: IconComponent }) => (
              <button
                key={label}
                className={`nav-item ${activeNav === label ? 'active' : ''}`}
                onClick={() => { setActiveNav(label); setMobileNavOpen(false) }}
              >
                <IconComponent size={17} />
                <span>{label}</span>
                {activeNav === label && <ChevronRight size={14} className="ml-auto text-cyan-300" />}
              </button>
            ))}
          </nav>
        </div>
        <div className="mt-auto p-4">
          <div className="rounded border border-cyan-400/20 bg-cyan-400/5 p-3">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
              <Radio size={13} /> {source} data
            </div>
            <p className="text-[10px] leading-4 text-slate-500">{telemetry ? 'Validated telemetry source active.' : 'No validated telemetry packet available.'}</p>
          </div>
          <div className="mt-4 flex items-center gap-2 px-2 text-[10px] text-slate-500">
            <ShieldCheck size={13} className="text-emerald-400" /> Secure session · v0.1.0
          </div>
        </div>
      </aside>

      <div className="lg:ml-[238px]">
        <header className="topbar">
          <button className="mr-3 text-slate-400 lg:hidden" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
            <Menu size={21} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-wide text-white">NAVDRISHTI <span className="text-cyan-400">|</span> VEGA-PILOT</p>
            <p className="hidden text-[10px] uppercase tracking-[0.2em] text-slate-500 sm:block">Indigenous Drone Autopilot</p>
          </div>
          <div className="ml-auto flex items-center gap-3 sm:gap-6">
            <div className="hidden items-center gap-2 md:flex">
              <span className={`status-dot ${color}`} /><span className={`text-[10px] uppercase tracking-wider ${color === 'green' ? 'text-emerald-400' : color === 'amber' ? 'text-amber-400' : 'text-red-400'}`}>Telemetry {stateLabel.toLowerCase()}</span>
            </div>
            <div className="hidden text-right xl:block">
              <p className="eyebrow">Last packet</p><p className="font-mono text-xs text-slate-300">{telemetry ? new Date(telemetry.timestamp).toISOString() : '--'}</p>
            </div>
            <div className="hidden text-right xl:block">
              <p className="eyebrow">Packet age</p><p className="font-mono text-xs text-cyan-300">{ageMs === null ? '--' : `${(ageMs / 1000).toFixed(1)}s`}</p>
            </div>
            <NotificationBell onViewAll={() => setActiveNav('Notifications')} />
            <div className="hidden text-right sm:block"><p className="eyebrow">Source</p><p className="font-mono text-xs text-cyan-300">{source}</p></div>
          </div>
        </header>

        <main className="dashboard-content">{activeNav === 'Settings' ? <SettingsPage /> : activeNav === 'Mission' ? <MissionPage /> : activeNav === 'Waypoints' ? <WaypointsPage /> : activeNav === 'Telemetry' ? <TelemetryPage /> : activeNav === 'Notifications' ? <NotificationsPage /> : activeNav === 'Logs' ? <LogsPage /> : <DashboardPage />}</main>
      </div>
    </div>
  )
}

export default App
