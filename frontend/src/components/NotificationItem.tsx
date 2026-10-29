import { AlertOctagon, AlertTriangle, Bell, CheckCircle2, Info, X } from 'lucide-react'
import type { NotificationRecord } from '../services/notifications'

const severityMeta = {
  CRITICAL: { icon: AlertOctagon, className: 'text-red-400' },
  WARNING: { icon: AlertTriangle, className: 'text-amber-400' },
  INFORMATION: { icon: Info, className: 'text-cyan-300' },
  SUCCESS: { icon: CheckCircle2, className: 'text-emerald-400' },
} as const

export function NotificationItem({
  item,
  onRead,
  onDismiss,
}: {
  item: NotificationRecord
  onRead: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const meta = severityMeta[item.severity] ?? { icon: Bell, className: 'text-slate-300' }
  const Icon = meta.icon
  return (
    <article className={`notification-item ${item.read ? 'read' : 'unread'}`}>
      <div className={`notification-icon ${meta.className}`}><Icon size={15} /></div>
      <div className="notification-content">
        <div className="notification-title-row">
          <strong>{item.title}</strong>
          <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
        </div>
        <p>{item.message}</p>
        <small>{item.source.toUpperCase()} · {item.severity}</small>
      </div>
      <div className="notification-actions">
        {!item.read && <button className="mini-button" onClick={() => onRead(item.id)}>Read</button>}
        <button className="mini-button icon-only" onClick={() => onDismiss(item.id)} aria-label="Dismiss notification"><X size={12} /></button>
      </div>
    </article>
  )
}
