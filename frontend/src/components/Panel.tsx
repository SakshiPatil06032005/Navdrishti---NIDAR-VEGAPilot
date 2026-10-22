import type { ComponentType, ReactNode } from 'react'

export type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

export function Panel({
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

export function StatusDot({ color = 'green' }: { color?: 'green' | 'amber' | 'red' | 'cyan' }) {
  return <span className={`status-dot ${color}`} aria-hidden="true" />
}

export function SummaryCard({
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
  tone?: 'cyan' | 'green' | 'amber' | 'red'
}) {
  return (
    <div className="summary-card">
      <div className={`summary-icon ${tone}`}>
        <IconComponent size={19} />
      </div>
      <div className="min-w-0">
        <p className="eyebrow">{label}</p>
        <p className="mt-1 truncate text-lg font-semibold text-slate-100">{value}</p>
        <p className={`mt-1 text-[11px] ${toneDetailClass(tone)}`}>
          {detail}
        </p>
      </div>
    </div>
  )
}

function toneDetailClass(tone: 'cyan' | 'green' | 'amber' | 'red') {
  if (tone === 'green') return 'text-emerald-400'
  if (tone === 'amber') return 'text-amber-400'
  if (tone === 'red') return 'text-red-400'
  return 'text-cyan-300'
}
