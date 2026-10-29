import { AlertTriangle, Cable, CheckCircle2, Database, Radio, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Panel } from '../components/Panel'
import { useTelemetry } from '../services/telemetry'
import { connectSerial, disconnectSerial, fetchProviderHealth, fetchSerialPorts, fetchSettings, saveDashboardSettings, saveSerialSettings, selectTelemetrySource, type ProviderHealth, type SettingsState } from '../services/settings'

const emptySettings: SettingsState = {
  source: 'simulation',
  serial: { port: '', baud_rate: 115200 },
  dashboard: { refresh_rate_hz: 2, measurement_units: 'metric', theme: 'dark', alerts_enabled: true, sound_enabled: false },
  system: { controller_model: null, firmware_version: null, telemetry_schema_version: '1.0', device_id: null },
  safety: { geofence: null, mission_limits: null, failsafe_policy: null, validation_status: 'UNCONFIGURED' },
}

function valueOrUnavailable(value: string | null) {
  return value ?? 'Not supplied by hardware'
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(emptySettings)
  const [ports, setPorts] = useState<{ device: string; description: string }[]>([])
  const [health, setHealth] = useState<ProviderHealth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { telemetry } = useTelemetry()

  useEffect(() => {
    Promise.all([fetchSettings(), fetchSerialPorts(), fetchProviderHealth()]).then(([loaded, available, providerHealth]) => {
      setSettings(loaded)
      setPorts(available)
      setHealth(providerHealth)
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load settings'))
  }, [])

  const run = async (operation: () => Promise<SettingsState | SettingsState['dashboard'] | SettingsState['serial']>, success: string) => {
    setBusy(true); setError(null); setMessage(null)
    try {
      const result = await operation()
      if ('source' in result) setSettings(result)
      setMessage(success)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Settings update failed')
    } finally { setBusy(false) }
  }

  const updateSource = (source: SettingsState['source']) => run(
    () => selectTelemetrySource(source),
    `Telemetry source set to ${source.toUpperCase()}.`,
  )

  return <div className="settings-page">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow text-cyan-300">Ground control station / configuration</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">System Settings</h1></div><div className={`source-badge ${settings.source === 'hardware' ? 'hardware' : 'simulation'}`}><Radio size={12} /> ACTIVE SOURCE · {settings.source.toUpperCase()}</div></div>
    {error && <div className="settings-alert error"><AlertTriangle size={16} />{error}</div>}
    {message && <div className="settings-alert success"><CheckCircle2 size={16} />{message}</div>}
    <div className="settings-grid">
      <Panel title="Telemetry Source" icon={Radio}><div className="settings-card"><p className="settings-help">Source changes are explicit. Hardware mode never falls back to simulated readings.</p><div className="settings-choice-row">{(['simulation', 'hardware'] as const).map((source) => <button className={`settings-choice ${settings.source === source ? 'selected' : ''}`} key={source} disabled={busy} onClick={() => updateSource(source)}><strong>{source.toUpperCase()}</strong><span>{source === 'simulation' ? 'Deterministic development provider' : 'Configured provider only; no fake packet substitution'}</span></button>)}</div></div></Panel>
      <Panel title="Serial Connection" icon={Cable}><div className="settings-card"><label className="settings-field"><span>Serial port</span><select value={settings.serial.port} onChange={(event) => setSettings({ ...settings, serial: { ...settings.serial, port: event.target.value } })}><option value="">Select a detected port</option>{ports.map((port) => <option value={port.device} key={port.device}>{port.device} · {port.description}</option>)}</select></label><label className="settings-field"><span>Baud rate</span><input type="number" min="1200" max="4000000" value={settings.serial.baud_rate} onChange={(event) => setSettings({ ...settings, serial: { ...settings.serial, baud_rate: Number(event.target.value) } })} /></label><div className="settings-actions"><button className="outline-button" disabled={busy} onClick={() => run(() => saveSerialSettings(settings.serial), 'Serial settings saved.')}><Save size={13} /> SAVE</button><button className="outline-button" disabled={busy || settings.source !== 'hardware'} onClick={() => run(() => connectSerial(), 'Serial connect requested.')}><Cable size={13} /> CONNECT</button><button className="danger-button" disabled={busy} onClick={() => run(() => disconnectSerial(), 'Serial provider disconnected.')}><Cable size={13} /> DISCONNECT</button></div><div className="settings-status"><span>STATUS</span><b className={health?.provider_connected === 'true' ? 'text-emerald-400' : 'text-slate-400'}>{health?.provider_connected === 'true' ? 'CONNECTED' : settings.source === 'hardware' ? 'DISCONNECTED / NO PACKET' : 'SIMULATION'}</b><span>Last valid packet</span><b>{health?.last_valid_packet_at || (telemetry ? new Date(telemetry.timestamp).toISOString() : 'No valid packet')}</b><span>Packet errors</span><b>{health?.packet_error_count ?? '--'}</b><span>Timeouts</span><b>{health?.timeout_count ?? '--'}</b></div></div></Panel>
      <Panel title="System Information" icon={Database}><div className="settings-card settings-info-grid"><span>Controller model</span><b>{valueOrUnavailable(settings.system.controller_model)}</b><span>Firmware version</span><b>{valueOrUnavailable(settings.system.firmware_version)}</b><span>Telemetry schema</span><b>{settings.system.telemetry_schema_version}</b><span>Device identification</span><b>{valueOrUnavailable(settings.system.device_id)}</b></div></Panel>
      <Panel title="Dashboard Preferences" icon={SlidersHorizontal}><div className="settings-card"><label className="settings-field"><span>Display rate (Hz)</span><input type="number" min="0.5" max="10" step="0.5" value={settings.dashboard.refresh_rate_hz} onChange={(event) => setSettings({ ...settings, dashboard: { ...settings.dashboard, refresh_rate_hz: Number(event.target.value) } })} /></label><label className="settings-field"><span>Measurement units</span><select value={settings.dashboard.measurement_units} onChange={(event) => setSettings({ ...settings, dashboard: { ...settings.dashboard, measurement_units: event.target.value as SettingsState['dashboard']['measurement_units'] } })}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label><label className="settings-field"><span>Theme</span><select value={settings.dashboard.theme} onChange={(event) => setSettings({ ...settings, dashboard: { ...settings.dashboard, theme: event.target.value as SettingsState['dashboard']['theme'] } })}><option value="dark">Dark</option><option value="light">Light (not applied)</option><option value="system">System (not applied)</option></select></label><label className="settings-check"><input type="checkbox" checked={settings.dashboard.alerts_enabled} onChange={(event) => setSettings({ ...settings, dashboard: { ...settings.dashboard, alerts_enabled: event.target.checked } })} /> Alert notifications</label><label className="settings-check"><input type="checkbox" checked={settings.dashboard.sound_enabled} onChange={(event) => setSettings({ ...settings, dashboard: { ...settings.dashboard, sound_enabled: event.target.checked } })} /> Sound notifications</label><button className="outline-button" disabled={busy} onClick={() => run(() => saveDashboardSettings(settings.dashboard), 'Dashboard preferences saved.')}><Save size={13} /> SAVE PREFERENCES</button></div></Panel>
      <Panel title="Safety and Mission Settings" icon={ShieldCheck} className="settings-wide"><div className="settings-card"><div className="settings-safety-warning"><ShieldCheck size={18} /><div><strong>Onboard safety limits are authoritative</strong><p>The dashboard cannot override geofence, mission, or failsafe limits. Changes require an authenticated, validated onboard configuration process outside this display.</p></div></div><div className="settings-info-grid"><span>Geofence</span><b>{settings.safety.geofence ? 'Configured by backend' : 'Not supplied'}</b><span>Mission limits</span><b>{settings.safety.mission_limits ? 'Configured by backend' : 'Not supplied'}</b><span>Failsafe policy</span><b>{settings.safety.failsafe_policy ? 'Configured by backend' : 'Not supplied'}</b><span>Validation status</span><b className={settings.safety.validation_status === 'VALIDATED' ? 'text-emerald-400' : 'text-amber-400'}>{settings.safety.validation_status}</b></div></div></Panel>
    </div>
  </div>
}
