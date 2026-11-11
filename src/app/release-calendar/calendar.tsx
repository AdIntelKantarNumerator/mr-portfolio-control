'use client'

/**
 * The calendar itself: two months, a month, a week or a day, stepped back and
 * forward, with each release as a card on its target date (Scott, 11 November
 * 2026). The card says what, who and where; the ⓘ opens the ticket itself and
 * who to ask. The view and the day are kept in the address, so a link shows
 * what its sender saw.
 */
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  addDays,
  monthGrid,
  monthsIn,
  rangeOf,
  RELEASE_LABELS,
  statusTone,
  step,
  VIEW_LABEL,
  VIEWS,
  weekStart,
  type CalendarView,
} from '@/lib/release-rules'
import type { CalendarRelease } from '@/lib/releases'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...o })

export function ReleaseCalendar({
  releases,
  initialView,
  initialAnchor,
  today,
  highlight,
}: {
  releases: CalendarRelease[]
  initialView: CalendarView
  initialAnchor: string
  today: string
  highlight: string | null
}) {
  const router = useRouter()
  const [view, setView] = useState(initialView)
  const [anchor, setAnchor] = useState(initialAnchor)

  const go = (v: CalendarView, a: string) => {
    setView(v)
    setAnchor(a)
    const q = new URLSearchParams({ view: v, date: a })
    if (highlight) q.set('release', highlight)
    router.replace(`/release-calendar?${q}`, { scroll: false })
  }

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarRelease[]>()
    for (const r of releases) {
      if (!r.targetDate) continue
      const list = m.get(r.targetDate) ?? []
      list.push(r)
      m.set(r.targetDate, list)
    }
    return m
  }, [releases])
  const range = rangeOf(view, anchor)
  const inRange = releases.filter((r) => r.targetDate && r.targetDate >= range.from && r.targetDate <= range.to).length
  const undated = releases.filter((r) => !r.targetDate)

  const title =
    view === 'day'
      ? fmt(anchor, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : view === 'week'
        ? `${fmt(range.from, { month: 'short', day: 'numeric' })} – ${fmt(range.to, { month: 'short', day: 'numeric', year: 'numeric' })}`
        : monthsIn(view, anchor)
            .map((m) => fmt(m, { month: 'long', year: 'numeric' }))
            .join(' – ')

  return (
    <div className="rc">
      <div className="rc-bar">
        <div className="rc-nav">
          <button type="button" className="btn" onClick={() => go(view, step(view, anchor, -1))} aria-label="Back">
            ‹
          </button>
          <button type="button" className="btn" onClick={() => go(view, today)}>
            Today
          </button>
          <button type="button" className="btn" onClick={() => go(view, step(view, anchor, 1))} aria-label="Forward">
            ›
          </button>
          <h2 className="rc-title">{title}</h2>
          <span className="tx-muted">
            {inRange} release{inRange === 1 ? '' : 's'}
          </span>
        </div>
        <div className="tx-seg" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v} type="button" className={`tx-seg-btn ${view === v ? 'on' : ''}`} onClick={() => go(v, anchor)}>
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      {view === 'months' || view === 'month' ? (
        <div className={view === 'months' ? 'rc-months' : ''}>
          {monthsIn(view, anchor).map((m) => (
            <MonthGrid key={m} month={m} byDay={byDay} today={today} highlight={highlight} showName={view === 'months'} onDay={(d) => go('day', d)} />
          ))}
        </div>
      ) : view === 'week' ? (
        <div className="rc-week">
          {Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i)).map((d) => (
            <div key={d} className={`rc-wday ${d === today ? 'today' : ''}`}>
              <button type="button" className="rc-dayhead" onClick={() => go('day', d)}>
                {fmt(d, { weekday: 'short', month: 'short', day: 'numeric' })}
              </button>
              {(byDay.get(d) ?? []).map((r) => (
                <ReleaseCard key={r.linearId} r={r} highlight={highlight} brief />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="rc-day">
          {(byDay.get(anchor) ?? []).length ? (
            (byDay.get(anchor) ?? []).map((r) => <ReleaseCard key={r.linearId} r={r} highlight={highlight} wide />)
          ) : (
            <p className="tx-muted">No releases planned for this day.</p>
          )}
        </div>
      )}

      {undated.length ? (
        <div className="tile rc-undated">
          <div className="tile-head">
            <h2>No target date</h2>
            <span className="tx-muted">On the calendar once the ticket has one</span>
          </div>
          <div className="rc-undated-list">
            {undated.map((r) => (
              <ReleaseCard key={r.linearId} r={r} highlight={highlight} compact />
            ))}
          </div>
        </div>
      ) : null}
      {!releases.length ? (
        <div className="blank">
          <h2>No releases yet</h2>
          <p>Linear tickets labelled {RELEASE_LABELS.map((l) => `“${l}”`).join(', ').replace(/, ([^,]*)$/, ' or $1')} appear here with their target dates, read by Yaara each pass.</p>
        </div>
      ) : null}
    </div>
  )
}

function MonthGrid({
  month,
  byDay,
  today,
  highlight,
  showName,
  onDay,
}: {
  month: string
  byDay: Map<string, CalendarRelease[]>
  today: string
  highlight: string | null
  showName: boolean
  onDay: (d: string) => void
}) {
  return (
    <div className="rc-month">
      {showName ? <div className="rc-month-name">{fmt(month, { month: 'long', year: 'numeric' })}</div> : null}
      <div className="rc-grid" role="grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="rc-wd" role="columnheader">
            {w}
          </div>
        ))}
        {monthGrid(month)
          .flat()
          .map((d, i) =>
            d ? (
              <div key={d} className={`rc-cell ${d === today ? 'today' : ''} ${d < today ? 'past' : ''} ${byDay.has(d) ? 'has' : ''}`} role="gridcell">
                <button type="button" className="rc-num" onClick={() => onDay(d)} aria-label={fmt(d, { weekday: 'long', month: 'long', day: 'numeric' })}>
                  {Number(d.slice(8))}
                </button>
                {(byDay.get(d) ?? []).map((r) => (
                  <ReleaseCard key={r.linearId} r={r} highlight={highlight} compact />
                ))}
              </div>
            ) : (
              <div key={`x${i}`} className="rc-cell rc-out" aria-hidden />
            ),
          )}
      </div>
    </div>
  )
}

/**
 * One release, at three sizes, so no tile is very tall (Scott, 11 November
 * 2026). Month views: number, status, title and project - 76px, a day with
 * two still fits its row. Week: adds the assignee and the teams impacted; its
 * seven narrow columns made every fact a stacked line, 342px a tile. Day: all
 * of it, across the width. A click anywhere on the tile opens everything
 * (Scott, 11 November 2026: no separate ⓘ - the tile has no other click),
 * except on one of its links into the portfolio, which goes where it says.
 */
function ReleaseCard({
  r,
  highlight,
  wide = false,
  compact = false,
  brief = false,
}: {
  r: CalendarRelease
  highlight: string | null
  wide?: boolean
  compact?: boolean
  /** The week view's size: project, assignee and teams. */
  brief?: boolean
}) {
  const [info, setInfo] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const on = highlight === r.identifier
  useEffect(() => {
    if (on) box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [on])

  // A link on the tile goes where it says; anywhere else opens the popup.
  const open = (e: { target: EventTarget }) => {
    if (!(e.target as HTMLElement).closest('a')) setInfo(true)
  }

  return (
    <>
      <div
        ref={box}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-label={`${r.identifier} ${r.title}: details`}
        className={`rc-card tone-${statusTone(r.statusType)} ${on ? 'on' : ''} ${wide ? 'wide' : ''} ${compact ? 'compact' : ''} ${brief ? 'brief' : ''}`}
        id={`release-${r.identifier}`}
        title={compact || brief ? `${r.identifier} · ${r.title}` : undefined}
        onClick={open}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            setInfo(true)
          }
        }}
      >
        <div className="rc-card-head">
          <span className="rc-ident">{r.identifier}</span>
          <span className={`rc-status tone-${statusTone(r.statusType)}`}>{r.status ?? '—'}</span>
        </div>
        <div className="rc-name">{r.title}</div>
        {compact ? <div className="rc-proj">{projectOf(r)}</div> : <Facts r={r} brief={brief} />}
      </div>
      {/* Beside the tile, not in it: a click in the popup must not reach the tile and open it again. */}
      {info ? <InfoDialog r={r} onClose={() => setInfo(false)} /> : null}
    </>
  )
}

/** A link into the portfolio, styled like the popup's links: bold, the site's colour, underlined on hover. */
const portfolioLink = (href: string, name: string) => (
  <Link className="rc-link" href={href}>
    {name}
  </Link>
)

const projectOf = (r: CalendarRelease) => (r.links.project ? portfolioLink(`/projects/${r.links.project.id}`, r.links.project.name) : (r.projectName ?? '—'))

/**
 * Where it sits - objective, initiative, project, top down and linked into the
 * portfolio - then who made it, owns it and has it, and who it affects.
 */
function Facts({ r, brief = false }: { r: CalendarRelease; brief?: boolean }) {
  return (
    <dl className="rc-facts">
      {brief ? null : (
        <>
          <dt>Objective</dt>
          <dd>{r.links.objective ? portfolioLink(`/objectives/${r.links.objective.id}`, r.links.objective.name) : '—'}</dd>
          <dt>Initiative</dt>
          <dd>{r.links.initiative ? portfolioLink(`/initiatives/${r.links.initiative.id}`, r.links.initiative.name) : '—'}</dd>
        </>
      )}
      <dt>Project</dt>
      <dd>{projectOf(r)}</dd>
      {brief ? null : (
        <>
          <dt>Created by</dt>
          <dd>{r.createdBy ?? '—'}</dd>
          <dt>Project owner</dt>
          <dd>{r.projectLead ?? '—'}</dd>
        </>
      )}
      <dt>Assignee</dt>
      <dd>{r.assignee ?? 'Unassigned'}</dd>
      <dt>Teams impacted</dt>
      <dd>
        {r.teamsImpacted.length ? (
          <span className="rc-teams">
            {r.teamsImpacted.map((t) => (
              <span key={t} className="rc-team">
                {t}
              </span>
            ))}
          </span>
        ) : (
          <span className="tx-muted">None named</span>
        )}
      </dd>
    </dl>
  )
}

/** The ticket's title and full description, its Linear link, and who to ask (Scott: the assignee, else the project owner). */
function InfoDialog({ r, onClose }: { r: CalendarRelease; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="tx-family-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rc-dialog" role="dialog" aria-modal="true" aria-label={r.title}>
        <div className="tx-family-head">
          <div>
            <div className="tx-muted">{r.identifier}</div>
            <strong className="tx-total-title">{r.title}</strong>
          </div>
          <button type="button" className="tx-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="rc-dialog-body">
          <div className="rc-dialog-facts">
            <div className="rc-dialog-when">
              <span className={`rc-status tone-${statusTone(r.statusType)}`}>{r.status ?? '—'}</span>{' '}
              {r.targetDate ? fmt(r.targetDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'No target date yet'}
            </div>
            <Facts r={r} />
          </div>
          <div className="rc-desc">{r.description?.trim() || <span className="tx-muted">No description.</span>}</div>
          {r.url ? (
            <p>
              <a className="rc-link" href={r.url} target="_blank" rel="noreferrer">
                Open {r.identifier} in Linear ↗
              </a>
            </p>
          ) : null}
          {r.contactName ? (
            <p className="rc-contact">
              <strong>Questions?</strong>{' '}
              {r.contactSlackUrl ? (
                <a className="rc-link" href={r.contactSlackUrl} target="_blank" rel="noreferrer">
                  Contact {r.contactName}
                </a>
              ) : (
                <>Contact {r.contactName}</>
              )}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
