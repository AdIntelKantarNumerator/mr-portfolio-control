/**
 * The timeline chart's data, for the whole portfolio or for one record.
 *
 * WHY THIS IS NOT IN THE PAGE ANY MORE
 *
 * All of it lived in app/roadmap/page.tsx, which was fine while the Timeline
 * page was the only thing that drew a chart. A detail page now draws one too —
 * the same lane, the same bars, the same dependency lines, for the one record
 * you are looking at — and two copies of two hundred lines of window
 * arithmetic is two answers to "when does this initiative run", which is the
 * question the chart exists to settle.
 *
 * `only` is the whole difference between the two callers: given an id, the
 * source is narrowed to that record's lane before the horizon is worked out,
 * so a detail chart spans its own work rather than the portfolio's.
 */
import { asc, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  agentObservations,
  assessments,
  dependencies,
  objectives,
  milestones,
  initiatives,
  settings as settingsTable,
  projects,
} from '@/db/schema'
import { lateness } from './dependency-risk'
import { addMonths, buildTimeline, type DepInput, type SourceRow, type TimelineModel } from './timeline-model'
import { rollUpWindow } from './rollup-window'
import type { Level, Sort } from './home-types'

const ENDED = new Set(['completed', 'canceled'])
const HREF = { objective: '/objectives', initiative: '/initiatives', project: '/projects' } as const

export interface TimelineQuery {
  level: Level
  /** Which sort to apply. Ignored when `only` narrows it to one lane. */
  sort?: Sort
  /**
   * An explicit order for the 'custom' sort. Nothing passes one since the
   * order became shared (2 October 2026): custom then uses sort_order.
   */
  order?: string[] | null
  find?: string
  includeEnded?: boolean
  /** Draw only this record's lane — what a detail page asks for. */
  only?: string
}

export async function timelineModel(q: TimelineQuery): Promise<TimelineModel> {
  const level = q.level
  const find = (q.find ?? '').trim().toLowerCase()
  const includeEnded = q.includeEnded ?? false
  const mine = q.order ?? null
  const prefs = { sort: q.sort ?? 'busy' }

  const [inits, projs, wss, ms, deps, settingRows, obs, assessRows] = await Promise.all([
    db.select().from(objectives).orderBy(asc(objectives.name)),
    db.select().from(initiatives).orderBy(asc(initiatives.name)),
    db.select().from(projects).orderBy(asc(projects.name)),
    db.select().from(milestones),
    db.select().from(dependencies),
    db.select().from(settingsTable),
    db.select().from(agentObservations).where(isNull(agentObservations.supersededAt)),
    db.select().from(assessments),
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

  const wsByInitiative = new Map<string, typeof liveWs>()
  for (const w of liveWs) {
    if (!w.initiativeId) continue
    wsByInitiative.set(w.initiativeId, [...(wsByInitiative.get(w.initiativeId) ?? []), w])
  }
  const projByInit = new Map<string, typeof liveProjs>()
  for (const p of liveProjs) {
    if (!p.objectiveId) continue
    projByInit.set(p.objectiveId, [...(projByInit.get(p.objectiveId) ?? []), p])
  }

  /** Every id at or beneath one row — what its milestones roll up over. */
  const scopeOf = (id: string): Set<string> => {
    if (level === 'project') return new Set([id])
    if (level === 'initiative') return new Set([id, ...(wsByInitiative.get(id) ?? []).map((w) => w.id)])
    const kids = projByInit.get(id) ?? []
    return new Set([
      id,
      ...kids.map((p) => p.id),
      ...kids.flatMap((p) => (wsByInitiative.get(p.id) ?? []).map((w) => w.id)),
    ])
  }

  /*
   * Every date known beneath a record, from the UNFILTERED lists.
   *
   * This is the half of the bug that was hardest to see. `wsByInitiative` and
   * `projByInit` are built from the rows the chart is about to draw, so with
   * Health set to "Live only" a completed project dropped out of its
   * initiative's window — and the initiative's bar moved, or vanished, because of a
   * filter that was only ever meant to change what was listed. A window is a
   * fact about the work; which rows you are looking at is a question about
   * the screen.
   */
  const allWsByInitiative = new Map<string, typeof wss>()
  for (const w of wss) {
    if (!w.initiativeId) continue
    allWsByInitiative.set(w.initiativeId, [...(allWsByInitiative.get(w.initiativeId) ?? []), w])
  }
  const allProjByInit = new Map<string, typeof projs>()
  for (const p of projs) {
    if (!p.objectiveId) continue
    allProjByInit.set(p.objectiveId, [...(allProjByInit.get(p.objectiveId) ?? []), p])
  }

  const msFor = (id: string) => ms.filter((m) => m.entityId === id).map((m) => m.targetDate)
  const beneathOf = (kind: keyof typeof HREF, id: string): Array<Date | null> => {
    const own = msFor(id)
    if (kind === 'project') return own
    if (kind === 'initiative') {
      const kids = allWsByInitiative.get(id) ?? []
      return [...own, ...kids.flatMap((w) => [w.startDate, w.targetDate, ...msFor(w.id)])]
    }
    const kids = allProjByInit.get(id) ?? []
    return [...own, ...kids.flatMap((p) => [p.startDate, p.targetDate, ...beneathOf('initiative', p.id)])]
  }

  const child = (
    row: { id: string; name: string; status: string; startDate: Date | null; targetDate: Date | null },
    kind: keyof typeof HREF,
  ) => {
    const window = rollUpWindow(row, beneathOf(kind, row.id))
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
    level === 'objective' ? liveInits : level === 'initiative' ? liveProjs : liveWs
  ).map((row) => {
    const ids = scopeOf(row.id)
    return {
      id: row.id,
      name: row.name,
      href: `${HREF[level]}/${row.id}`,
      status: row.status,
      rank: row.sortOrder ?? 0,
      activity: [...ids].reduce(
        (n, id) => n + (activityOf.get(`objective:${id}`) ?? 0) + (activityOf.get(`initiative:${id}`) ?? 0) + (activityOf.get(`project:${id}`) ?? 0),
        0,
      ),
      // At the lowest tier a row has no children, so it draws itself: a
      // project lane with nothing in it would be a name and empty space.
      children:
        level === 'objective'
          ? (projByInit.get(row.id) ?? []).map((p) => child(p, 'initiative'))
          : level === 'initiative'
            ? (wsByInitiative.get(row.id) ?? []).map((w) => child(w, 'project'))
            : [child(row, 'project')],
      // Everything committed at or beneath this row, which is what makes an
      // objective's lane worth looking at without opening its initiatives.
      marks: ms
        .filter((m) => ids.has(m.entityId))
        .map((m) => ({ id: m.id, name: m.name, status: m.status, targetDate: m.targetDate })),
    }
  })

  /*
   * One lane, when a detail page asked for one.
   *
   * Done here rather than by filtering the query, because a lane's children
   * and its milestones are gathered from the same maps the whole-board case
   * builds — narrowing earlier would mean a second way of assembling a row,
   * and it is the assembling that has the bugs in it.
   */
  const scoped = q.only ? source.filter((r) => r.id === q.only) : source
  const found = find ? scoped.filter((r) => r.name.toLowerCase().includes(find)) : scoped

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

  // Which row each end of a dependency sits in AT THIS LEVEL. A project's
  // dependency is its initiative's problem when you are looking at initiatives.
  const rowOf = new Map<string, string>()
  for (const r of ordered) for (const id of scopeOf(r.id)) rowOf.set(id, r.id)
  const planOf = new Map<string, { targetDate: Date | null; done: boolean }>()
  for (const p of projs) planOf.set(`initiative:${p.id}`, { targetDate: p.targetDate, done: ENDED.has(p.status) })
  for (const w of wss) planOf.set(`project:${w.id}`, { targetDate: w.targetDate, done: ENDED.has(w.status) })
  for (const i of inits) planOf.set(`objective:${i.id}`, { targetDate: i.targetDate, done: ENDED.has(i.status) })
  for (const m of ms) planOf.set(`milestone:${m.id}`, { targetDate: m.targetDate, done: m.status === 'complete' })

  /*
   * What to call each end when the line is hovered.
   *
   * `fromLabel`/`toLabel` are only set for `external` ends — a vendor feed,
   * another org's deliverable — because those have no record to read a name
   * from. Every other end fell through to the raw id, so hovering a line
   * between two initiatives showed a pair of UUIDs.
   */
  const nameOf = new Map<string, string>()
  for (const i of inits) nameOf.set(i.id, i.name)
  for (const pr of projs) nameOf.set(pr.id, pr.name)
  for (const w of wss) nameOf.set(w.id, w.name)
  for (const m of ms) nameOf.set(m.id, m.name)
  const endName = (id: string, stored: string | null) => stored ?? nameOf.get(id) ?? id

  const depInputs: DepInput[] = deps.map((d) => ({
    id: d.id,
    fromRow: rowOf.get(d.fromId) ?? null,
    toRow: rowOf.get(d.toId) ?? null,
    // What each end actually is, so the line can find its own bar rather than
    // settling for the row it is drawn in.
    fromId: d.fromId,
    toId: d.toId,
    fromAt: null,
    toAt: null,
    late: Boolean(lateness(d, planOf.get(`${d.fromType}:${d.fromId}`) ?? null, now)),
    label: `${endName(d.fromId, d.fromLabel)} → ${endName(d.toId, d.toLabel)}`,
  }))

  return buildTimeline(ordered, { ...horizon, now, deps: depInputs })
}
