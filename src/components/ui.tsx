/**
 * Shared presentational primitives.
 *
 * Every view composes these rather than styling from scratch, so a health
 * colour or a provenance badge means exactly one thing everywhere in the app.
 */
import type { ReactNode } from 'react'
import { label as vocab, type Rag, type ResolvedHealth } from '@/lib/domain'
import { fmtDate } from '@/lib/util'

export type Tone = 'green' | 'amber' | 'red' | 'violet' | 'blue' | 'slate' | 'accent'

export function Card({
  children,
  className = '',
  tone,
  ...rest
}: {
  children: ReactNode
  className?: string
  tone?: 'default' | 'alert' | 'good'
} & React.HTMLAttributes<HTMLDivElement>) {
  const accent =
    tone === 'alert'
      ? 'border-l-4'
      : tone === 'good'
        ? 'border-l-4'
        : ''
  const style =
    tone === 'alert'
      ? { borderLeftColor: 'var(--red)' }
      : tone === 'good'
        ? { borderLeftColor: 'var(--accent)' }
        : undefined
  return (
    <div className={`card p-4 sm:p-5 ${accent} ${className}`} style={style} {...rest}>
      {children}
    </div>
  )
}

export function CardHeading({
  title,
  sub,
  right,
}: {
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {sub ? (
          <p className="m-0 mt-1 text-[12px]" style={{ color: 'var(--muted)' }}>
            {sub}
          </p>
        ) : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  )
}

export function Kicker({ children }: { children: ReactNode }) {
  return (
    <div
      className="text-[11px] font-bold uppercase tracking-[0.06em]"
      style={{ color: 'var(--brand-2)' }}
    >
      {children}
    </div>
  )
}

export function Pill({
  tone = 'slate',
  children,
  title,
}: {
  tone?: Tone
  children: ReactNode
  title?: string
}) {
  return (
    <span className={`pill tone-${tone}`} title={title}>
      {children}
    </span>
  )
}

export function Chip({
  tone = 'slate',
  children,
  title,
}: {
  tone?: Tone
  children: ReactNode
  title?: string
}) {
  return (
    <span className={`chip tone-${tone}`} title={title}>
      {children}
    </span>
  )
}

export const RAG_TONE: Record<Rag, Tone> = {
  green: 'green',
  amber: 'amber',
  red: 'red',
  unknown: 'slate',
}

export function RagDot({ rag, title }: { rag: Rag; title?: string }) {
  return <span className={`rag-dot bg-rag-${rag}`} title={title ?? vocab('rag', rag)} />
}

/**
 * Health badge that always says where the judgement came from.
 *
 * The origin is not decoration. "Amber because a person looked on Tuesday" and
 * "amber because a field in Linear says so" support very different decisions,
 * and conflating them is how a portfolio view loses its audience.
 */
export function HealthBadge({ health, showOrigin = true }: { health: ResolvedHealth; showOrigin?: boolean }) {
  const tone = RAG_TONE[health.rag]
  const origin =
    health.origin === 'assessed'
      ? `Assessed${health.asOf ? ` ${fmtDate(health.asOf)}` : ''}`
      : health.origin === 'source'
        ? 'From source'
        : 'No assessment'

  const tip = [
    vocab('rag', health.rag),
    health.rationale,
    health.evidence ? `Evidence: ${health.evidence}` : null,
    origin,
    health.conflict ? 'The source system disagrees with this assessment.' : null,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <span className="inline-flex items-center gap-1.5" title={tip}>
      <Pill tone={tone}>
        <RagDot rag={health.rag} />
        {vocab('rag', health.rag)}
      </Pill>
      {showOrigin && health.origin !== 'assessed' ? (
        <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
          {health.origin === 'source' ? 'source' : 'needs input'}
        </span>
      ) : null}
      {health.conflict ? (
        <span title="The source system reports a different health than the assessment.">
          <Chip tone="violet">conflict</Chip>
        </span>
      ) : null}
    </span>
  )
}

/** Marks a value that came from a synced system rather than being typed here. */
export function SourceBadge({ system, url }: { system: string; url?: string | null }) {
  const body = (
    <span
      className="inline-flex items-center rounded-[5px] border px-1.5 py-px text-[9.5px] font-bold"
      style={{
        color: 'var(--accent)',
        background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
        borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)',
      }}
      title={`Synced from ${vocab('sourceSystem', system)}`}
    >
      {vocab('sourceSystem', system)}
    </span>
  )
  if (!url) return body
  return (
    <a href={url} target="_blank" rel="noreferrer" className="hover:opacity-80">
      {body}
    </a>
  )
}

/** Marks a field a human overrode on top of the synced value. */
export function OverrideBadge({ fields, reasons }: { fields: string[]; reasons?: Record<string, string | null> }) {
  if (fields.length === 0) return null
  const tip = fields
    .map((f) => `${f}${reasons?.[f] ? `: ${reasons[f]}` : ''}`)
    .join('\n')
  return (
    <Chip tone="violet" title={`Edited here, overriding the source.\n${tip}`}>
      edited · {fields.length}
    </Chip>
  )
}

export function GapFlag({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <Chip tone="violet" title={title}>
      {children}
    </Chip>
  )
}

export function Stat({
  value,
  label,
  tone,
  sub,
}: {
  value: ReactNode
  label: ReactNode
  tone?: Tone
  sub?: ReactNode
}) {
  const color =
    tone === 'red'
      ? 'var(--red)'
      : tone === 'amber'
        ? 'var(--amber)'
        : tone === 'green'
          ? 'var(--green)'
          : 'var(--brand)'
  return (
    <div className="card p-4">
      <div className="text-[23px] font-bold leading-tight" style={{ color }}>
        {value}
      </div>
      <div className="mt-0.5 text-[12px]" style={{ color: 'var(--muted)' }}>
        {label}
      </div>
      {sub ? (
        <div className="mt-1.5 text-[11.5px]" style={{ color: 'var(--muted)' }}>
          {sub}
        </div>
      ) : null}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-lg border border-dashed px-4 py-6 text-center text-[12.5px]"
      style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
    >
      {children}
    </div>
  )
}

export function Muted({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`text-[12px] ${className}`} style={{ color: 'var(--muted)' }}>
      {children}
    </span>
  )
}

export function ProgressBar({ value, tone = 'blue' }: { value: number; tone?: Tone }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  const color =
    tone === 'red' ? 'var(--red)' : tone === 'amber' ? '#d97706' : tone === 'green' ? 'var(--green)' : 'var(--brand-2)'
  return (
    <span className="inline-flex items-center gap-2" title={`${pct}% complete`}>
      <span
        className="inline-block h-1.5 w-16 overflow-hidden rounded-full"
        style={{ background: 'var(--line)' }}
      >
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="text-[10.5px] tabular-nums" style={{ color: 'var(--muted)' }}>
        {pct}%
      </span>
    </span>
  )
}

export function SectionNote({ tone = 'amber', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div
      className={`tone-${tone} mb-2 rounded-md border px-3 py-1.5 text-[11.5px]`}
      style={{ borderColor: 'currentColor' }}
    >
      {children}
    </div>
  )
}
