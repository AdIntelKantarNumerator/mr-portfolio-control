/**
 * Timeline geometry, at whichever level you are looking.
 *
 * WHY THIS REPLACED THE OLD MODEL
 *
 * The old one knew one shape: a lane per project, a bar per workstream. That
 * made the page answer exactly one question, and the question people arrive
 * with is usually a tier up — "how do the initiatives sit against the year".
 * Everything here is expressed in terms of a ROW and the SPANS inside it, so
 * the same arithmetic draws initiatives-with-projects, projects-with-
 * workstreams, and workstreams on their own.
 *
 * Positions are percentages of the horizon, so the same model renders at any
 * width without re-computing.
 *
 * WHY THE COLOURS ARE THREE AND NOT FOUR
 *
 * Green on track, red in trouble, blue finished. There is deliberately no
 * fourth "nothing known" colour: a bar drawn in a fourth shade said "Yaara has
 * not assessed this yet", which is a fact about the tooling rather than about
 * the work, and it made a third of the chart grey. Unassessed work draws
 * green — the same as on track — and anything assessed red or amber draws red,
 * because "in trouble" is one state to a reader scanning a year at a glance.
 */

export type Health = 'good' | 'crit' | 'done'

export interface TimelineColumn {
  key: string
  label: string
  quarterLabel: string
  quarterStart: boolean
  start: Date
  end: Date
}

/** One bar: a piece of work inside a row. */
export interface Span {
  id: string
  name: string
  href: string | null
  leftPct: number
  widthPct: number
  health: Health
  status: string
  clippedStart: boolean
  clippedEnd: boolean
  /**
   * Which sub-lane inside the row this bar sits on.
   *
   * Two workstreams running over the same fortnight used to draw on top of
   * each other, so a row of six overlapping bars showed one name and five
   * slivers. Bars are packed into the first lane they fit in, which is the
   * standard way and keeps the common case — work that does not overlap — to
   * a single line.
   */
  lane: number
}

/** One diamond. Rolled up from everything beneath the row. */
export interface Mark {
  id: string
  name: string
  leftPct: number
  health: Health
  at: string
}

export interface TimelineRow {
  id: string
  name: string
  href: string
  status: string
  /** The hand-arranged position, for the Custom sort. */
  rank: number
  /** How much has happened lately, for the Active and Quiet sorts. */
  activity: number
  bars: Span[]
  marks: Mark[]
  /** How many sub-lanes the bars needed. At least one, so the row has height. */
  lanes: number
  /** Children with no dates at all: counted nowhere, but the row still draws. */
  undated: number
}

/** A dependency, as a line from where one row ends to where another begins. */
export interface Link {
  id: string
  fromRow: string
  fromPct: number
  toRow: string
  toPct: number
  /** The delivering end is not going to make the required date. */
  late: boolean
  label: string
}

export interface TimelineModel {
  start: Date
  end: Date
  columns: TimelineColumn[]
  rows: TimelineRow[]
  todayPct: number | null
  links: Link[]
}

const MS = 86_400_000

export function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

export function addMonths(d: Date, n: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
}

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })

export function buildColumns(start: Date, end: Date): TimelineColumn[] {
  const cols: TimelineColumn[] = []
  let cursor = startOfMonth(start)
  const limit = startOfMonth(end)
  // Guard against a mis-set horizon producing an unbounded loop.
  for (let i = 0; i < 120 && cursor <= limit; i++) {
    const next = addMonths(cursor, 1)
    const q = Math.floor(cursor.getUTCMonth() / 3) + 1
    cols.push({
      key: cursor.toISOString().slice(0, 7),
      label: MONTH_LABEL.format(cursor),
      quarterLabel: `Q${q} '${String(cursor.getUTCFullYear()).slice(2)}`,
      quarterStart: cursor.getUTCMonth() % 3 === 0,
      start: cursor,
      end: new Date(next.getTime() - 1),
    })
    cursor = next
  }
  return cols
}

export function pct(date: Date, start: Date, span: number) {
  return ((date.getTime() - start.getTime()) / span) * 100
}

/**
 * The colour a piece of work draws in.
 *
 * Finished beats everything: a completed workstream that was red the week
 * before it landed is not a problem, and drawing it red is how a chart of a
 * delivered quarter still looks like a disaster.
 */
export function healthOf(status: string, rag: string | null | undefined): Health {
  if (status === 'completed' || status === 'complete' || status === 'done') return 'done'
  if (rag === 'red' || rag === 'amber') return 'crit'
  return 'good'
}

/** A milestone's colour, which has one extra way of being in trouble. */
export function markHealth(status: string, target: Date | null, now: Date): Health {
  if (status === 'complete' || status === 'done') return 'done'
  // Overdue is trouble whatever anybody has assessed: the date has passed and
  // the thing has not happened, which is not a matter of opinion.
  if (target && target < now) return 'crit'
  if (status === 'blocked' || status === 'at_risk' || status === 'missed') return 'crit'
  return 'good'
}

export interface SourceChild {
  id: string
  name: string
  href: string | null
  status: string
  rag: string | null
  startDate: Date | null
  targetDate: Date | null
}

export interface SourceMark {
  id: string
  name: string
  status: string
  targetDate: Date | null
}

export interface SourceRow {
  id: string
  name: string
  href: string
  status: string
  rank: number
  activity: number
  children: SourceChild[]
  marks: SourceMark[]
}

/**
 * Turn rows of work into rows of geometry.
 *
 * `start`/`end` are the horizon. Anything entirely outside it is dropped
 * rather than clamped to the edge — a bar pinned to the left margin reads as
 * work starting now, which is the opposite of the truth.
 */
export function buildTimeline(
  source: SourceRow[],
  opts: { start: Date; end: Date; now?: Date; deps?: DepInput[] },
): TimelineModel {
  const now = opts.now ?? new Date()
  const start = startOfMonth(opts.start)
  const end = addMonths(startOfMonth(opts.end), 1)
  const span = end.getTime() - start.getTime()
  const columns = buildColumns(start, opts.end)

  const at = (d: Date) => pct(d, start, span)

  const rows: TimelineRow[] = source.map((row) => {
    const bars: Span[] = []
    let undated = 0

    for (const child of row.children) {
      const s = child.startDate ?? child.targetDate
      const e = child.targetDate ?? child.startDate
      if (!s || !e) {
        undated++
        continue
      }

      const from = new Date(Math.min(s.getTime(), e.getTime()))
      // A single-day range renders as a hairline, so every bar gets at least a
      // few days of width. A one-day piece of work still has to be visible.
      const to = new Date(Math.max(s.getTime(), e.getTime(), from.getTime() + 5 * MS))

      const left = Math.max(0, at(from))
      const right = Math.min(100, at(to))
      if (right <= 0 || left >= 100) continue

      bars.push({
        id: child.id,
        name: child.name,
        href: child.href,
        leftPct: left,
        widthPct: Math.max(1.2, right - left),
        health: healthOf(child.status, child.rag),
        status: child.status,
        clippedStart: from < start,
        clippedEnd: to > end,
        lane: 0,
      })
    }

    const marks: Mark[] = []
    for (const m of row.marks) {
      if (!m.targetDate) continue
      const p = at(m.targetDate)
      if (p < 0 || p > 100) continue
      marks.push({
        id: m.id,
        name: m.name,
        leftPct: p,
        health: markHealth(m.status, m.targetDate, now),
        at: m.targetDate.toISOString().slice(0, 10),
      })
    }

    bars.sort((a, b) => a.leftPct - b.leftPct)
    marks.sort((a, b) => a.leftPct - b.leftPct)
    const lanes = packLanes(bars)

    return {
      id: row.id,
      name: row.name,
      href: row.href,
      status: row.status,
      rank: row.rank,
      activity: row.activity,
      bars,
      marks,
      lanes,
      undated,
    }
  })

  const todayRaw = at(now)
  const todayPct = todayRaw >= 0 && todayRaw <= 100 ? todayRaw : null

  return { start, end, columns, rows, todayPct, links: buildLinks(opts.deps ?? [], rows) }
}

/**
 * Put each bar on the first lane where it does not touch its neighbour.
 *
 * A gap is left between bars on the same lane — `GAP` percent of the horizon —
 * because two bars that merely abut read as one long bar, and the label of the
 * second is the first thing to go.
 *
 * Mutates `bars` (which the caller has just built) rather than returning a
 * copy: this is the last step of building them, and a second array of the same
 * objects would be one more thing to keep in step.
 */
const GAP = 0.6

function packLanes(bars: Span[]): number {
  const ends: number[] = []
  for (const bar of bars) {
    let lane = ends.findIndex((end) => bar.leftPct >= end + GAP)
    if (lane === -1) {
      lane = ends.length
      ends.push(0)
    }
    ends[lane] = bar.leftPct + bar.widthPct
    bar.lane = lane
  }
  return Math.max(1, ends.length)
}

export interface DepInput {
  id: string
  /** The row each end belongs to AT THE LEVEL BEING SHOWN, not its own level. */
  fromRow: string | null
  toRow: string | null
  fromAt: Date | null
  toAt: Date | null
  late: boolean
  label: string
}

/**
 * Dependencies as lines between rows.
 *
 * Only drawn when both ends are on screen. A line to somewhere off the chart
 * is a line pointing at the edge of the page, which tells a reader there is
 * something they cannot see without telling them what.
 */
function buildLinks(deps: DepInput[], rows: TimelineRow[]): Link[] {
  const known = new Set(rows.map((r) => r.id))
  const out: Link[] = []
  for (const d of deps) {
    if (!d.fromRow || !d.toRow || !known.has(d.fromRow) || !known.has(d.toRow)) continue
    if (d.fromRow === d.toRow) continue
    const from = rows.find((r) => r.id === d.fromRow)!
    const to = rows.find((r) => r.id === d.toRow)!
    // The right-hand end of what is delivering, and the left-hand end of what
    // is waiting: that is the shape of the sentence the line is drawing.
    const fromPct = from.bars.length ? Math.max(...from.bars.map((b) => b.leftPct + b.widthPct)) : null
    const toPct = to.bars.length ? Math.min(...to.bars.map((b) => b.leftPct)) : null
    if (fromPct === null || toPct === null) continue
    out.push({ id: d.id, fromRow: d.fromRow, fromPct, toRow: d.toRow, toPct, late: d.late, label: d.label })
  }
  return out
}
