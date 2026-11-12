/**
 * The Release Calendar: the pure rules (Scott, 11 November 2026).
 *
 * Planned Production releases are Linear tickets carrying the release label,
 * and Linear projects carrying it (Scott, 12 November 2026: he labelled a
 * whole project, Audio Processing in Creative Central, and expected it here).
 * Yaara reads them each pass, works out from each ticket's text which teams
 * it affects, and sends them here (app/api/agent/releases). The calendar
 * places each on its target date.
 *
 * A release is announced in #mr-production-deployments when it is first seen
 * and whenever its target date moves. What was last announced is kept as a
 * key - the date, or "none" - so the decision is a comparison, made here, and
 * Yaara posts only what this says to post. She confirms each post afterwards;
 * a post that failed is still owed, and goes on the next pass.
 *
 * No database, no network: the route, the page and the tests read these.
 */

/**
 * The labels that make a Linear ticket a release, matched ignoring case. Scott
 * asked for "Production Release"; the label in use is "Production Deployment";
 * he added "Production Deployments" (11 November 2026). Yaara reads Linear
 * with the same list (yaara/src/follow/releases.ts).
 */
export const RELEASE_LABELS = ['Production Release', 'Production Deployment', 'Production Deployments'] as const

/** What Yaara sends for one ticket. The agent API contract: yaara/src/publish/portfolio.ts sends the same shape. */
export interface IncomingRelease {
  linearId: string
  /** "MED-339"; a project's is "PROJ-" and its Linear slug id, and is not shown. */
  identifier: string
  /** A ticket, or a whole project labelled as a release. Older senders said nothing: a ticket. */
  kind: 'ticket' | 'project'
  title: string
  description: string | null
  url: string | null
  /** YYYY-MM-DD, or null: the ticket's target date, or its project's when it has none (Scott, 11 November 2026). */
  targetDate: string | null
  /** Where targetDate came from: the ticket, or its project. Null with no date. */
  targetDateFrom: 'ticket' | 'project' | null
  status: string | null
  statusType: string | null
  createdBy: string | null
  assignee: string | null
  projectLinearId: string | null
  projectName: string | null
  projectLead: string | null
  teamsImpacted: string[]
  contactName: string | null
  contactSlackUrl: string | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** One release from the request, or why not. */
export function parseRelease(v: unknown): IncomingRelease | string {
  const o = (v ?? {}) as Record<string, unknown>
  const linearId = text(o.linearId, 80)
  const identifier = text(o.identifier, 40)
  const title = text(o.title, 500)
  if (!linearId || !identifier || !title) return 'Each release needs "linearId", "identifier" and "title".'
  const targetDate = text(o.targetDate, 10)
  if (targetDate && !DATE.test(targetDate)) return `${identifier}: "targetDate" must be YYYY-MM-DD.`
  const url = text(o.url, 500)
  const slack = text(o.contactSlackUrl, 500)
  const teams = Array.isArray(o.teamsImpacted) ? o.teamsImpacted.map((t) => text(t, 80)).filter((t): t is string => Boolean(t)) : []
  return {
    linearId,
    identifier,
    kind: o.kind === 'project' ? 'project' : 'ticket',
    title,
    description: typeof o.description === 'string' ? o.description.slice(0, 20_000) : null,
    url: url && /^https:\/\//.test(url) ? url : null,
    targetDate,
    // Older senders said nothing: a date they sent was the ticket's own.
    targetDateFrom: !targetDate ? null : o.targetDateFrom === 'project' ? 'project' : 'ticket',
    status: text(o.status, 80),
    statusType: text(o.statusType, 40),
    createdBy: text(o.createdBy, 120),
    assignee: text(o.assignee, 120),
    projectLinearId: text(o.projectLinearId, 80),
    projectName: text(o.projectName, 300),
    projectLead: text(o.projectLead, 120),
    teamsImpacted: [...new Set(teams)].slice(0, 20),
    contactName: text(o.contactName, 120),
    contactSlackUrl: slack && /^https:\/\/[a-z0-9.-]*slack\.com\//.test(slack) ? slack : null,
  }
}

/** How a release is named in the log and in messages: "MED-339 Logo Detection", or "Project: Audio Processing". */
export const releaseName = (r: { kind?: string | null; identifier: string; title: string }) => (r.kind === 'project' ? `Project: ${r.title}` : `${r.identifier} ${r.title}`)

/** The key an announcement is kept under: the date, or "none". */
export const announceKey = (targetDate: string | null) => targetDate ?? 'none'

export type Announce = 'new' | 'date' | null

/**
 * Whether a release is owed an announcement: never announced (new), or its
 * date is not the one announced (moved). Nothing for a release that is done
 * or cancelled - a closed ticket is not a planned release.
 */
export function announceFor(row: { announcedKey: string | null } | null, r: Pick<IncomingRelease, 'targetDate' | 'statusType'>): Announce {
  if (r.statusType === 'completed' || r.statusType === 'canceled') return null
  if (!row || row.announcedKey == null) return 'new'
  return row.announcedKey !== announceKey(r.targetDate) ? 'date' : null
}

/** The date announced before, for "moved from"; null when there was none. */
export const previousDate = (row: { announcedKey: string | null } | null) => (row?.announcedKey && row.announcedKey !== 'none' ? row.announcedKey : null)

// --- the calendar ------------------------------------------------------------

/** "months" is this month and next, the default (Scott). */
export const VIEWS = ['months', 'month', 'week', 'day'] as const
export type CalendarView = (typeof VIEWS)[number]
export const VIEW_LABEL: Record<CalendarView, string> = { months: '2 months', month: 'Month', week: 'Week', day: 'Day' }
export const isView = (v: string): v is CalendarView => (VIEWS as readonly string[]).includes(v)

/** Dates are calendar days, YYYY-MM-DD, worked in UTC so no time zone moves one. */
const toDate = (d: string) => new Date(`${d}T00:00:00Z`)
export const isoDay = (d: Date) => d.toISOString().slice(0, 10)
export function addDays(d: string, n: number): string {
  const x = toDate(d)
  x.setUTCDate(x.getUTCDate() + n)
  return isoDay(x)
}
export function addMonths(d: string, n: number): string {
  const x = toDate(d)
  const day = x.getUTCDate()
  x.setUTCDate(1)
  x.setUTCMonth(x.getUTCMonth() + n)
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate()
  x.setUTCDate(Math.min(day, last))
  return isoDay(x)
}
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`
export const monthEnd = (d: string) => addDays(addMonths(monthStart(d), 1), -1)
/** Weeks start on Sunday, as Linear's and most US calendars do. */
export const weekStart = (d: string) => addDays(d, -toDate(d).getUTCDay())

/** The days a view shows, first to last. */
export function rangeOf(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === 'day') return { from: anchor, to: anchor }
  if (view === 'week') return { from: weekStart(anchor), to: addDays(weekStart(anchor), 6) }
  if (view === 'month') return { from: monthStart(anchor), to: monthEnd(anchor) }
  return { from: monthStart(anchor), to: monthEnd(addMonths(monthStart(anchor), 1)) }
}

/** Back or forward one step: a month for the month views, a week, a day. */
export function step(view: CalendarView, anchor: string, dir: 1 | -1): string {
  if (view === 'day') return addDays(anchor, dir)
  if (view === 'week') return addDays(anchor, 7 * dir)
  return addMonths(monthStart(anchor), dir)
}

/** A month as weeks of seven days, Sunday first; days outside the month are null. */
export function monthGrid(anyDay: string): (string | null)[][] {
  const first = monthStart(anyDay)
  const last = monthEnd(anyDay)
  const weeks: (string | null)[][] = []
  for (let d = weekStart(first); d <= last; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const day = addDays(d, i)
      return day >= first && day <= last ? day : null
    }))
  }
  return weeks
}

/** The months a view covers, as their first days. */
export function monthsIn(view: CalendarView, anchor: string): string[] {
  if (view === 'months') return [monthStart(anchor), addMonths(monthStart(anchor), 1)]
  return [monthStart(anchor)]
}

/** The view and day a release opened from a link lands on: its own date, in the default view. */
export function anchorFor(targetDate: string | null, today: string): string {
  return targetDate ?? today
}

/** A status, for its colour: Linear's state type. */
export function statusTone(statusType: string | null): 'done' | 'active' | 'planned' | 'cancelled' {
  if (statusType === 'completed') return 'done'
  if (statusType === 'canceled') return 'cancelled'
  if (statusType === 'started') return 'active'
  return 'planned'
}
