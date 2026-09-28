'use client'

/**
 * The timeline, drawn.
 *
 * WHAT IS ON IT NOW
 *
 * One row per initiative, project or workstream, whichever you asked for, and
 * inside each row a bar for every child beneath it. Rolled-up milestones sit
 * on the row as diamonds, so an initiative shows what its projects have
 * committed to without anybody opening them.
 *
 * WHY THE DEPENDENCY LINES CAN BE TURNED OFF
 *
 * They are the most useful thing on the chart in the week you are untangling a
 * slip, and the noisiest thing on it every other week. So they draw, and they
 * have a switch.
 *
 * WHY DRAGGING IS ONLY OFFERED UNDER THE CUSTOM SORT
 *
 * Under any other sort the order is computed, so a dragged row would spring
 * back on the next render — which is worse than not offering it. Same rule,
 * and the same storage, as the home board.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Link as DepLink, TimelineModel, TimelineRow } from '@/lib/timeline-model'
import { moveCard, dropsBelow } from '@/lib/reorder'
import { setCardOrder } from '@/app/order-actions'

/*
 * Row height is not fixed any more: a row whose bars overlap needs a lane for
 * each of them, and the alternative — drawing them on top of one another — is
 * how a row of six workstreams showed one name and five slivers.
 */
const LANE_H = 30
const ROW_PAD = 14

/** The height of one row, and the top of each, so the links can find them. */
function layout(rows: TimelineRow[]) {
  const tops = new Map<string, number>()
  const heights = new Map<string, number>()
  let y = 0
  for (const r of rows) {
    const h = r.lanes * LANE_H + ROW_PAD
    tops.set(r.id, y)
    heights.set(r.id, h)
    y += h
  }
  return { tops, heights, total: y }
}

export function TimelineView({
  model,
  level,
  draggable,
  showLinks,
}: {
  model: TimelineModel
  level: 'initiative' | 'project' | 'workstream'
  draggable: boolean
  showLinks: boolean
}) {
  const [order, setOrder] = useState<string[] | null>(null)
  const [held, setHeld] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The order the server sent, remembered so a change of level drops any local
  // arrangement rather than applying it to a different list.
  const serverIds = model.rows.map((r) => r.id).join(',')
  const [seenIds, setSeenIds] = useState(serverIds)
  if (serverIds !== seenIds) {
    setSeenIds(serverIds)
    setOrder(null)
  }

  const byId = useMemo(() => new Map(model.rows.map((r) => [r.id, r])), [model.rows])
  const rows = order ? (order.map((id) => byId.get(id)).filter(Boolean) as TimelineRow[]) : model.rows

  function move(fromId: string, toId: string) {
    const was = rows.map((r) => r.id)
    const next = moveCard(was, fromId, toId)
    if (next === was) return
    setOrder(next)
    setError(null)
    void setCardOrder(level, next)
      .then((r) => setError(r.error ?? null))
      .catch(() => setError('The new order could not be saved.'))
  }

  const { tops, heights, total } = layout(rows)

  return (
    <>
      {error ? <p className="dragnote"><b>{error}</b></p> : null}

      <div className="tl">
        <div className="tl-head">
          <div className="tl-names" />
          <div className="tl-cols">
            {model.columns.map((c) => (
              <div key={c.key} className={c.quarterStart ? 'tl-col q' : 'tl-col'}>
                <b>{c.label}</b>
                {c.quarterStart ? <em>{c.quarterLabel}</em> : null}
              </div>
            ))}
          </div>
        </div>

        <div className="tl-body">
          <div className="tl-names">
            {rows.map((r) => (
              <div
                key={r.id}
                className={[
                  'tl-name',
                  held === r.id ? 'held' : '',
                  over === r.id && held && held !== r.id
                    ? dropsBelow(rows.map((x) => x.id), held, r.id)
                      ? 'over-below'
                      : 'over-above'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ height: heights.get(r.id) }}
                onDragOver={(e) => {
                  if (!draggable || !held) return
                  e.preventDefault()
                  setOver(r.id)
                }}
                onDrop={(e) => {
                  if (!draggable || !held) return
                  e.preventDefault()
                  move(held, r.id)
                  setHeld(null)
                  setOver(null)
                }}
              >
                {draggable && (
                  // To the left of the name, exactly where a hand reaches for
                  // a row, and nowhere near the link.
                  <span
                    className="tl-grip"
                    draggable
                    onDragStart={(e) => {
                      setHeld(r.id)
                      e.dataTransfer.effectAllowed = 'move'
                      // Firefox refuses to start a drag with an empty payload.
                      e.dataTransfer.setData('text/plain', r.id)
                    }}
                    onDragEnd={() => {
                      setHeld(null)
                      setOver(null)
                    }}
                    title={`Drag ${r.name} to reorder`}
                    aria-label={`Drag ${r.name} to reorder`}
                  />
                )}
                <Link href={r.href} title={r.name}>
                  {r.name}
                </Link>
              </div>
            ))}
          </div>

          <div className="tl-plot" style={{ height: total }}>
            <div className="tl-grid">
              {model.columns.map((c) => (
                <span key={c.key} className={c.quarterStart ? 'q' : undefined} />
              ))}
            </div>

            {model.todayPct !== null && (
              <span className="tl-today" style={{ left: `${model.todayPct}%` }} title="Today" />
            )}

            {showLinks && <Links links={model.links} tops={tops} heights={heights} height={total} />}

            {rows.map((r) => (
              <div key={r.id} className="tl-row" style={{ top: tops.get(r.id), height: heights.get(r.id) }}>
                {r.bars.map((b) => (
                  <BarView key={b.id} bar={b} />
                ))}
                {/* Milestones sit on a strip of their own under the bars, so a
                    diamond never lands on a label. */}
                {r.marks.map((m) => (
                  <span
                    key={m.id}
                    className={`tl-mark tl-${m.health}`}
                    style={{ left: `${m.leftPct}%`, top: r.lanes * LANE_H + 1 }}
                    title={`${m.name} — ${m.at}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function BarView({ bar }: { bar: TimelineModel['rows'][number]['bars'][number] }) {
  // The POSITION goes on the outer element, whichever it is. An earlier
  // version wrapped each bar in a full-width link, so every bar's link covered
  // the whole row and only the last one drawn could be clicked.
  const className = [
    'tl-bar',
    `tl-${bar.health}`,
    bar.clippedStart ? 'clip-s' : '',
    bar.clippedEnd ? 'clip-e' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const style = { left: `${bar.leftPct}%`, width: `${bar.widthPct}%`, top: bar.lane * LANE_H + 5 }
  const title = `${bar.name} — ${bar.status}`

  return bar.href ? (
    <Link href={bar.href} className={className} style={style} title={title}>
      <em>{bar.name}</em>
    </Link>
  ) : (
    <span className={className} style={style} title={title}>
      <em>{bar.name}</em>
    </span>
  )
}

/**
 * The dependency lines.
 *
 * Drawn as an SVG overlay rather than as positioned divs: a line between two
 * arbitrary rows is a path, and expressing a path in CSS boxes is how you end
 * up with something that looks right at one row count and wrong at every
 * other. The elbow — out, across, in — keeps a long line from cutting
 * diagonally through every bar between its ends.
 */
function Links({
  links,
  tops,
  heights,
  height,
}: {
  links: DepLink[]
  tops: Map<string, number>
  heights: Map<string, number>
  height: number
}) {
  if (links.length === 0) return null
  const y = (id: string) => (tops.get(id) ?? 0) + (heights.get(id) ?? 0) / 2

  return (
    <svg className="tl-links" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {links.map((l) => {
        if (!tops.has(l.fromRow) || !tops.has(l.toRow)) return null
        const y1 = y(l.fromRow)
        const y2 = y(l.toRow)
        // Out of the delivering bar, down or up to the waiting row, then in.
        const mid = (l.fromPct + l.toPct) / 2
        return (
          <path
            key={l.id}
            d={`M ${l.fromPct} ${y1} L ${mid} ${y1} L ${mid} ${y2} L ${l.toPct} ${y2}`}
            className={l.late ? 'tl-link late' : 'tl-link'}
            vectorEffect="non-scaling-stroke"
          >
            <title>{l.label}</title>
          </path>
        )
      })}
    </svg>
  )
}
