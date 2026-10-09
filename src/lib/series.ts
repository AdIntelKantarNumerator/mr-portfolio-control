/**
 * Meeting series: the rules, kept apart from the database so they can be
 * tested (8 October 2026).
 *
 * WHAT A SERIES IS
 *
 * A set of meeting names followed together - "Working Sessions: Insights
 * Studio with GPC", the "Keystone SoS" that feeds it, Ashley's running doc.
 * Each session of a meeting arrives with its date in the title ("Keystone SoS
 * - 2026/10/08 10:30 EDT"), so membership is by the name without the date.
 *
 * WHAT THE PAGE ANSWERS
 *
 * The questions the hand-written session notes answered, from the record:
 * what the last session produced, and of what came before it, what has been
 * resolved since, what changed shape (with what it changed from and to), and
 * what nobody has mentioned since - each with the thing to check next time.
 * "Since" is the start of the day of the last session: that session's own
 * outcomes count as having happened since the one before it.
 */
import type { ItemChange } from './item-changes'
import { describeChange } from './item-changes'

/** " - 2026/10/08 08:29 EDT", optionally followed by Meet's own suffix. */
const DATED = /\s+-\s+(\d{4})\/(\d{2})\/(\d{2})(?:\s+\d{1,2}:\d{2}(?:\s+[A-Z]{2,5})?)?(?:\s+-\s+(?:Transcript|Notes by Gemini|Recording))?\s*$/i
const SUFFIX = /\s+-\s+(?:Transcript|Notes by Gemini|Recording)\s*$/i

/** A meeting's name without its date or Meet's suffix. */
export function baseMeetingName(title: string): string {
  return title.replace(DATED, '').replace(SUFFIX, '').trim()
}

/** The session's date as YYYY-MM-DD, from its title, or null when it has none. */
export function sessionDay(title: string): string | null {
  const m = DATED.exec(title)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Whether a meeting or document title belongs to a series with these names. */
export function inSeries(title: string | null | undefined, names: readonly string[]): boolean {
  if (!title) return false
  const base = fold(baseMeetingName(title))
  return names.some((n) => fold(n) === base)
}

const DAY = 86_400_000
const toDay = (d: Date) => d.toISOString().slice(0, 10)
const fromDay = (s: string) => new Date(`${s}T00:00:00Z`)

/**
 * When the next session is, as YYYY-MM-DD: the usual gap between sessions
 * after the last one, rolled forward past today and off a weekend. Daily
 * working sessions give the next weekday; a weekly sync gives a week on.
 */
export function nextSession(days: readonly string[], today: string): string | null {
  const sorted = [...new Set(days)].sort()
  if (!sorted.length) return null
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const g = Math.round((fromDay(sorted[i]!).getTime() - fromDay(sorted[i - 1]!).getTime()) / DAY)
    // A weekend between two daily sessions is not a three-day cadence.
    gaps.push(fromDay(sorted[i - 1]!).getUTCDay() === 5 && g === 3 ? 1 : g)
  }
  gaps.sort((a, b) => a - b)
  const gap = Math.max(1, gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 7)
  let next = fromDay(sorted.at(-1)!)
  const step = () => {
    next = new Date(next.getTime() + gap * DAY)
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next = new Date(next.getTime() + DAY)
  }
  step()
  // Today counts until a session for today is on record: on Friday morning
  // the next session is Friday, not Monday.
  while (toDay(next) < today) step()
  return toDay(next)
}

/** "Fri 10/9": how a session date is shown. */
export function shortDay(day: string | null): string {
  if (!day) return '—'
  const d = fromDay(day)
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

// ------------------------------------------------------------------ buckets

export type SeriesKind = 'blocker' | 'decision' | 'action'

/** One thing that happened to an item, as the history records it. */
export interface SeriesEvent {
  kind: string
  at: Date
  source: string | null
  url: string | null
  note: string | null
  changes: ItemChange[]
}

export interface SeriesItem {
  kind: SeriesKind
  ref: string
  title: string
  href: string
  status: string
  open: boolean
  owner: string | null
  dueDate: Date | null
  createdAt: Date
  closedAt: Date | null
  mergedInto: string | null
  /** Where it was first raised. */
  source: string | null
  events: SeriesEvent[]
}

export type Bucket = 'new' | 'resolved' | 'changed' | 'quiet' | 'decided'

/**
 * Kinds of history entry that are a meeting saying something new about the
 * item. Not "raised" (that is the item being filed, often hours after the
 * meeting), and not a reminder, an owner rule or a score.
 */
const SAID = new Set(['discussed', 'updated', 'changed', 'resolved', 'reopened', 'done', 'dropped'])

/**
 * Whether something happened at or after the last session: judged by the
 * session date in its source title when it has one, because Yaara files a
 * meeting when she reads it - the 10/7 notes were filed after midnight on
 * 10/8 - and only by the time recorded when the source carries no date (a
 * running document, a Slack thread, a person on the page).
 */
export function isSince(at: Date, source: string | null | undefined, lastDay: string): boolean {
  const day = source ? sessionDay(source) : null
  return day ? day >= lastDay : at.toISOString().slice(0, 10) >= lastDay
}

/**
 * Which section an item belongs in, relative to the last session, or null
 * when it belongs in none: merged away, or closed before the last session.
 */
export function bucketOf(item: SeriesItem, lastDay: string): Bucket | null {
  if (item.mergedInto) return null
  // A decision is a record of what was decided, in a section of its own: made
  // or changed at the last session or since (Scott, 8 October 2026).
  if (item.kind === 'decision') {
    if (item.status === 'dropped') return null
    const fresh = isSince(item.createdAt, item.source, lastDay) || item.events.some((e) => SAID.has(e.kind) && isSince(e.at, e.source, lastDay))
    return fresh ? 'decided' : null
  }
  if (isSince(item.createdAt, item.source, lastDay)) return 'new'
  if (!item.open) return item.closedAt && item.closedAt.toISOString().slice(0, 10) >= lastDay ? 'resolved' : null
  return item.events.some((e) => SAID.has(e.kind) && isSince(e.at, e.source, lastDay)) ? 'changed' : 'quiet'
}

/** The newest thing said about an item since the last session, for the "changed" row. */
export function latestChange(item: SeriesItem, lastDay: string): SeriesEvent | null {
  const recent = item.events
    .filter((e) => SAID.has(e.kind) && isSince(e.at, e.source, lastDay))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
  return recent.find((e) => e.changes.length) ?? recent[0] ?? null
}

const clip = (v: string | null, max = 70) => (v && v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v)

/** What changed, as one short line: each change clipped, the long body left out. */
export function changeLine(e: SeriesEvent | null): string | null {
  if (!e) return null
  const shown = e.changes.filter((c) => c.field !== 'body')
  if (shown.length) return shown.map((c) => describeChange({ ...c, from: clip(c.from), to: clip(c.to) })).join(' · ')
  return clip(e.note, 160)
}

/**
 * The thing to check at the next session, when nobody has written one.
 * Short on purpose: it is a column, not a paragraph.
 */
export function derivedCheck(item: SeriesItem, bucket: Bucket, today: string): string | null {
  if (bucket === 'resolved' || bucket === 'decided' || !item.open) return null
  const due = item.dueDate ? toDay(item.dueDate) : null
  if (due && due < today) return `Overdue since ${shortDay(due)}`
  if (!item.owner || /^(the group|the team|nobody|unassigned)$/i.test(item.owner.trim())) return 'Needs an owner'
  if (due) return `Due ${shortDay(due)}`
  if (bucket === 'quiet') return 'Status?'
  if (item.kind === 'decision' && item.status === 'open') return 'Decided?'
  if (item.kind === 'blocker') return 'Still blocked?'
  return 'Progress?'
}
