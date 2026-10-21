import {
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  Battery,
  Bell,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Crosshair,
  Gauge,
  Home,
  LayoutDashboard,
  List,
  Map,
  MapPin,
  Menu,
  Navigation,
  Plane,
  Radio,
  Route,
  Settings,
  ShieldCheck,
  Signal,
  Terminal,
  Timer,
  X,
} from 'lucide-react'
import { useState, type ComponentType, type ReactNode } from 'react'
import { MissionMap } from './components/MissionMap'
import { FlightTimelinePanel, LiveTelemetryPanel, MissionProgressPanel } from './components/MissionPanels'
import { PositionAltitudePanel, SensorHealthPanel } from './components/TelemetryPanels'
import { missionCompletion, mockMission } from './services/mockMission'

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

const navItems: { label: string; icon: Icon }[] = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Mission', icon: Route },
  { label: 'Waypoints', icon: MapPin },
  { label: 'Telemetry', icon: Signal },
  { label: 'Logs', icon: List },
  { label: 'Settings', icon: Settings },
]

function Panel({
  title,
  icon: IconComponent,
  children,
  className = '',
  action,
}: {
  title: string
  icon?: Icon
  children: ReactNode
  className?: string
  action?: ReactNode
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div className="flex items-center gap-2">
          {IconComponent && <IconComponent size={15} className="text-cyan-300" />}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function StatusDot({ color = 'green' }: { color?: 'green' | 'amber' | 'red' | 'cyan' }) {
  return <span className={`status-dot ${color}`} aria-hidden="true" />
}

function SummaryCard({
  label,
  value,
  detail,
  icon: IconComponent,
  tone = 'cyan',
}: {
  label: string
  value: string
  detail: string
  icon: Icon
  tone?: 'cyan' | 'green' | 'amber'
}) {
  return (
    <div className="summary-card">
      <div className={`summary-icon ${tone}`}>
        <IconComponent size={19} />
      </div>
      <div className="min-w-0">
        <p className="eyebrow">{label}</p>
        <p className="mt-1 truncate text-lg font-semibold text-slate-100">{value}</p>
        <p className={`mt-1 text-[11px] ${tone === 'green' ? 'text-emerald-400' : tone === 'amber' ? 'text-amber-400' : 'text-cyan-300'}`}>
          {detail}
        </p>
      </div>
    </div>
  )
}

function App() {
  const [activeNav, setActiveNav] = useState('Dashboard')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

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
              <Radio size={13} /> Simulated data
            </div>
            <p className="text-[10px] leading-4 text-slate-500">Live systems are disconnected. Values shown are for interface preview only.</p>
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
              <StatusDot /><span className="text-[10px] uppercase tracking-wider text-emerald-400">Telemetry link nominal</span>
            </div>
            <div className="hidden text-right xl:block">
              <p className="eyebrow">Last packet</p><p className="font-mono text-xs text-slate-300">13:24:08.421 UTC</p>
            </div>
            <div className="hidden text-right xl:block">
              <p className="eyebrow">Link quality</p><p className="font-mono text-xs text-emerald-400">98.4%</p>
            </div>
            <Bell size={17} className="text-slate-400" />
            <div className="hidden text-right sm:block">
              <p className="eyebrow">Current UTC</p><p className="font-mono text-xs text-cyan-300">21 OCT 2026 · 13:24:12</p>
            </div>
          </div>
        </header>

        <main className="dashboard-content">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow text-cyan-300">Ground control station / overview</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Mission Dashboard</h1>
            </div>
            <div className="simulated-label"><CircleDot size={12} /> SIMULATED DATA</div>
          </div>

          <div className="summary-grid">
            <SummaryCard label="Flight mode" value="AUTO · MISSION" detail="Autonomous navigation" icon={Plane} />
            <SummaryCard label="Mission status" value={mockMission.state} detail={`WP 04 of 05 · ${missionCompletion}%`} icon={Route} tone="green" />
            <SummaryCard label="Telemetry link" value="CONNECTED" detail="98.4% signal quality" icon={Signal} tone="green" />
            <SummaryCard label="Battery status" value="78%" detail="Estimated 24 min remaining" icon={Battery} tone="amber" />
          </div>

          <div className="dashboard-grid mt-4">
            <Panel title="Mission Map" icon={Map} className="map-panel">
              <MissionMap />
            </Panel>

            <Panel title="Position & Altitude" icon={Navigation}>
              <PositionAltitudePanel />
            </Panel>

            <Panel title="Sensor Health" icon={Gauge}>
              <SensorHealthPanel />
            </Panel>

            <Panel title="Fault Alerts" icon={AlertTriangle} action={<span className="badge green">0 ACTIVE</span>}>
              <div className="empty-state"><CheckCircle2 size={25} className="text-emerald-400" /><p>All systems operating normally</p><span>No unresolved faults detected</span></div>
            </Panel>

            <Panel title="Return to Home / Abort Status" icon={Home}>
              <div className="rth-status"><div className="rth-ring"><Home size={21} /><span>READY</span></div><div><p className="text-sm font-medium text-white">Return to Home available</p><p className="mt-1 text-[11px] text-slate-500">Failsafe altitude: <b className="text-slate-300">100 m</b></p></div></div>
              <div className="button-row"><button className="outline-button"><Home size={13} /> RTH STANDBY</button><button className="danger-button"><AlertOctagon size={13} /> ABORT</button></div>
            </Panel>

            <Panel title="Mission Progress" icon={BarChart3}>
              <MissionProgressPanel />
            </Panel>

            <Panel title="Live Telemetry" icon={Radio} className="telemetry-panel" action={<span className="live-indicator"><StatusDot /> LIVE</span>}>
              <LiveTelemetryPanel />
            </Panel>

            <Panel title="Flight Timeline" icon={Timer}>
              <FlightTimelinePanel />
            </Panel>

            <Panel title="System Log" icon={Terminal} className="log-panel" action={<span className="text-[10px] text-slate-500">AUTO-SCROLL</span>}>
              <div className="log-lines">
                <p><span>13:24:08</span> <b className="text-emerald-400">INFO</b> Telemetry packet received</p>
                <p><span>13:24:06</span> <b className="text-cyan-300">NAV</b> Heading correction applied</p>
                <p><span>13:23:54</span> <b className="text-amber-400">WARN</b> Magnetometer calibration in progress</p>
                <p><span>13:23:42</span> <b className="text-emerald-400">INFO</b> Mission waypoint 04 entered</p>
              </div>
            </Panel>
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
