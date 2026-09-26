/**
 * The home page's read model, at whichever level you are looking.
 *
 * One function for all three levels rather than three, because the card is the
 * same card: a name, a health call, the next milestone, the signals underneath
 * and how much has been happening. What changes between levels is only which
 * rows roll up into it.
 *
 * ROLLING UP
 *
 * An initiative's numbers are the sum of its projects' workstreams, not of
 * anything stored on the initiative. Nothing is denormalised, because a cached
 * count is a second answer to a question the tables already answer, and it goes
 * stale the first time somebody moves a project.
 */
import { cache } from 'react'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  actionItemLinks,
  actionItems,
  agentObservations,
  decisions,
  initiatives,
  milestones,
  people,
  projects,
  workstreams,
} from '@/db/schema'
import { ENDED_PROJECT_STATUS } from './domain'

// The vocabulary lives in home-types.ts, which imports nothing, so client
// components can use it without dragging this module's database import into
// the browser bundle. Re-exported here so existing imports keep working.
export {
  LEVELS,
  SORTS,
  HEALTHS,
  isLevel,
  isSort,
  isHealth,
  type Level,
  type Sort,
  type HealthFilter,
} from './home-types'
import type { HealthFilter, Level, Sort } from './home-types'

export interface Signal {
  kind: 'blocker' | 'decision' | 'action'
  /** Yaara's one line covering all of `items`, or the single item's own text. */
  summary: string
  items: Array<{ id: string; text: string; when: string; who: string | null; href: string | null }>
}

export interface MilestoneMark {
  id: string
  name: string
  status: string
  /** 0–100 along the rail. */
  at: number
}

export interface HomeCard {
  id: string
  level: Level
  name: string
  owner: string | null
  /** "4 projects · 11 workstreams" — whatever is beneath this level. */
  beneath: string
  health: 'good' | 'warn' | 'crit' | 'quiet'
  /** Yaara's one sentence, or a person's if somebody has edited it. */
  verdict: string | null
  verdictBy: string | null
  verdictAt: Date | null
  /** Set when a person overwrote what she wrote. */
  verdictEditedBy: string | null
  detail: string[]
  evidence: Array<{ source: string; text: string; url: string | null }>
  next: { id: string; name: string; due: string | null; days: number | null; pct: number; expected: number } | null
  rail: MilestoneMark[]
  signals: Signal[]
  mix: Array<[string, number]>
  activity: number[]
  activityDelta: string
  href: string
}

const DAY = 86_400_000

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const ENDED = new Set<string>(ENDED_PROJECT_STATUS)

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * Health, from the next milestone and from whether anything is happening.
 *
 * Counted where it can be counted. "Quiet" is not a shade of green: an entity
 * nobody has touched in a fortnight has no health to report, and saying so is
 * more useful than reporting the last thing that was true.
 */
export function healthOf(
  next: HomeCard['next'],
  openBlockers: number,
  activityScore: number,
  ageDays: number,
): HomeCard['health'] {
  if (activityScore === 0 && ageDays >= 14) return 'quiet'
  if (openBlockers > 0 && next && next.days !== null && next.days <= 14) return 'crit'
  if (!next) return openBlockers > 0 ? 'warn' : 'good'
  const behind = next.expected - next.pct
  if (behind > 15) return 'crit'
  if (behind > 4) return 'warn'
  return 'good'
}

/**
 * How far through a milestone the calendar says we should be.
 *
 * Straight-line between the entity's start and the milestone's date. Crude, and
 * honest about being crude — it is a reference line on a bar, not a forecast.
 */
function expectedPct(start: Date | null, due: Date | null, now: number): number {
  if (!due) return 0
  const from = start ? start.getTime() : due.getTime() - 90 * DAY
  const span = due.getTime() - from
  if (span <= 0) return 100
  return Math.max(0, Math.min(100, Math.round(((now - from) / span) * 100)))
}

/**
 * A date the way the room says it: "30 Sep", or "30 Sep 2027" when it is not
 * this year. The raw ISO string leaked onto the cards for a while, which reads
 * as machine output on the one screen built to be read by people.
 *
 * Formatted here, on the server, and passed down as a finished string —
 * formatting it in the card would make it locale-dependent and desynchronise
 * server and client rendering.
 */
function dueLabel(d: Date, now: number): string {
  const sameYear = d.getUTCFullYear() === new Date(now).getUTCFullYear()
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  })
}

/** A milestone's own completeness, from the items beneath it. */
function pctFromStatus(status: string): number {
  return status === 'complete' ? 100 : status === 'on_track' ? 55 : status === 'at_risk' ? 40 : status === 'blocked' ? 25 : 10
}

export const getHomeCards = cache(async (
  level: Level,
  sort: Sort = 'active',
  health: HealthFilter = 'all',
): Promise<HomeCard[]> => {
  const now = Date.now()

  const [inits, projs, wss, ms, obs, decs, acts, links, peeps] = await Promise.all([
    db.select().from(initiatives),
    db.select().from(projects),
    db.select().from(workstreams),
    db.select().from(milestones),
    db.select().from(agentObservations).where(isNull(agentObservations.supersededAt)).orderBy(desc(agentObservations.generatedAt)),
    db.select().from(decisions),
    db.select().from(actionItems).where(eq(actionItems.status, 'open')),
    db.select().from(actionItemLinks),
    db.select().from(people),
  ])

  const personName = new Map(peeps.map((p) => [p.id, p.name]))

  // Which workstreams sit under which project, and which projects under which
  // initiative — the only two joins the whole page needs.
  const wsByProject = new Map<string, typeof wss>()
  for (const w of wss) {
    if (!w.projectId) continue
    wsByProject.set(w.projectId, [...(wsByProject.get(w.projectId) ?? []), w])
  }
  const projByInitiative = new Map<string, typeof projs>()
  for (const p of projs) {
    if (!p.initiativeId) continue
    projByInitiative.set(p.initiativeId, [...(projByInitiative.get(p.initiativeId) ?? []), p])
  }

  const obsFor = new Map<string, (typeof obs)[number]>()
  for (const o of obs) {
    const key = `${o.entityType}:${o.entityId}`
    if (!obsFor.has(key)) obsFor.set(key, o)
  }

  /** Every id at or beneath one entity — what its rollups count over. */
  function scope(lv: Level, id: string): { projects: string[]; workstreams: string[] } {
    if (lv === 'workstream') return { projects: [], workstreams: [id] }
    if (lv === 'project') return { projects: [id], workstreams: (wsByProject.get(id) ?? []).map((w) => w.id) }
    const kids = projByInitiative.get(id) ?? []
    return {
      projects: kids.map((p) => p.id),
      workstreams: kids.flatMap((p) => (wsByProject.get(p.id) ?? []).map((w) => w.id)),
    }
  }

  const rows: Array<{ id: string; name: string; ownerId: string | null; startDate: Date | null; status: string }> =
    level === 'initiative'
      ? inits.map((i) => ({ id: i.id, name: i.name, ownerId: i.ownerId, startDate: i.startDate, status: i.status }))
      : level === 'project'
        ? projs.map((p) => ({ id: p.id, name: p.name, ownerId: p.ownerId, startDate: p.startDate, status: p.status }))
        : wss.map((w) => ({ id: w.id, name: w.name, ownerId: w.leadId, startDate: w.startDate, status: w.status }))

  const cards: HomeCard[] = rows
    .filter((r) => !ENDED.has(r.status))
    .map((r) => {
      const sc = scope(level, r.id)
      const allIds = new Set<string>([r.id, ...sc.projects, ...sc.workstreams])

      const mine = ms.filter((m) => allIds.has(m.entityId))
      const own = ms.filter((m) => m.level === level && m.entityId === r.id)
      // Its own milestones if it has any; otherwise the ones underneath, so an
      // initiative with nothing authored still shows the work's real dates.
      const railSource = (own.length ? own : mine).slice().sort((a, b) => a.sortOrder - b.sortOrder)

      const openNext = railSource.find((m) => m.status !== 'complete') ?? null
      const due = openNext?.targetDate ?? null
      const pct = openNext ? pctFromStatus(openNext.status) : 100
      const expected = expectedPct(r.startDate, due, now)

      const rail: MilestoneMark[] = railSource.slice(0, 6).map((m, i, arr) => ({
        id: m.id,
        name: m.name,
        status: m.status,
        at: arr.length === 1 ? 100 : Math.round((i / (arr.length - 1)) * 100),
      }))

      const ob = obsFor.get(`${level}:${r.id}`) ?? null
      const recent = parse<Array<{ text: string; at: string | null; source: string | null }>>(ob?.recent ?? null, [])
      const items = parse<Array<{ text: string; kind: string }>>(ob?.items ?? null, [])
      const ev = parse<Array<{ source: string; title: string; url: string | null }>>(ob?.evidence ?? null, [])

      const openDecs = decs.filter((d) => allIds.has(d.entityId ?? '') && d.status !== 'resolved' && d.status !== 'closed')
      const blockers = openDecs.filter((d) => d.kind === 'blocker')
      const decisionsOpen = decs.filter((d) => allIds.has(d.entityId ?? '') && d.kind === 'decision').slice(0, 4)
      const myActionIds = new Set(links.filter((l) => allIds.has(l.entityId)).map((l) => l.actionItemId))
      const myActions = acts.filter((a) => myActionIds.has(a.id))

      const activityScore = ob?.activityScore ?? 0
      const ageDays = ob ? Math.round((now - ob.generatedAt.getTime()) / DAY) : 999

      const signals: Signal[] = []
      if (blockers.length) {
        signals.push({
          kind: 'blocker',
          summary:
            blockers.length === 1
              ? blockers[0]!.title
              : `${blockers.length} blockers, oldest open ${Math.max(
                  ...blockers.map((b) => Math.round((now - (b.raisedAt?.getTime() ?? now)) / DAY)),
                )} days`,
          items: blockers.slice(0, 6).map((b) => ({
            id: b.id,
            text: b.title,
            when: b.raisedAt ? `${Math.round((now - b.raisedAt.getTime()) / DAY)}d` : '',
            who: b.raisedByText ?? null,
            href: `/decisions?ref=${b.ref}`,
          })),
        })
      }
      if (decisionsOpen.length) {
        signals.push({
          kind: 'decision',
          summary: decisionsOpen.length === 1 ? decisionsOpen[0]!.title : `${decisionsOpen.length} decisions recorded`,
          items: decisionsOpen.map((d) => ({
            id: d.id,
            text: d.title,
            when: d.raisedAt ? d.raisedAt.toISOString().slice(0, 10) : '',
            who: null,
            href: `/decisions?ref=${d.ref}`,
          })),
        })
      }
      if (myActions.length) {
        const soon = myActions.filter((a) => a.dueDate && a.dueDate.getTime() - now < 7 * DAY).length
        signals.push({
          kind: 'action',
          summary:
            myActions.length === 1
              ? myActions[0]!.text
              : `${myActions.length} open actions${soon ? `, ${soon} due this week` : ''}`,
          items: myActions.slice(0, 6).map((a) => ({
            id: a.id,
            text: a.text,
            when: a.dueDate ? a.dueDate.toISOString().slice(0, 10) : '—',
            who: a.ownerId ? (personName.get(a.ownerId) ?? null) : a.ownerName,
            href: '/actions',
          })),
        })
      }

      const mixCount = new Map<string, number>()
      for (const id of sc.workstreams.length ? sc.workstreams : [r.id]) {
        const w = wss.find((x) => x.id === id)
        const key = w?.status ?? 'planning'
        mixCount.set(key, (mixCount.get(key) ?? 0) + 1)
      }

      const beneath =
        level === 'initiative'
          ? `${plural(sc.projects.length, 'project')} · ${plural(sc.workstreams.length, 'workstream')}`
          : level === 'project'
            ? `${plural(sc.workstreams.length, 'workstream')} · ${plural(mine.length, 'milestone')}`
            : plural(own.length, 'milestone')

      return {
        id: r.id,
        level,
        name: r.name,
        owner: r.ownerId ? (personName.get(r.ownerId) ?? null) : null,
        beneath,
        health: healthOf(
          openNext ? { id: openNext.id, name: openNext.name, due: null, days: null, pct, expected } : null,
          blockers.length,
          activityScore,
          ageDays,
        ),
        verdict: ob?.verdict ?? (items[0]?.text ?? null),
        verdictBy: ob?.verdictBy ?? (ob ? ob.agent : null),
        verdictAt: ob?.verdictAt ?? ob?.generatedAt ?? null,
        verdictEditedBy: ob?.verdictBy ?? null,
        detail: items.slice(0, 3).map((i) => i.text),
        evidence: ev.slice(0, 6).map((e) => ({ source: e.source, text: e.title, url: e.url })),
        next: openNext
          ? {
              id: openNext.id,
              name: openNext.name,
              due: openNext.targetLabel ?? (due ? dueLabel(due, now) : null),
              days: due ? Math.round((due.getTime() - now) / DAY) : null,
              pct,
              expected,
            }
          : null,
        rail,
        signals,
        mix: [...mixCount.entries()],
        activity: recent.length ? [1, 2, 3, 4, 5, 6, 7, 8].map(() => Math.round(activityScore)) : [0, 0, 0, 0, 0, 0, 0, 0],
        activityDelta: activityScore > 0 ? `${Math.round(activityScore)}` : '0',
        href:
          level === 'initiative' ? `/initiatives/${r.id}` : level === 'project' ? `/projects/${r.id}` : `/workstreams/${r.id}`,
      }
    })

  // "Blocked" is crit OR warn, not crit alone. A card one bad week from
  // missing its date is what somebody filtering for trouble is looking for,
  // and a filter that showed only the already-failed would hide exactly the
  // work still worth intervening in. "On track" is good only: quiet is not a
  // shade of green, which is the whole reason it is a separate state.
  const wanted =
    health === 'all'
      ? cards
      : health === 'good'
        ? cards.filter((c) => c.health === 'good')
        : cards.filter((c) => c.health === 'crit' || c.health === 'warn')

  const busy = (c: HomeCard) => c.activity.reduce((x, y) => x + y, 0)

  // Most active first by default. A silent piece of work sinks and is
  // flagged, rather than sitting at the top because its name starts with A.
  return wanted.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'quiet') return busy(a) - busy(b) || a.name.localeCompare(b.name)
    return busy(b) - busy(a) || a.name.localeCompare(b.name)
  })
})

/** Projects with no initiative above them — named, not hidden. */
export const getUngrouped = cache(async () => {
  const rows = await db
    .select({ id: projects.id, name: projects.name, status: projects.status })
    .from(projects)
    .where(or(isNull(projects.initiativeId), eq(projects.initiativeId, '')))

  const counts = await db.select({ id: workstreams.id, projectId: workstreams.projectId }).from(workstreams)
  return rows
    .filter((r) => !ENDED.has(r.status))
    .map((r) => ({ ...r, workstreams: counts.filter((c) => c.projectId === r.id).length }))
})

/** Where a number on the home page came from — for the provenance panel. */
export const getProvenance = cache(async (level: Level, id: string) => {
  const ob = await db
    .select()
    .from(agentObservations)
    .where(and(eq(agentObservations.entityType, level), eq(agentObservations.entityId, id), isNull(agentObservations.supersededAt)))
    .orderBy(desc(agentObservations.generatedAt))
    .limit(1)

  const row = ob[0]
  return {
    generatedAt: row?.generatedAt ?? null,
    model: row?.model ?? null,
    agent: row?.agent ?? null,
    evidence: parse<Array<{ source: string; title: string; url: string | null; occurredAt: string | null }>>(
      row?.evidence ?? null,
      [],
    ),
    recent: parse<Array<{ text: string; at: string | null; source: string | null }>>(row?.recent ?? null, []),
    activityScore: row?.activityScore ?? null,
    activityWindowHours: row?.activityWindowHours ?? null,
  }
})

export async function idsInScope(level: Level, id: string): Promise<string[]> {
  if (level === 'workstream') return [id]
  if (level === 'project') {
    const ws = await db.select({ id: workstreams.id }).from(workstreams).where(eq(workstreams.projectId, id))
    return [id, ...ws.map((w) => w.id)]
  }
  const pj = await db.select({ id: projects.id }).from(projects).where(eq(projects.initiativeId, id))
  const ids = pj.map((p) => p.id)
  const ws = ids.length
    ? await db.select({ id: workstreams.id }).from(workstreams).where(inArray(workstreams.projectId, ids))
    : []
  return [id, ...ids, ...ws.map((w) => w.id)]
}
