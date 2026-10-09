/**
 * Meeting series, read from the database. The rules are in ./series.ts.
 *
 * WHY THE QUERIES ARE NARROW (9 October 2026)
 *
 * The first version read every history entry and every document title on
 * record, three times per page view (the page, its title, and the meeting
 * picker), and filtered them in memory; the series page took seconds. Now
 * the database returns only the rows whose meeting starts with one of the
 * series' names - a prefix, checked exactly afterwards by inSeries - and then
 * the history of just the items those rows name. The picker reads distinct
 * titles, and only when Edit is opened.
 */
import { asc, eq, ilike, inArray, or, type AnyColumn } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  actionItemEvents,
  actionItems,
  decisionEvents,
  decisions,
  meetingSeries,
  meetingSeriesChecks,
  meetingSeriesMeetings,
  sourceDocuments,
} from '@/db/schema'
import { decodeChanges } from './item-changes'
import { loadItems, type Item } from './items'
import {
  baseMeetingName,
  bucketOf,
  changeLine,
  derivedCheck,
  inSeries,
  latestChange,
  nextSession,
  sessionDay,
  type Bucket,
  type SeriesEvent,
  type SeriesItem,
} from './series'

export interface SeriesSummary {
  id: string
  name: string
  status: string
  meetings: string[]
  lastSession: string | null
  nextSession: string | null
  open: number
}

export interface SeriesRow {
  kind: SeriesItem['kind']
  ref: string
  title: string
  href: string
  owner: string | null
  due: string | null
  /** What changed, for the changed section. */
  change: string | null
  /** Where it changed, with a link when there is one. */
  where: string | null
  whereUrl: string | null
  check: string | null
  /** Written by a person or Yaara, rather than derived. */
  checkWritten: boolean
}

export interface SeriesView extends SeriesSummary {
  sections: Record<Bucket, SeriesRow[]>
}

/**
 * Today where the sessions happen. The working sessions are on Eastern time,
 * and a UTC date flips to tomorrow at 8 pm there - which made Thursday
 * evening's "next session" Monday instead of Friday.
 */
const SESSION_TZ = 'America/New_York'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: SESSION_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)
const startsWithAny = (col: AnyColumn, names: readonly string[]) => or(...names.map((n) => ilike(col, `${escapeLike(n)}%`)))

/** What a series' meetings touched: their session days, and the items they raised or spoke about, each with its whole history. */
async function footprint(names: string[]): Promise<{ days: string[]; ids: Set<string>; history: Map<string, SeriesEvent[]> }> {
  if (!names.length) return { days: [], ids: new Set(), history: new Map() }
  const [docs, dEv, aEv, dRaised, aRaised] = await Promise.all([
    db.select({ t: sourceDocuments.title }).from(sourceDocuments).where(startsWithAny(sourceDocuments.title, names)),
    db.select({ id: decisionEvents.decisionId, t: decisionEvents.meeting }).from(decisionEvents).where(startsWithAny(decisionEvents.meeting, names)),
    db.select({ id: actionItemEvents.actionItemId, t: actionItemEvents.sourceTitle }).from(actionItemEvents).where(startsWithAny(actionItemEvents.sourceTitle, names)),
    db.select({ id: decisions.id, t: decisions.raisedAtMeeting }).from(decisions).where(startsWithAny(decisions.raisedAtMeeting, names)),
    db.select({ id: actionItems.id, t: actionItems.sourceTitle }).from(actionItems).where(startsWithAny(actionItems.sourceTitle, names)),
  ])
  const mine = <T extends { t: string | null }>(rows: T[]) => rows.filter((r) => inSeries(r.t, names))
  const decisionIds = [...new Set([...mine(dEv), ...mine(dRaised)].map((r) => r.id))]
  const actionIds = [...new Set([...mine(aEv), ...mine(aRaised)].map((r) => r.id))]

  const days = new Set<string>()
  for (const r of [...mine(docs), ...mine(dEv), ...mine(aEv)]) {
    const d = sessionDay(r.t!)
    if (d) days.add(d)
  }

  const [dHist, aHist] = await Promise.all([
    decisionIds.length ? db.select().from(decisionEvents).where(inArray(decisionEvents.decisionId, decisionIds)) : [],
    actionIds.length ? db.select().from(actionItemEvents).where(inArray(actionItemEvents.actionItemId, actionIds)) : [],
  ])
  const history = new Map<string, SeriesEvent[]>()
  const add = (id: string, e: SeriesEvent) => history.set(id, [...(history.get(id) ?? []), e])
  for (const r of dHist) add(r.decisionId, { kind: r.kind, at: r.occurredAt ?? r.createdAt, source: r.meeting, url: r.url, note: r.note, changes: decodeChanges(r.changes) })
  for (const r of aHist) add(r.actionItemId, { kind: r.kind, at: r.occurredAt, source: r.sourceTitle, url: r.sourceUrl, note: r.note, changes: decodeChanges(r.changes) })

  return { days: [...days].sort(), ids: new Set([...decisionIds, ...actionIds]), history }
}

async function seriesRows() {
  const [series, members] = await Promise.all([
    db.select().from(meetingSeries).orderBy(asc(meetingSeries.name)),
    db.select().from(meetingSeriesMeetings),
  ])
  return series.map((s) => ({ ...s, meetings: members.filter((m) => m.seriesId === s.id).map((m) => m.meeting).sort() }))
}

/** A series' name alone, for the page title. */
export async function seriesName(id: string): Promise<string | null> {
  const [row] = await db.select({ name: meetingSeries.name }).from(meetingSeries).where(eq(meetingSeries.id, id)).limit(1)
  return row?.name ?? null
}

function toSeriesItem(i: Item, events: SeriesEvent[]): SeriesItem {
  return {
    kind: i.kind,
    ref: i.ref,
    title: i.title,
    href: i.href,
    status: i.status,
    open: i.open,
    owner: i.ownerName,
    dueDate: i.dueDate,
    createdAt: i.createdAt,
    closedAt: i.closedAt,
    mergedInto: i.mergedInto,
    source: i.sourceTitle,
    events,
  }
}

function membersOf(items: Item[], fp: { ids: Set<string>; history: Map<string, SeriesEvent[]> }): SeriesItem[] {
  return items.filter((i) => fp.ids.has(i.id)).map((i) => toSeriesItem(i, fp.history.get(i.id) ?? []))
}

/** Open work: decisions are a record, not something open (lib/decision-recency.ts). */
const openWork = (items: SeriesItem[]) => items.filter((i) => i.open && !i.mergedInto && i.kind !== 'decision').length

export async function listSeries(): Promise<SeriesSummary[]> {
  const [rows, items] = await Promise.all([seriesRows(), loadItems()])
  const now = today()
  return Promise.all(
    rows.map(async (s) => {
      const fp = await footprint(s.meetings)
      const days = fp.days.filter((d) => d <= now)
      return {
        id: s.id,
        name: s.name,
        status: s.status,
        meetings: s.meetings,
        lastSession: days.at(-1) ?? null,
        nextSession: s.status === 'open' ? nextSession(days, now) : null,
        open: openWork(membersOf(items, fp)),
      }
    }),
  )
}

export async function seriesView(id: string): Promise<SeriesView | null> {
  const rows = await seriesRows()
  const s = rows.find((r) => r.id === id)
  if (!s) return null

  const now = today()
  const fp = await footprint(s.meetings)
  const days = fp.days.filter((d) => d <= now)
  const last = days.at(-1) ?? null
  const lastDay = last ?? now
  const since = new Date(`${lastDay}T00:00:00Z`)

  const [items, checks] = await Promise.all([
    loadItems({ closedSince: since }),
    db.select().from(meetingSeriesChecks).where(eq(meetingSeriesChecks.seriesId, id)),
  ])
  const written = new Map(checks.map((c) => [c.ref.toUpperCase(), c.text]))

  const sections: Record<Bucket, SeriesRow[]> = { new: [], resolved: [], changed: [], quiet: [], decided: [] }
  const members = membersOf(items, fp)
  for (const item of members) {
    const bucket = bucketOf(item, lastDay)
    if (!bucket) continue
    const ch = bucket === 'changed' || bucket === 'resolved' || bucket === 'decided' ? latestChange(item, lastDay) : null
    const own = written.get(item.ref.toUpperCase())
    sections[bucket].push({
      kind: item.kind,
      ref: item.ref,
      title: item.title,
      href: item.href,
      owner: item.owner,
      due: item.dueDate ? item.dueDate.toISOString().slice(0, 10) : null,
      change: changeLine(ch),
      where: ch?.source ? baseMeetingName(ch.source) : bucket === 'decided' && item.source ? baseMeetingName(item.source) : null,
      whereUrl: ch?.url ?? null,
      check: own ?? derivedCheck(item, bucket, now),
      checkWritten: Boolean(own),
    })
  }
  const order = { blocker: 0, decision: 1, action: 2 } as const
  for (const list of Object.values(sections)) list.sort((a, b) => order[a.kind] - order[b.kind] || a.ref.localeCompare(b.ref, undefined, { numeric: true }))

  return {
    id: s.id,
    name: s.name,
    status: s.status,
    meetings: s.meetings,
    lastSession: last,
    nextSession: s.status === 'open' ? nextSession(days, now) : null,
    open: openWork(members),
    sections,
  }
}

/** Every meeting name on record, for the picker: name, how many sessions, the latest. Distinct titles only. */
export async function knownMeetings(): Promise<Array<{ name: string; sessions: number; last: string | null }>> {
  const lists = await Promise.all([
    db.selectDistinct({ t: sourceDocuments.title }).from(sourceDocuments),
    db.selectDistinct({ t: decisionEvents.meeting }).from(decisionEvents),
    db.selectDistinct({ t: actionItemEvents.sourceTitle }).from(actionItemEvents),
    db.selectDistinct({ t: decisions.raisedAtMeeting }).from(decisions),
    db.selectDistinct({ t: actionItems.sourceTitle }).from(actionItems),
  ])
  const seen = new Map<string, { name: string; days: Set<string> }>()
  for (const { t } of lists.flat()) {
    if (!t) continue
    const name = baseMeetingName(t)
    if (!name || /^slack\b/i.test(name)) continue
    const key = name.toLowerCase()
    const entry = seen.get(key) ?? { name, days: new Set<string>() }
    const d = sessionDay(t)
    if (d) entry.days.add(d)
    seen.set(key, entry)
  }
  return [...seen.values()]
    .map((e) => ({ name: e.name, sessions: e.days.size, last: [...e.days].sort().at(-1) ?? null }))
    .sort((a, b) => (b.last ?? '').localeCompare(a.last ?? '') || a.name.localeCompare(b.name))
}
