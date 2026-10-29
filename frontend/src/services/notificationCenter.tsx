import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  dismissNotification,
  fetchNotificationPolicy,
  fetchNotifications,
  fetchUnreadCount,
  markAllRead,
  markRead,
  saveNotificationPolicy,
  sendTestNotification,
  type NotificationPolicy,
  type NotificationRecord,
  type NotificationSeverity,
} from './notifications'

const WS_URL = 'ws://localhost:8000/ws/telemetry'

type VoiceSettings = {
  enabled: boolean
  unlocked: boolean
  muted: boolean
  muteNonCritical: boolean
  volume: number
  rate: number
  language: string
  voiceName: string
}

type NotificationCenterValue = {
  notifications: NotificationRecord[]
  unreadCount: number
  policy: NotificationPolicy | null
  voice: VoiceSettings
  voices: SpeechSynthesisVoice[]
  speechAvailable: boolean
  speechBlocked: boolean
  markNotificationRead: (id: string) => Promise<void>
  dismiss: (id: string) => Promise<void>
  readAll: () => Promise<void>
  refresh: () => Promise<void>
  updatePolicy: (next: NotificationPolicy) => Promise<void>
  updateVoice: (next: Partial<VoiceSettings>) => void
  unlockVoice: () => void
  testVoice: () => void
  testNotification: (severity: NotificationSeverity) => Promise<void>
  toast: NotificationRecord | null
}

const defaultVoice: VoiceSettings = {
  enabled: true,
  unlocked: false,
  muted: false,
  muteNonCritical: true,
  volume: 1,
  rate: 1,
  language: 'en-US',
  voiceName: '',
}

const NotificationCenterContext = createContext<NotificationCenterValue | null>(null)

function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem('vega.voice-settings')
    if (!raw) return defaultVoice
    return { ...defaultVoice, ...(JSON.parse(raw) as Partial<VoiceSettings>) }
  } catch {
    return defaultVoice
  }
}

function priority(value: NotificationSeverity) {
  if (value === 'CRITICAL') return 4
  if (value === 'WARNING') return 3
  if (value === 'INFORMATION') return 2
  return 1
}

export function NotificationCenterProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [policy, setPolicy] = useState<NotificationPolicy | null>(null)
  const [voice, setVoice] = useState<VoiceSettings>(() => loadVoiceSettings())
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : [],
  )
  const [speechBlocked, setSpeechBlocked] = useState(false)
  const [toast, setToast] = useState<NotificationRecord | null>(null)
  const [speechAvailable] = useState(typeof window !== 'undefined' && 'speechSynthesis' in window)
  const seenEventIds = useRef<Set<string>>(new Set())
  const queueRef = useRef<NotificationRecord[]>([])
  const speakingRef = useRef(false)
  const voiceRef = useRef(voice)
  const voicesRef = useRef(voices)
  useEffect(() => {
    voiceRef.current = voice
    voicesRef.current = voices
  }, [voice, voices])

  const refresh = async () => {
    const [items, unread, nextPolicy] = await Promise.all([fetchNotifications(false), fetchUnreadCount(), fetchNotificationPolicy()])
    setNotifications(items)
    setUnreadCount(unread.unread_count)
    setPolicy(nextPolicy)
    seenEventIds.current = new Set(items.map((item) => item.event_id))
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    localStorage.setItem('vega.voice-settings', JSON.stringify(voice))
  }, [voice])

  useEffect(() => {
    if (!speechAvailable) return
    const sync = () => setVoices(window.speechSynthesis.getVoices())
    window.speechSynthesis.onvoiceschanged = sync
    return () => { window.speechSynthesis.onvoiceschanged = null }
  }, [speechAvailable])

  const speakNext = () => {
    if (!speechAvailable || speakingRef.current || queueRef.current.length === 0) return
    queueRef.current.sort((a, b) => priority(b.severity) - priority(a.severity))
    const next = queueRef.current.shift()
    if (!next) return
    const currentVoice = voiceRef.current
    if (!currentVoice.enabled || currentVoice.muted || (!currentVoice.unlocked) || (currentVoice.muteNonCritical && next.severity !== 'CRITICAL')) return
    speakingRef.current = true
    const utterance = new SpeechSynthesisUtterance(next.voice_message || next.message)
    utterance.volume = currentVoice.volume
    utterance.rate = currentVoice.rate
    utterance.lang = currentVoice.language
    const selected = voicesRef.current.find((item) => item.name === currentVoice.voiceName)
    if (selected) utterance.voice = selected
    utterance.onend = () => { speakingRef.current = false; speakNext() }
    utterance.onerror = () => { speakingRef.current = false; setSpeechBlocked(true); speakNext() }
    try {
      window.speechSynthesis.speak(utterance)
      setSpeechBlocked(false)
    } catch {
      speakingRef.current = false
      setSpeechBlocked(true)
    }
  }

  const handleIncoming = (notification: NotificationRecord) => {
    if (seenEventIds.current.has(notification.event_id)) return
    seenEventIds.current.add(notification.event_id)
    setNotifications((previous) => [notification, ...previous])
    setUnreadCount((previous) => previous + 1)
    setToast(notification)
    window.setTimeout(() => setToast((current) => current?.id === notification.id ? null : current), 5000)
    queueRef.current.push(notification)
    speakNext()
  }
  const handleIncomingRef = useRef(handleIncoming)
  useEffect(() => {
    handleIncomingRef.current = handleIncoming
  }, [handleIncoming])

  useEffect(() => {
    const socket = new WebSocket(WS_URL)
    socket.onmessage = (event) => {
      const payload: unknown = JSON.parse(event.data)
      if (!payload || typeof payload !== 'object') return
      if ((payload as { type?: unknown }).type !== 'notification_event') return
      const notification = (payload as { payload?: NotificationRecord }).payload
      if (!notification) return
      handleIncomingRef.current(notification)
    }
    return () => socket.close()
  }, [])

  const markNotificationRead = async (id: string) => {
    await markRead(id)
    setNotifications((previous) => {
      const item = previous.find((entry) => entry.id === id)
      if (item && !item.read) setUnreadCount((count) => Math.max(0, count - 1))
      return previous.map((entry) => entry.id === id ? { ...entry, read: true } : entry)
    })
  }

  const dismiss = async (id: string) => {
    await dismissNotification(id)
    setNotifications((previous) => previous.filter((item) => item.id !== id))
  }

  const readAll = async () => {
    await markAllRead()
    setNotifications((previous) => previous.map((item) => ({ ...item, read: true })))
    setUnreadCount(0)
  }

  const updatePolicy = async (next: NotificationPolicy) => {
    const saved = await saveNotificationPolicy(next)
    setPolicy(saved)
  }

  const updateVoice = (next: Partial<VoiceSettings>) => {
    setVoice((previous) => ({ ...previous, ...next }))
  }

  const unlockVoice = () => {
    if (!speechAvailable) return
    try {
      const test = new SpeechSynthesisUtterance('')
      window.speechSynthesis.speak(test)
      setVoice((previous) => ({ ...previous, unlocked: true }))
      setSpeechBlocked(false)
    } catch {
      setSpeechBlocked(true)
    }
  }

  const testVoice = () => {
    queueRef.current.push({
      id: 'test-voice',
      event_id: `voice-test-${Date.now()}`,
      alert_type: 'VOICE_TEST',
      severity: 'INFORMATION',
      title: 'Voice test',
      message: 'Voice alert test message.',
      voice_message: 'Information. Voice alerts are enabled.',
      timestamp: new Date().toISOString(),
      source: 'simulation',
      read: true,
      acknowledged: false,
      dismissed: false,
      mission_id: null,
    })
    speakNext()
  }

  const value = {
    notifications,
    unreadCount,
    policy,
    voice,
    voices,
    speechAvailable,
    speechBlocked,
    markNotificationRead,
    dismiss,
    readAll,
    refresh,
    updatePolicy,
    updateVoice,
    unlockVoice,
    testVoice,
    testNotification: async (severity: NotificationSeverity) => {
      await sendTestNotification(severity)
      await refresh()
    },
    toast,
  }

  return <NotificationCenterContext.Provider value={value}>{children}</NotificationCenterContext.Provider>
}

export function useNotificationCenter() {
  const value = useContext(NotificationCenterContext)
  if (!value) throw new Error('useNotificationCenter must be used inside NotificationCenterProvider')
  return value
}
