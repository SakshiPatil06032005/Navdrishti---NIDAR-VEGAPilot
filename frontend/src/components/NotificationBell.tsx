import { Bell } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNotificationCenter } from '../services/notificationCenter'
import { NotificationDropdown } from './NotificationDropdown'

export function NotificationBell({ onViewAll }: { onViewAll: () => void }) {
  const { unreadCount } = useNotificationCenter()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (!rootRef.current) return
      if (event.target instanceof Node && rootRef.current.contains(event.target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [])

  return (
    <div className="notification-bell" ref={rootRef}>
      <button className="notification-bell-button" onClick={() => setOpen((value) => !value)} aria-label="Open notifications">
        <Bell size={17} className="text-slate-300" />
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && <NotificationDropdown onViewAll={() => { setOpen(false); onViewAll() }} />}
    </div>
  )
}
