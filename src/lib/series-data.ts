/**
 * Meeting series, read from the database. The rules are in ./series.ts.
 */
import { asc, eq } from 'drizzle-orm'
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

const today = () => new Date().toISOString().slice(0, 10)

/** Every title any record says it came from: meetings read, items raised, history entries. */
async function allTitles(): Promise<{ docs: string[]; events: Array<{ itemId: string; e: SeriesEvent }> }> {
  const [docs, dEvents, aEvents] = await Promise.all([
    db.select({ title: sourceDocuments.title }).from(sourceDocuments),
    db.select().from(decisionEvents),
    db.select().from(actionItemEvents),
  ])
  return {
    docs: docs.map((d) => d.title),
    events: [
      ...dEvents.map((r) => ({
        itemId: r.decisionId,
        e: { kind: r.kind, at: r.occurredAt ?? r.createdAt, source: r.meeting, url: r.url, note: r.note, changes: decodeChanges(r.changes) },
      })),
      ...aEvents.map((r) => ({
        itemId: r.actionItemId,
        e: { kind: r.kind, at: r.occurredAt, source: r.sourceTitle, url: r.sourceUrl, note: r.note, changes: decodeChanges(r.changes) },
      })),
    ],
  }
}

function sessionDays(names: string[], titles: readonly (string | null)[]): string[] {
  const days = new Set<string>()
  for (const t of titles) if (t && inSeries(t, names)) {
    const d = sessionDay(t)
    if (d) days.add(d)
  }
  return [...days].sort()
}

async function seriesRows() {
  const [series, members] = await Promise.all([
    db.select().from(meetingSeries).orderBy(asc(meetingSeries.name)),
    db.select().from(meetingSeriesMeetings),
  ])
  return series.map((s) => ({ ...s, meetings: members.filter((m) => m.seriesId === s.id).map((m) => m.meeting).sort() }))
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

/** The items a series' meetings raised or spoke about, with their history. */
function membersOf(names: string[], items: Item[], events: Array<{ itemId: string; e: SeriesEvent }>): SeriesItem[] {
  const byItem = new Map<string, SeriesEvent[]>()
  for (const { itemId, e } of events) byItem.set(itemId, [...(byItem.get(itemId) ?? []), e])
  return items
    .filter((i) => inSeries(i.sourceTitle, names) || (byItem.get(i.id) ?? []).some((e) => inSeries(e.source, names)))
    .map((i) => toSeriesItem(i, byItem.get(i.id) ?? []))
}

export async function listSeries(): Promise<SeriesSummary[]> {
  const [rows, titles, items] = await Promise.all([seriesRows(), allTitles(), loadItems()])
  const now = today()
  return rows.map((s) => {
    const days = sessionDays(s.meetings, [...titles.docs, ...titles.events.map((x) => x.e.source)]).filter((d) => d <= now)
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      meetings: s.meetings,
      lastSession: days.at(-1) ?? null,
      nextSession: s.status === 'open' ? nextSession(days, now) : null,
      open: membersOf(s.meetings, items, titles.events).filter((i) => i.open && !i.mergedInto).length,
    }
  })
}

export async function seriesView(id: string): Promise<SeriesView | null> {
  const rows = await seriesRows()
  const s = rows.find((r) => r.id === id)
  if (!s) return null

  const now = today()
  const titles = await allTitles()
  const days = sessionDays(s.meetings, [...titles.docs, ...titles.events.map((x) => x.e.source)]).filter((d) => d <= now)
  const last = days.at(-1) ?? null
  const lastDay = last ?? now
  const since = new Date(`${lastDay}T00:00:00Z`)

  const [items, checks] = await Promise.all([
    loadItems({ closedSince: since }),
    db.select().from(meetingSeriesChecks).where(eq(meetingSeriesChecks.seriesId, id)),
  ])
  const written = new Map(checks.map((c) => [c.ref.toUpperCase(), c.text]))

  const sections: Record<Bucket, SeriesRow[]> = { new: [], resolved: [], changed: [], quiet: [] }
  const members = membersOf(s.meetings, items, titles.events)
  for (const item of members) {
    const bucket = bucketOf(item, lastDay)
    if (!bucket) continue
    const ch = bucket === 'changed' || bucket === 'resolved' ? latestChange(item, lastDay) : null
    const own = written.get(item.ref.toUpperCase())
    sections[bucket].push({
      kind: item.kind,
      ref: item.ref,
      title: item.title,
      href: item.href,
      owner: item.owner,
      due: item.dueDate ? item.dueDate.toISOString().slice(0, 10) : null,
      change: changeLine(ch),
      where: ch?.source ? baseMeetingName(ch.source) : null,
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
    open: members.filter((i) => i.open && !i.mergedInto).length,
    sections,
  }
}

/** Every meeting name on record, for the picker: name, how many sessions, the latest. */
export async function knownMeetings(): Promise<Array<{ name: string; sessions: number; last: string | null }>> {
  const [titles, dRaised, aRaised] = await Promise.all([
    allTitles(),
    db.select({ t: decisions.raisedAtMeeting }).from(decisions),
    db.select({ t: actionItems.sourceTitle }).from(actionItems),
  ])
  const all = [...titles.docs, ...titles.events.map((x) => x.e.source), ...dRaised.map((r) => r.t), ...aRaised.map((r) => r.t)]
  const seen = new Map<string, { name: string; days: Set<string> }>()
  for (const t of all) {
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
