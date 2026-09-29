/**
 * Timeline geometry, at whichever level you are looking.
 *
 * WHY THIS REPLACED THE OLD MODEL
 *
 * The old one knew one shape: a lane per initiative, a bar per project. That
 * made the page answer exactly one question, and the question people arrive
 * with is usually a tier up — "how do the objectives sit against the year".
 * Everything here is expressed in terms of a ROW and the SPANS inside it, so
 * the same arithmetic draws objectives-with-initiatives, initiatives-with-
 * projects, and projects on their own.
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

/**
 * Five states, because four of them are decisions somebody could act on and
 * the fifth is the absence of one.
 *
 *   done    finished, and no longer anybody's problem
 *   late    the date has passed and it has not happened
 *   risk    assessed as in trouble, but the date has not passed yet
 *   planned committed to, not started
 *   good    running, and nothing says otherwise
 *
 * `late` and `risk` were one colour, which is the distinction that matters
 * most on a chart of a year: a thing that is going to be late and a thing
 * that already is call for different conversations, and painting both red
 * means the second is never found among the first.
 */
export type Health = 'good' | 'risk' | 'late' | 'planned' | 'done'

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
   * Two projects running over the same fortnight used to draw on top of
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

/** A dependency, as a line from where one bar ends to where another begins. */
export interface Link {
  id: string
  fromRow: string
  fromPct: number
  toRow: string
  toPct: number
  /**
   * Which sub-lane inside each row the line leaves from and arrives at.
   *
   * A row can be several bars deep, and two ends of one dependency are
   * regularly two bars of the SAME row — two initiatives inside one objective,
   * looked at from the objective level. Without the lane the line would be
   * drawn from the middle of a row to the middle of the same row, which is a
   * dot.
   */
  fromLane: number
  toLane: number
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

const DONE = new Set(['completed', 'complete', 'done', 'closed', 'canceled', 'cancelled', 'shipped'])
const NOT_STARTED = new Set(['planned', 'backlog', 'pending', 'not_started', 'proposed', 'draft'])
const TROUBLE = new Set(['blocked', 'at_risk', 'missed', 'paused'])

/**
 * The colour a piece of work draws in.
 *
 * The order is the whole rule, and each step earns its place:
 *
 *   1. Finished beats everything. A project that was red the week before
 *      it landed is not a problem, and drawing it red is how a chart of a
 *      delivered quarter still looks like a disaster.
 *   2. Then overdue, which is not a matter of opinion: the date has passed
 *      and the thing has not happened.
 *   3. Then what somebody assessed — in trouble, but there is still time.
 *   4. Then not started, which is not the same as on track and was being
 *      drawn as though it were.
 */
export function healthOf(
  status: string,
  rag: string | null | undefined,
  target?: Date | null,
  now?: Date,
): Health {
  const state = (status ?? '').toLowerCase()
  if (DONE.has(state)) return 'done'
  if (target && now && target < now) return 'late'
  if (rag === 'red' || rag === 'amber' || TROUBLE.has(state)) return 'risk'
  if (NOT_STARTED.has(state)) return 'planned'
  return 'good'
}

/** A milestone, by the same rule. Its status vocabulary is its own. */
export function markHealth(status: string, target: Date | null, now: Date): Health {
  return healthOf(status, null, target, now)
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
        health: healthOf(child.status, child.rag, child.targetDate, now),
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
  /**
   * The thing each end actually points at.
   *
   * The row is where it is drawn; this is what it IS. They differ whenever the
   * chart is showing a tier above the dependency's own — which is most of the
   * time — and the difference is what lets a line find the right bar instead
   * of the whole row.
   */
  fromId?: string
  toId?: string
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
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out: Link[] = []

  for (const d of deps) {
    if (!d.fromRow || !d.toRow) continue
    const from = byId.get(d.fromRow)
    const to = byId.get(d.toRow)
    if (!from || !to) continue

    // The specific bar, when the row draws one for that end. A dependency
    // between two initiatives of one objective is two bars of one row, and
    // resolving only as far as the row made it a line from something to
    // itself — which the old code then dropped, so the line simply never
    // appeared. It is the commonest shape there is: work inside one objective
    // waiting on other work inside it.
    const a = d.fromId ? from.bars.find((b) => b.id === d.fromId) : undefined
    const z = d.toId ? to.bars.find((b) => b.id === d.toId) : undefined

    // Still nothing to join if both ends land on the same bar.
    if (a && z && a.id === z.id) continue
    if (!a && !z && d.fromRow === d.toRow) continue

    // The right-hand end of what is delivering, and the left-hand end of what
    // is waiting: that is the shape of the sentence the line is drawing.
    const fromPct = a
      ? a.leftPct + a.widthPct
      : from.bars.length
        ? Math.max(...from.bars.map((b) => b.leftPct + b.widthPct))
        : null
    const toPct = z ? z.leftPct : to.bars.length ? Math.min(...to.bars.map((b) => b.leftPct)) : null
    if (fromPct === null || toPct === null) continue

    out.push({
      id: d.id,
      fromRow: d.fromRow,
      fromPct,
      fromLane: a?.lane ?? 0,
      toRow: d.toRow,
      toPct,
      toLane: z?.lane ?? 0,
      late: d.late,
      label: d.label,
    })
  }
  return out
}
