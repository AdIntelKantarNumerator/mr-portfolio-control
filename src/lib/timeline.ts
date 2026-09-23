/**
 * Timeline geometry.
 *
 * Kept out of the component so the arithmetic that decides where a bar lands
 * is testable and stated once. Everything is expressed as a percentage of the
 * horizon, so the same model renders at any width without re-computing.
 */
import type { InitiativeView, Portfolio, ProjectView, MilestoneRow } from './portfolio'
import type { Rag } from './domain'

export interface TimelineColumn {
  key: string
  label: string
  quarterLabel: string
  /** First column of its quarter — drives the heavier gridline. */
  quarterStart: boolean
  start: Date
  end: Date
}

export interface TimelineBar {
  project: ProjectView
  leftPct: number
  widthPct: number
  /** No usable dates: rendered as a hatched placeholder, not a confident bar. */
  undated: boolean
  /** Clipped at the horizon edge — the bar continues beyond the view. */
  clippedStart: boolean
  clippedEnd: boolean
  rag: Rag
}

export interface TimelineMilestone {
  milestone: MilestoneRow
  projectName: string
  leftPct: number
  overdue: boolean
}

export interface TimelineLane {
  initiative: InitiativeView
  bars: TimelineBar[]
  milestones: TimelineMilestone[]
  /** Projects with no dates at all, listed rather than drawn. */
  undatedProjects: ProjectView[]
}

export interface TimelineModel {
  start: Date
  end: Date
  columns: TimelineColumn[]
  lanes: TimelineLane[]
  todayPct: number | null
  /** Portfolio-level dates for the strip under the chart. */
  keyDates: TimelineMilestone[]
}

const MS = 86_400_000

function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function addMonths(d: Date, n: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
}

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })

function buildColumns(start: Date, end: Date): TimelineColumn[] {
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

function pct(date: Date, start: Date, span: number) {
  return ((date.getTime() - start.getTime()) / span) * 100
}

/**
 * Chooses the horizon.
 *
 * Preference order: explicit settings, then the actual spread of dated work
 * padded by a month at each end. Falling back to the data means a fresh
 * install with one quarter of projects does not render eighteen empty months.
 */
export function horizonFor(
  p: Portfolio,
  settings?: { start?: string | null; end?: string | null },
  now = new Date(),
): { start: Date; end: Date } {
  if (settings?.start && settings?.end) {
    return { start: new Date(settings.start), end: new Date(settings.end) }
  }

  const dates: number[] = []
  for (const pr of p.projects) {
    if (pr.startDate) dates.push(pr.startDate.getTime())
    if (pr.targetDate) dates.push(pr.targetDate.getTime())
  }
  for (const m of p.milestones) if (m.targetDate) dates.push(m.targetDate.getTime())

  if (dates.length === 0) {
    return { start: addMonths(now, -1), end: addMonths(now, 11) }
  }

  return {
    start: addMonths(new Date(Math.min(...dates)), -1),
    end: addMonths(new Date(Math.max(...dates)), 1),
  }
}

export function buildTimeline(
  p: Portfolio,
  opts: { start: Date; end: Date; now?: Date; initiatives?: InitiativeView[] },
): TimelineModel {
  const now = opts.now ?? new Date()
  const start = startOfMonth(opts.start)
  const end = addMonths(startOfMonth(opts.end), 1)
  const span = end.getTime() - start.getTime()
  const columns = buildColumns(start, opts.end)

  const source = opts.initiatives ?? p.initiatives
  const lanes: TimelineLane[] = source.map((initiative) => {
    const bars: TimelineBar[] = []
    const undatedProjects: ProjectView[] = []
    const milestones: TimelineMilestone[] = []

    for (const project of initiative.projects) {
      const s = project.startDate ?? project.targetDate
      const e = project.targetDate ?? project.startDate

      if (!s || !e) {
        undatedProjects.push(project)
        continue
      }

      // A single-day range would render as a hairline, so give every bar at
      // least a few days of width — a one-day project still needs to be seen.
      const from = new Date(Math.min(s.getTime(), e.getTime()))
      const to = new Date(Math.max(s.getTime(), e.getTime(), from.getTime() + 5 * MS))

      const clippedStart = from < start
      const clippedEnd = to > end
      const left = Math.max(0, pct(from, start, span))
      const right = Math.min(100, pct(to, start, span))
      if (right <= 0 || left >= 100) continue

      bars.push({
        project,
        leftPct: left,
        widthPct: Math.max(1.2, right - left),
        undated: false,
        clippedStart,
        clippedEnd,
        rag: project.health.rag,
      })

      for (const m of project.milestones) {
        if (!m.targetDate) continue
        const mp = pct(m.targetDate, start, span)
        if (mp < 0 || mp > 100) continue
        milestones.push({
          milestone: m,
          projectName: project.name,
          leftPct: mp,
          overdue: m.status === 'pending' && m.targetDate < now,
        })
      }
    }

    bars.sort((a, b) => a.leftPct - b.leftPct)
    milestones.sort((a, b) => a.leftPct - b.leftPct)
    return { initiative, bars, milestones, undatedProjects }
  })

  const todayRaw = pct(now, start, span)
  const todayPct = todayRaw >= 0 && todayRaw <= 100 ? todayRaw : null

  const keyDates = p.milestones
    .filter((m) => m.portfolioLevel && m.targetDate)
    .sort((a, b) => a.targetDate!.getTime() - b.targetDate!.getTime())
    .map((m) => ({
      milestone: m,
      projectName: m.project.name,
      leftPct: pct(m.targetDate!, start, span),
      overdue: m.status === 'pending' && m.targetDate! < now,
    }))

  return { start, end, columns, lanes, todayPct, keyDates }
}

/**
 * Bars are coloured by assessed health, not by status.
 *
 * A timeline exists to answer "what is in trouble and when does it land". Status
 * only says whether work has begun, which the bar's position already implies.
 */
export const RAG_BAR_COLOR: Record<Rag, string> = {
  green: 'var(--brand)',
  amber: '#d97706',
  red: 'var(--red)',
  unknown: 'var(--slate)',
}
