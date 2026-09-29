/**
 * Timeline: everything against the calendar.
 *
 * WHAT WENT
 *
 * Four counter tiles, a themes row, a "dated commitments" strip, an "open work
 * with no dates" list, a legend and two paragraphs of caption. Between them
 * they took the top half of the screen to say things the chart underneath
 * already said, and the chart itself only ever drew one shape — a lane per
 * project, a bar per workstream.
 *
 * WHAT IS THERE INSTEAD
 *
 * The same controls as the home board — Showing, Find, Live only, Sort — and
 * a chart that draws whichever tier you asked for, with a bar for each child
 * beneath each row and every milestone from underneath rolled up onto it. The
 * Custom sort is the same stored, per-reader arrangement the home board uses,
 * so a board arranged there is arranged here.
 */
import { cookies } from 'next/headers'
import { asc } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  agentObservations,
  assessments,
  dependencies,
  initiatives,
  milestones,
  projects,
  settings as settingsTable,
  workstreams,
} from '@/db/schema'
import { isNull } from 'drizzle-orm'
import { Kicker } from '@/components/ui'
import { getCardOrder } from '@/lib/card-order'
import { lateness } from '@/lib/dependency-risk'
import { addMonths, buildTimeline, effectiveWindow, type DepInput, type SourceRow } from '@/lib/timeline-model'
import { HOME_PREFS_COOKIE, resolveHomePrefs } from '@/lib/home-prefs'
import { TimelineControls } from './controls'
import { TimelineView } from '@/components/timeline-view'

export const metadata = { title: 'Timeline' }
export const dynamic = 'force-dynamic'

const ENDED = new Set(['completed', 'canceled'])
const HREF = { initiative: '/initiatives', project: '/projects', workstream: '/workstreams' } as const

export default async function RoadmapPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string; sort?: string; find?: string; show?: string; links?: string }>
}) {
  const [query, jar] = await Promise.all([searchParams, cookies()])
  // The same three pickers as the home board, read the same way, so a link to
  // one carries over to the other.
  const prefs = resolveHomePrefs({ level: query.level, sort: query.sort }, jar.get(HOME_PREFS_COOKIE)?.value)
  const level = prefs.level
  const find = (query.find ?? '').trim().toLowerCase()
  const includeEnded = query.show === 'all'
  const showLinks = query.links !== '0'

  const [inits, projs, wss, ms, deps, settingRows, obs, assessRows, mine] = await Promise.all([
    db.select().from(initiatives).orderBy(asc(initiatives.name)),
    db.select().from(projects).orderBy(asc(projects.name)),
    db.select().from(workstreams).orderBy(asc(workstreams.name)),
    db.select().from(milestones),
    db.select().from(dependencies),
    db.select().from(settingsTable),
    db.select().from(agentObservations).where(isNull(agentObservations.supersededAt)),
    db.select().from(assessments),
    getCardOrder(level),
  ])

  const setting = (k: string) => settingRows.find((s) => s.key === k)?.value ?? null

  // The assessed colour of a piece of work, from whichever source has one.
  const ragOf = new Map<string, string>()
  for (const a of assessRows) if (a.current && a.rag) ragOf.set(`${a.entityType}:${a.entityId}`, a.rag)
  const activityOf = new Map<string, number>()
  for (const o of obs) {
    const key = `${o.entityType}:${o.entityId}`
    activityOf.set(key, (activityOf.get(key) ?? 0) + 1)
  }

  const liveWs = wss.filter((w) => includeEnded || !ENDED.has(w.status))
  const liveProjs = projs.filter((p) => includeEnded || !ENDED.has(p.status))
  const liveInits = inits.filter((i) => includeEnded || !ENDED.has(i.status))

  const wsByProject = new Map<string, typeof liveWs>()
  for (const w of liveWs) {
    if (!w.projectId) continue
    wsByProject.set(w.projectId, [...(wsByProject.get(w.projectId) ?? []), w])
  }
  const projByInit = new Map<string, typeof liveProjs>()
  for (const p of liveProjs) {
    if (!p.initiativeId) continue
    projByInit.set(p.initiativeId, [...(projByInit.get(p.initiativeId) ?? []), p])
  }

  /** Every id at or beneath one row — what its milestones roll up over. */
  const scopeOf = (id: string): Set<string> => {
    if (level === 'workstream') return new Set([id])
    if (level === 'project') return new Set([id, ...(wsByProject.get(id) ?? []).map((w) => w.id)])
    const kids = projByInit.get(id) ?? []
    return new Set([
      id,
      ...kids.map((p) => p.id),
      ...kids.flatMap((p) => (wsByProject.get(p.id) ?? []).map((w) => w.id)),
    ])
  }

  // Every date known beneath a record: its milestones, and — for a project —
  // its workstreams' windows too. This is what makes the bar agree with the
  // "rolled up" window the detail page shows; they used to disagree, because
  // the chart read the stored dates and nothing else.
  const msFor = (id: string) => ms.filter((m) => m.entityId === id).map((m) => m.targetDate)
  const beneathOf = (kind: keyof typeof HREF, id: string): Array<Date | null> => {
    const own = msFor(id)
    if (kind === 'workstream') return own
    if (kind === 'project') {
      const kids = wsByProject.get(id) ?? []
      return [...own, ...kids.flatMap((w) => [w.startDate, w.targetDate, ...msFor(w.id)])]
    }
    const kids = projByInit.get(id) ?? []
    return [...own, ...kids.flatMap((p) => [p.startDate, p.targetDate, ...beneathOf('project', p.id)])]
  }

  const child = (
    row: { id: string; name: string; status: string; startDate: Date | null; targetDate: Date | null },
    kind: keyof typeof HREF,
  ) => {
    const window = effectiveWindow(row, beneathOf(kind, row.id))
    return {
      id: row.id,
      name: row.name,
      href: `${HREF[kind]}/${row.id}`,
      status: row.status,
      rag: ragOf.get(`${kind}:${row.id}`) ?? null,
      startDate: window.start,
      targetDate: window.end,
    }
  }

  const source: SourceRow[] = (
    level === 'initiative' ? liveInits : level === 'project' ? liveProjs : liveWs
  ).map((row) => {
    const ids = scopeOf(row.id)
    return {
      id: row.id,
      name: row.name,
      href: `${HREF[level]}/${row.id}`,
      status: row.status,
      rank: row.sortOrder ?? 0,
      activity: [...ids].reduce(
        (n, id) => n + (activityOf.get(`initiative:${id}`) ?? 0) + (activityOf.get(`project:${id}`) ?? 0) + (activityOf.get(`workstream:${id}`) ?? 0),
        0,
      ),
      // At the lowest tier a row has no children, so it draws itself: a
      // workstream lane with nothing in it would be a name and empty space.
      children:
        level === 'initiative'
          ? (projByInit.get(row.id) ?? []).map((p) => child(p, 'project'))
          : level === 'project'
            ? (wsByProject.get(row.id) ?? []).map((w) => child(w, 'workstream'))
            : [child(row, 'workstream')],
      // Everything committed at or beneath this row, which is what makes an
      // initiative's lane worth looking at without opening its projects.
      marks: ms
        .filter((m) => ids.has(m.entityId))
        .map((m) => ({ id: m.id, name: m.name, status: m.status, targetDate: m.targetDate })),
    }
  })

  const found = find ? source.filter((r) => r.name.toLowerCase().includes(find)) : source

  // The same four sorts as the home board, and the same meaning.
  const rank = new Map(mine?.map((id, ix) => [id, ix]))
  const ordered = [...found].sort((a, b) => {
    if (prefs.sort === 'name') return a.name.localeCompare(b.name)
    if (prefs.sort === 'quiet') return a.activity - b.activity || a.name.localeCompare(b.name)
    if (prefs.sort === 'custom') {
      const ax = mine ? (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) : a.rank
      const bx = mine ? (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) : b.rank
      return ax - bx || a.name.localeCompare(b.name)
    }
    return b.activity - a.activity || a.name.localeCompare(b.name)
  })

  // The horizon: what was set, or the spread of the dated work padded by a
  // month at each end, so a fresh install with one quarter of work does not
  // render eighteen empty months.
  const stamps: number[] = []
  for (const r of ordered) {
    for (const c of r.children) {
      if (c.startDate) stamps.push(c.startDate.getTime())
      if (c.targetDate) stamps.push(c.targetDate.getTime())
    }
    for (const m of r.marks) if (m.targetDate) stamps.push(m.targetDate.getTime())
  }
  const now = new Date()
  const horizon =
    setting('portfolio.horizonStart') && setting('portfolio.horizonEnd')
      ? { start: new Date(setting('portfolio.horizonStart')!), end: new Date(setting('portfolio.horizonEnd')!) }
      : stamps.length
        ? { start: addMonths(new Date(Math.min(...stamps)), -1), end: addMonths(new Date(Math.max(...stamps)), 1) }
        : { start: addMonths(now, -1), end: addMonths(now, 11) }

  // Which row each end of a dependency sits in AT THIS LEVEL. A workstream's
  // dependency is its project's problem when you are looking at projects.
  const rowOf = new Map<string, string>()
  for (const r of ordered) for (const id of scopeOf(r.id)) rowOf.set(id, r.id)
  const planOf = new Map<string, { targetDate: Date | null; done: boolean }>()
  for (const p of projs) planOf.set(`project:${p.id}`, { targetDate: p.targetDate, done: ENDED.has(p.status) })
  for (const w of wss) planOf.set(`workstream:${w.id}`, { targetDate: w.targetDate, done: ENDED.has(w.status) })
  for (const i of inits) planOf.set(`initiative:${i.id}`, { targetDate: i.targetDate, done: ENDED.has(i.status) })
  for (const m of ms) planOf.set(`milestone:${m.id}`, { targetDate: m.targetDate, done: m.status === 'complete' })

  const depInputs: DepInput[] = deps.map((d) => ({
    id: d.id,
    fromRow: rowOf.get(d.fromId) ?? null,
    toRow: rowOf.get(d.toId) ?? null,
    fromAt: null,
    toAt: null,
    late: Boolean(lateness(d, planOf.get(`${d.fromType}:${d.fromId}`) ?? null, now)),
    label: `${d.fromLabel ?? d.fromId} → ${d.toLabel ?? d.toId}`,
  }))

  const model = buildTimeline(ordered, { ...horizon, now, deps: depInputs })

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Portfolio</Kicker>
          <h1>Timeline</h1>
        </div>
      </div>

      <TimelineControls
        level={level}
        sort={prefs.sort}
        find={query.find ?? ''}
        show={includeEnded ? 'all' : 'live'}
        links={showLinks}
        count={model.rows.length}
      />

      {model.rows.length === 0 ? (
        <p className="rt-empty">Nothing here matches those controls.</p>
      ) : (
        <TimelineView model={model} level={level} draggable={prefs.sort === 'custom'} showLinks={showLinks} />
      )}
    </div>
  )
}
