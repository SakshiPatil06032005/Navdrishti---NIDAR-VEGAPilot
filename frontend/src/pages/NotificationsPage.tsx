import { Bell, Mic, Settings2, Volume2 } from 'lucide-react'
import { useNotificationCenter } from '../services/notificationCenter'
import { NotificationItem } from '../components/NotificationItem'

export function NotificationsPage() {
  const {
    notifications,
    markNotificationRead,
    dismiss,
    readAll,
    policy,
    updatePolicy,
    voice,
    voices,
    updateVoice,
    unlockVoice,
    speechAvailable,
    speechBlocked,
    testVoice,
    testNotification,
  } = useNotificationCenter()

  return (
    <div className="settings-page">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><p className="eyebrow text-cyan-300">Ground control station / alerts</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Notification Center</h1></div>
        <div className="settings-actions">
          <button className="outline-button" onClick={() => void readAll()}><Bell size={12} /> MARK ALL READ</button>
          <button className="outline-button" onClick={() => void testNotification('INFORMATION')}>TEST NOTIFICATION</button>
          <button className="danger-button" onClick={() => void testNotification('CRITICAL')}>TEST CRITICAL ALERT</button>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel settings-wide">
          <div className="panel-heading"><div className="flex items-center gap-2"><Bell size={15} className="text-cyan-300" /><h2>Notification History</h2></div></div>
          <div className="notification-page-list">
            {notifications.map((item) => (
              <NotificationItem
                key={item.id}
                item={item}
                onRead={(id) => { void markNotificationRead(id) }}
                onDismiss={(id) => { void dismiss(id) }}
              />
            ))}
            {!notifications.length && <p className="notification-empty">No notifications available.</p>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading"><div className="flex items-center gap-2"><Settings2 size={15} className="text-cyan-300" /><h2>Alert Thresholds</h2></div></div>
          <div className="settings-card">
            {policy && <>
              <label className="settings-field"><span>Low battery warning (%)</span><input type="number" min={0} max={100} value={policy.low_battery_warning_percent} onChange={(event) => updatePolicy({ ...policy, low_battery_warning_percent: Number(event.target.value) })} /></label>
              <label className="settings-field"><span>Critical battery (%)</span><input type="number" min={0} max={100} value={policy.low_battery_critical_percent} onChange={(event) => updatePolicy({ ...policy, low_battery_critical_percent: Number(event.target.value) })} /></label>
              <label className="settings-field"><span>Cooldown (seconds)</span><input type="number" min={1} max={3600} value={policy.alert_cooldown_s} onChange={(event) => updatePolicy({ ...policy, alert_cooldown_s: Number(event.target.value) })} /></label>
              <label className="settings-check"><input type="checkbox" checked={policy.announce_recovery} onChange={(event) => updatePolicy({ ...policy, announce_recovery: event.target.checked })} /> Announce recovery once</label>
              <p className="settings-help mt-3">Thresholds are configurable for simulation and inspection only; not flight-safety validated.</p>
            </>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading"><div className="flex items-center gap-2"><Volume2 size={15} className="text-cyan-300" /><h2>Voice Alerts</h2></div></div>
          <div className="settings-card">
            <p className="settings-help">{speechAvailable ? 'Browser speech synthesis detected.' : 'Speech synthesis is unavailable in this browser.'}</p>
            {speechBlocked && <p className="text-amber-300 text-xs">Speech may be blocked until a user interaction enables it.</p>}
            <div className="settings-actions">
              <button className="outline-button" onClick={unlockVoice}><Mic size={12} /> ENABLE VOICE ALERTS</button>
              <button className="outline-button" onClick={testVoice}>TEST VOICE</button>
            </div>
            <label className="settings-check"><input type="checkbox" checked={voice.enabled} onChange={(event) => updateVoice({ enabled: event.target.checked })} /> Voice alerts enabled</label>
            <label className="settings-check"><input type="checkbox" checked={voice.muted} onChange={(event) => updateVoice({ muted: event.target.checked })} /> Mute all voice alerts</label>
            <label className="settings-check"><input type="checkbox" checked={voice.muteNonCritical} onChange={(event) => updateVoice({ muteNonCritical: event.target.checked })} /> Mute noncritical voice alerts</label>
            <label className="settings-field"><span>Volume</span><input type="range" min={0} max={1} step={0.1} value={voice.volume} onChange={(event) => updateVoice({ volume: Number(event.target.value) })} /></label>
            <label className="settings-field"><span>Rate</span><input type="range" min={0.5} max={2} step={0.1} value={voice.rate} onChange={(event) => updateVoice({ rate: Number(event.target.value) })} /></label>
            <label className="settings-field"><span>Language</span><input value={voice.language} onChange={(event) => updateVoice({ language: event.target.value })} /></label>
            <label className="settings-field"><span>Voice</span><select value={voice.voiceName} onChange={(event) => updateVoice({ voiceName: event.target.value })}><option value="">Default voice</option>{voices.map((item) => <option value={item.name} key={item.name}>{item.name} · {item.lang}</option>)}</select></label>
            <p className="settings-help mt-3">Voice notifications are assistive only and must not be relied on for safety-critical onboard failsafe behavior.</p>
          </div>
        </section>
      </div>
    </div>
  )
}
