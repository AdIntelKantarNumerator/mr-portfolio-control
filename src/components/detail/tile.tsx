'use client'

/**
 * The panel every section of a detail page is made of, and the bulleted list
 * that five of them share.
 *
 * WHY ONE COMPONENT FOR UPDATES, BLOCKERS, DECISIONS, ACTIONS AND DEPENDENCIES
 *
 * They are the same shape: a few recent things, each a line of text, each with
 * provenance somebody occasionally wants and nobody wants all the time. They
 * were five different cards with five layouts, five ways of showing a source
 * and five different words for "nothing here yet" — so the page had to be
 * learned section by section rather than read.
 *
 * The provenance lives in the title attribute. That is a deliberate trade:
 * it is one hover away rather than on the page, which is right for something
 * consulted in argument and ignored the rest of the time, and it costs a
 * touch-screen reader the detail. The text itself never depends on it.
 */
import Link from 'next/link'
import { useState } from 'react'
import { MisroutedButton, type Misroute } from './misrouted'
import {
  IconAction,
  IconBlocker,
  IconDecision,
  IconDependency,
  IconHealth,
  IconMilestone,
  IconProjectsTile,
  IconReadiness,
  IconUpdates,
  IconWorkstreamsTile,
} from './icons'

/**
 * Icons are named, not passed.
 *
 * These tiles are client components and most of their callers are server
 * components. A React component is a function, and a function cannot cross
 * that boundary - React refuses it with "Functions cannot be passed directly
 * to Client Components". So the caller names the icon and the lookup happens
 * on this side of the line.
 */
const ICONS = {
  action: IconAction,
  blocker: IconBlocker,
  decision: IconDecision,
  dependency: IconDependency,
  health: IconHealth,
  milestone: IconMilestone,
  projects: IconProjectsTile,
  readiness: IconReadiness,
  updates: IconUpdates,
  workstreams: IconWorkstreamsTile,
} as const

export type IconName = keyof typeof ICONS

export interface TileItem {
  id: string
  /** The line. This is the whole point of the row and carries no markup. */
  text: string
  /** Shown small, after the text — a date, a ref, an owner. */
  meta?: string | null
  /** The bullet's colour. A CSS value, usually a palette token. */
  tone?: string
  /** What the bullet means, for the hover: "blocker", "decision made". */
  toneLabel?: string
  /** Everything a reader might want to check, on hover. Sources go here. */
  detail?: string
  href?: string
  /**
   * Where this line was read from, when that is known well enough to correct.
   *
   * Present only on rows a reader could sensibly say "this is not ours" about
   * — an update Yaara attributed — and only when the source carries a channel,
   * repo or meeting to write a rule against. A bare "slack" is not something
   * anybody can correct usefully, so no button appears.
   */
  misroute?: Misroute
}

export function Tile({
  title,
  icon,
  children,
  className = '',
  right,
}: {
  title: string
  icon?: IconName
  children: React.ReactNode
  className?: string
  right?: React.ReactNode
}) {
  return (
    <section className={`tile ${className}`}>
      <div className="tile-head">
        {icon ? (() => { const I = ICONS[icon]; return <I /> })() : null}
        <h2>{title}</h2>
        {right ? <span className="tile-right">{right}</span> : null}
      </div>
      {children}
    </section>
  )
}

export function ListTile({
  title,
  icon,
  items,
  perPage = 3,
  empty,
  correctable,
}: {
  title: string
  icon?: IconName
  items: TileItem[]
  perPage?: number
  empty: string
  /** The entity this tile is on, when its rows can be corrected. */
  correctable?: { entityType: string; entityId: string }
}) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(items.length / perPage))
  // Clamped rather than reset: the list can shrink under a reader who has
  // paged into it, and landing on an empty page reads as a broken control.
  const current = Math.min(page, pages - 1)
  const shown = items.slice(current * perPage, current * perPage + perPage)

  return (
    <Tile
      title={title}
      icon={icon}
      right={
        pages > 1 ? (
          <span className="tile-page">
            <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0}>
              ← Newer
            </button>
            <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>
              Older →
            </button>
          </span>
        ) : null
      }
    >
      {items.length === 0 ? (
        <p className="tile-empty">{empty}</p>
      ) : (
        <ul className="tile-list">
          {shown.map((it) => {
            const tip = [it.toneLabel, it.detail].filter(Boolean).join(' · ')
            return (
              <li key={it.id} title={tip || undefined}>
                <i style={{ background: it.tone ?? 'var(--line-2)' }} aria-hidden="true" />
                <span className="t">
                  {it.href ? <Link href={it.href}>{it.text}</Link> : it.text}
                  {it.meta ? <em>{it.meta}</em> : null}
                  {correctable && it.misroute ? (
                    <MisroutedButton
                      item={it.misroute}
                      entityType={correctable.entityType}
                      entityId={correctable.entityId}
                      label={it.text}
                    />
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Tile>
  )
}
