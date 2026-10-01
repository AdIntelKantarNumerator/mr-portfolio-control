/**
 * What Yaara can read about the rest of the portfolio, for answering
 * questions in chat.
 *
 *   GET /api/agent/lookup?area=<area>&q=<filter>
 *
 * WHY THIS WIDENS WHAT SHE SEES, AND HOW FAR
 *
 * GET /api/agent/portfolio is deliberately narrow: names, status, people. It
 * says so, because everything an agent can read is something a prompt
 * injected into a PR title or a Slack message could steer it towards. The
 * chat changed the question. People now ask her about anything on any
 * screen ("what is top of the intake list?", "what does Sports Sponsorship
 * load?"), and "I cannot see that" is not an answer to a question about our
 * own system of record.
 *
 * So this is wider, under three limits:
 *
 *   1. Read-only. Nothing here changes anything, and there is no write that
 *      goes with it.
 *   2. Lines, not records. Each area comes back as short sentences a person
 *      could read off the screen: no ids, no email addresses, no free-text
 *      fields longer than a line. What she can quote is what the screen shows.
 *   3. One area per call, at most LIMIT lines, filtered by `q`. She asks for
 *      what the question needs rather than holding the whole portfolio in
 *      every prompt.
 *
 * Areas that already have a route (objectives and everything under them,
 * blockers and decisions, action items, dates and milestones) are not
 * repeated here; she has tools for those.
 */
import { asc, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  allocations,
  briefs,
  changelogEntries,
  dependencies,
  initiatives,
  intakeRequests,
  lifecycleGates,
  objectives,
  people,
  projectReadiness,
  projects,
  readinessItems,
  teams,
} from '@/db/schema'
import { getScoringContext, scoreForRequest } from './scoring'
import { readWorkflowMap } from './workflow'
import { readCatalog, readDictionaryNotes } from './dictionary'
import { DATABASE_STATUS_LABEL, DATASET_STATUS_LABEL, INTENT_LABEL, datasetStatus, readDatabaseStatus, readEmptyReason, readIntent, type EmptyReason } from './dictionary-rules'
import { KIND_LABEL } from './workflow-map'
import { LIMIT, filterLines, line, type LookupArea } from './agent-lookup-rules'

export { AREA_HELP, LOOKUP_AREAS, readArea, type LookupArea } from './agent-lookup-rules'

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

async function names() {
  const [objs, inits, projs, folk] = await Promise.all([
    db.select({ id: objectives.id, name: objectives.name }).from(objectives),
    db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives),
    db.select({ id: projects.id, name: projects.name, status: projects.status }).from(projects),
    db.select({ id: people.id, name: people.name }).from(people),
  ])
  const byType: Record<string, Map<string, string>> = {
    objective: new Map(objs.map((o) => [o.id, o.name])),
    initiative: new Map(inits.map((i) => [i.id, i.name])),
    project: new Map(projs.map((p) => [p.id, p.name])),
  }
  return {
    entity: (type: string, id: string | null | undefined) => (id ? byType[type]?.get(id) ?? null : null),
    person: new Map(folk.map((p) => [p.id, p.name])),
    projects: projs,
  }
}

async function intake(): Promise<string[]> {
  const [rows, ctx] = await Promise.all([db.select().from(intakeRequests).orderBy(desc(intakeRequests.createdAt)), getScoringContext()])
  return rows.map((r) => {
    const s = scoreForRequest(ctx, r.id)
    return line(
      `${r.ref} ${r.title}`,
      `status ${r.status}`,
      `asked by ${r.requesterName}`,
      r.sponsor ? `sponsor ${r.sponsor}` : null,
      r.desiredDate ? `wanted by ${day(r.desiredDate)}${r.hardDate ? ' (hard date)' : ''}` : null,
      r.tshirt ? `size ${r.tshirt}` : null,
      s.score !== null ? `score ${s.score.toFixed(1)} (${s.scored} of ${s.total} criteria scored)` : ctx.model ? 'not scored' : null,
      `problem: ${r.problem}`,
    )
  })
}

async function prioritization(): Promise<{ lines: string[]; note: string | null }> {
  const [rows, ctx] = await Promise.all([db.select().from(intakeRequests), getScoringContext()])
  if (!ctx.model) return { lines: [], note: 'No scoring model is active, so nothing is ranked.' }
  const ranked = rows
    .filter((r) => !['rejected', 'converted'].includes(r.status))
    .map((r) => ({ r, s: scoreForRequest(ctx, r.id) }))
    .sort((a, b) => (b.s.score ?? -1) - (a.s.score ?? -1))
  return {
    note: `Ranked by "${ctx.model.name}"${ctx.model.capacityUnits ? `, capacity ${ctx.model.capacityUnits} ${ctx.model.capacityLabel ?? ''}`.trimEnd() : ''}. Rejected and converted requests are left out.`,
    lines: ranked.map(({ r, s }, i) =>
      line(`${i + 1}. ${r.ref} ${r.title}`, s.score !== null ? `score ${s.score.toFixed(1)}` : 'unscored', `${s.scored}/${s.total} criteria`, `status ${r.status}`, r.tshirt ? `size ${r.tshirt}` : null),
    ),
  }
}

async function deps(): Promise<string[]> {
  const [rows, n] = await Promise.all([db.select().from(dependencies).orderBy(asc(dependencies.status), asc(dependencies.dueDate)), names()])
  return rows.map((d) =>
    line(
      `${d.fromLabel ?? n.entity(d.fromType, d.fromId) ?? `an unnamed ${d.fromType}`} ${d.kind === 'blocks' ? 'is waiting on' : d.kind} ${d.toLabel ?? n.entity(d.toType, d.toId) ?? `an unnamed ${d.toType}`}`,
      `status ${d.status}`,
      d.criticality !== 'normal' ? `criticality ${d.criticality}` : null,
      d.dueDate ? `due ${day(d.dueDate)}` : null,
      d.ownerId ? `owner ${n.person.get(d.ownerId) ?? 'unknown'}` : 'no owner',
      d.description,
    ),
  )
}

async function readiness(): Promise<string[]> {
  const [gates, items, marks, n] = await Promise.all([
    db.select().from(lifecycleGates).orderBy(asc(lifecycleGates.sortOrder)),
    db.select().from(readinessItems).orderBy(asc(readinessItems.sortOrder)),
    db.select().from(projectReadiness),
    names(),
  ])
  const required = items.filter((i) => i.required)
  const gateName = new Map(gates.map((g) => [g.id, g.name]))
  const statusOf = new Map(marks.map((m) => [`${m.projectId}:${m.itemId}`, m.status]))
  const active = n.projects.filter((p) => !['done', 'cancelled', 'canceled', 'complete', 'completed'].includes(p.status))
  return active
    .map((p) => {
      const open = required.filter((i) => !['done', 'na'].includes(statusOf.get(`${p.id}:${i.id}`) ?? 'not_started'))
      const touched = required.some((i) => statusOf.has(`${p.id}:${i.id}`))
      if (!touched) return null
      return line(
        p.name,
        `${required.length - open.length} of ${required.length} required items done`,
        open.length ? `open: ${open.slice(0, 6).map((i) => `${i.label} (${gateName.get(i.gateId) ?? 'gate'})`).join(', ')}${open.length > 6 ? `, and ${open.length - 6} more` : ''}` : 'ready',
      )
    })
    .filter((l): l is string => l !== null)
}

async function teamLines(): Promise<string[]> {
  const [ts, alloc, n] = await Promise.all([db.select().from(teams).where(eq(teams.archived, false)).orderBy(asc(teams.name)), db.select().from(allocations), names()])
  return ts.map((t) => {
    const mine = alloc.filter((a) => a.teamId === t.id)
    return line(
      `${t.name} (${t.kind}${t.headcount ? `, ${t.headcount} people` : ''})`,
      mine.length
        ? `works on ${mine.map((a) => `${n.entity('initiative', a.initiativeId) ?? 'an unnamed initiative'}${a.mode !== 'primary' ? ` (${a.mode})` : ''}${a.share ? ` ${Math.round(a.share * 100)}%` : ''}`).join(', ')}`
        : 'not allocated to anything',
    )
  })
}

async function activity(): Promise<string[]> {
  const rows = await db.select().from(changelogEntries).orderBy(desc(changelogEntries.at)).limit(LIMIT)
  return rows.map((c) => line(c.at.toISOString().slice(0, 16).replace('T', ' '), c.actor, c.summary))
}

async function workflow(): Promise<string[]> {
  const map = await readWorkflowMap()
  const name = new Map(map.components.map((c) => [c.id, c.name]))
  const group = new Map(map.groups.map((g) => [g.key, g.name]))
  return map.components.map((c) => {
    const feeds = map.links.filter((l) => l.from === c.id).map((l) => name.get(l.to)).filter(Boolean)
    const fedBy = map.links.filter((l) => l.to === c.id).map((l) => name.get(l.from)).filter(Boolean)
    return line(
      `${c.name} (${KIND_LABEL[c.kind as keyof typeof KIND_LABEL] ?? c.kind}, ${group.get(c.groupKey ?? '') ?? 'ungrouped'})`,
      c.owner ? `owner ${c.owner}` : null,
      c.description,
      feeds.length ? `feeds ${feeds.join(', ')}` : null,
      fedBy.length ? `fed by ${fedBy.join(', ')}` : null,
    )
  })
}

async function dictionary(): Promise<{ lines: string[]; note: string | null }> {
  const [notes, result] = await Promise.all([readDictionaryNotes(), readCatalog('dev')])
  const catalog = result.state === 'ok' ? new Map(result.catalog.tables.map((t) => [t.ref, { rows: t.rows }])) : null
  const reasons = new Map<string, EmptyReason>()
  for (const t of notes.tables) {
    const r = readEmptyReason(t.emptyReason)
    if (r) reasons.set(t.tableRef, r)
  }
  const lines: string[] = []
  for (const d of notes.datasets) {
    const { status, tables } = datasetStatus(d.tables, catalog, reasons)
    // Only when ClickHouse was read: with no catalog every table looks "missing",
    // which would read as a fact about the warehouse rather than about this read.
    const empty = catalog ? tables.filter((t) => t.state !== 'rows').map((t) => `${t.ref} (${t.state})`) : []
    lines.push(
      line(
        `Dataset ${d.name}`,
        `Dev: ${DATASET_STATUS_LABEL[status]}`,
        `meant to be ${INTENT_LABEL[readIntent(d.intentDev) ?? 'undecided']} in Dev and ${INTENT_LABEL[readIntent(d.intentProd) ?? 'undecided']} in Prod`,
        d.owner ? `owner ${d.owner}` : null,
        `${tables.length} tables`,
        empty.length ? `not holding rows: ${empty.slice(0, 5).join(', ')}${empty.length > 5 ? ` and ${empty.length - 5} more` : ''}` : null,
        d.description,
      ),
    )
  }
  for (const db_ of notes.databases) {
    lines.push(line(`Schema ${db_.name}`, DATABASE_STATUS_LABEL[readDatabaseStatus(db_.status) ?? 'unreviewed'], db_.description))
  }
  for (const t of notes.tables.filter((t) => t.watchOut || t.description)) {
    lines.push(line(`Table ${t.tableRef}`, t.description, t.watchOut ? `watch out: ${t.watchOut}` : null))
  }
  return {
    lines,
    note:
      result.state === 'ok'
        ? `Loaded status read live from ClickHouse Dev at ${result.catalog.readAt.slice(11, 16)} UTC. Prod is not connected yet.`
        : 'ClickHouse Dev could not be read just now, so loaded status is unknown; the notes are still current.',
  }
}

async function briefLines(): Promise<string[]> {
  const [rows, n] = await Promise.all([db.select().from(briefs).where(isNull(briefs.supersededAt)).orderBy(desc(briefs.createdAt)), names()])
  return rows.map((b) => {
    let items: string[] = []
    try {
      const parsed = JSON.parse(b.items) as Array<{ text?: string; kind?: string }>
      items = parsed.map((i) => `${i.kind ? `${i.kind}: ` : ''}${i.text ?? ''}`).filter((t) => t.trim())
    } catch {
      items = []
    }
    return line(`${n.entity(b.entityType, b.entityId) ?? `an unnamed ${b.entityType}`}`, `brief of ${day(b.createdAt)}`, items.slice(0, 5).join('; '))
  })
}

/** One area, filtered and capped. */
export async function lookup(area: LookupArea, q: string | null): Promise<{ area: LookupArea; total: number; shown: number; note: string | null; lines: string[] }> {
  let lines: string[]
  let note: string | null = null
  switch (area) {
    case 'intake':
      lines = await intake()
      break
    case 'prioritization':
      ;({ lines, note } = await prioritization())
      break
    case 'dependencies':
      lines = await deps()
      break
    case 'readiness':
      lines = await readiness()
      break
    case 'teams':
      lines = await teamLines()
      break
    case 'activity':
      lines = await activity()
      break
    case 'workflow':
      lines = await workflow()
      break
    case 'dictionary':
      ;({ lines, note } = await dictionary())
      break
    case 'briefs':
      lines = await briefLines()
      break
  }
  const matched = filterLines(lines, q)
  return { area, total: matched.length, shown: Math.min(matched.length, LIMIT), note, lines: matched.slice(0, LIMIT) }
}
