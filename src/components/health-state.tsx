'use client'

/**
 * How a piece of work is doing, drawn the same way everywhere.
 *
 * This replaces the completion ring, which four screens drew and none of them
 * could justify: the number behind it never came from anybody counting
 * anything. See lib/card-health.ts for the full history and what is here
 * instead.
 *
 * Two shapes, one vocabulary. The board's cards have room for the state and
 * every reason behind it; a list row has room for the state and the first
 * one, with the rest on the hover. Neither invents a figure to fill the
 * space where the ring used to be — an empty corner is better than a
 * confident wrong number, and the reasons are more use than either.
 */
import { HEALTH_LABEL, stateColor, type Health, type Reason } from '@/lib/card-health'

const REASON_TONE: Record<Reason['tone'], string> = {
  crit: 'var(--crit)',
  warn: 'var(--warn)',
  muted: 'var(--muted)',
}

/** The card's panel: the state, then every reason for it. */
export function HealthPanel({ health, reasons }: { health: Health; reasons: Reason[] }) {
  return (
    <div className="hstate">
      <span className="hstate-word" style={{ color: stateColor(health) }}>
        <i style={{ background: stateColor(health) }} aria-hidden="true" />
        {HEALTH_LABEL[health]}
      </span>
      <ul className="hstate-why">
        {reasons.map((r) => (
          <li key={r.text} style={{ color: REASON_TONE[r.tone] }}>
            {r.text}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A list row's cell: the state, and the first reason under it. */
export function HealthDot({ health, reasons }: { health: Health | null; reasons: Reason[] }) {
  if (!health) {
    return (
      <span className="ir-noring" title="Nothing assessed yet">
        –
      </span>
    )
  }
  const all = reasons.map((r) => r.text).join(' · ')
  return (
    <span className="hdot" title={all || undefined}>
      <span className="hdot-word" style={{ color: stateColor(health) }}>
        <i style={{ background: stateColor(health) }} aria-hidden="true" />
        {HEALTH_LABEL[health]}
      </span>
      {reasons[0] ? (
        <span className="hdot-why" style={{ color: REASON_TONE[reasons[0].tone] }}>
          {reasons[0].text}
        </span>
      ) : null}
    </span>
  )
}
