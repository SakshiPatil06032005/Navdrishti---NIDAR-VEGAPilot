import { Bell, CheckCheck } from 'lucide-react'
import { useNotificationCenter } from '../services/notificationCenter'
import { NotificationItem } from './NotificationItem'

export function NotificationDropdown({ onViewAll }: { onViewAll: () => void }) {
  const { notifications, readAll, markNotificationRead, dismiss } = useNotificationCenter()
  return (
    <div className="notification-dropdown">
      <div className="notification-dropdown-header">
        <div className="flex items-center gap-2"><Bell size={14} /> Notifications</div>
        <button className="mini-button" onClick={() => void readAll()}><CheckCheck size={12} /> Mark all read</button>
      </div>
      <div className="notification-dropdown-list">
        {notifications.slice(0, 8).map((item) => (
          <NotificationItem
            key={item.id}
            item={item}
            onRead={(id) => { void markNotificationRead(id) }}
            onDismiss={(id) => { void dismiss(id) }}
          />
        ))}
        {!notifications.length && <p className="notification-empty">No notifications yet.</p>}
      </div>
      <button className="notification-view-all" onClick={onViewAll}>View all notifications</button>
    </div>
  )
}
