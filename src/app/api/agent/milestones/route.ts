/**
 * The program review plan: what a team says it is doing, and by when.
 *
 *   GET  /api/agent/milestones?entity=Sports
 *   POST /api/agent/milestones
 *
 * Protected by SYNC_TOKEN.
 *
 * WHAT THIS IS FOR
 *
 * Everything else an agent writes here is an observation: what a tracker said,
 * what a meeting decided. This is a plan — the thing a team states to a room
 * every other week — and it has lived in a slide deck, which meant the only
 * copy of "what are we trying to do on this workstream" was a file somebody
 * rebuilt by hand every fortnight.
 *
 * So the write path exists for two jobs, and they are different:
 *
 *   BOOTSTRAP. Read an existing deck and put what it says in here, once. The
 *   deck is the authority; this is transcription, and `replace` is correct.
 *
 *   KEEPING CURRENT. Between meetings, the bullets under a Status Update go
 *   stale. An agent that watches the work can move them, and that is a
 *   proposal about somebody's plan, not a fact. It is recorded as hers.
 *
 * WHAT IT REFUSES
 *
 * A milestone on a workstream that does not exist, a status or phase outside the
 * deck's own legend, and a calendar band whose months are not months. The
 * legend is the vocabulary the room reads; a value outside it would render as
 * a blank cell on a slide in a meeting.
 */
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  projects,
  workstreams,
  milestoneItems,
  milestonePhases,
  milestones,
} from '@/db/schema'
import {
  WORKSTREAM_ITEM_STATE,
  WORKSTREAM_PHASE,
  WORKSTREAM_STATUS,
  isPeriod,
} from '@/lib/domain'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = new Set<string>(WORKSTREAM_STATUS)
const STATES = new Set<string>(WORKSTREAM_ITEM_STATE)
const PHASES = new Set<string>(WORKSTREAM_PHASE)

interface IncomingItem {
  state?: string
  text?: string
}

interface IncomingPhase {
  phase?: string
  label?: string | null
  fromPeriod?: string
  toPeriod?: string
}

interface IncomingWorkstream {
  name?: string
  details?: string | null
  status?: string
  targetLabel?: string | null
  dependencies?: string | null
  items?: IncomingItem[]
  phases?: IncomingPhase[]
  /**
   * What the agent changed on this row and why — one line per judgement call.
   *
   * Sent only on a merge, because a replace is a transcription of somebody's
   * deck and carries no judgement to explain. Stored so the deck can print it
   * beside the row it changed.
   */
  agentNote?: string | null
}

interface Incoming {
  agent?: string
  workstreamId?: string
  /** Owner is a Person elsewhere; these two are the deck's free-text pairings. */
  devLead?: string | null
  programLead?: string | null
  /**
   * replace — this workstream's plan is now exactly what is in this payload.
   *           Right for a deck: the deck is the authority and a milestone it
   *           no longer lists has been dropped, not forgotten.
   * merge   — update the ones named here by name, leave the rest alone. Right
   *           for keeping a plan current without claiming to restate it.
   */
  mode?: 'replace' | 'merge'
  milestones?: IncomingWorkstream[]
}

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  let body: Incoming
  try {
    body = (await req.json()) as Incoming
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const agent = (body.agent ?? 'yaara').slice(0, 64)
  const workstreamId = String(body.workstreamId ?? '')
  const mode = body.mode === 'merge' ? 'merge' : 'replace'
  const dropped: string[] = []

  const [workstream] = await db.select().from(workstreams).where(eq(workstreams.id, workstreamId)).limit(1)
  if (!workstream) return Response.json({ error: `No workstream with id ${workstreamId}.` }, { status: 400 })

  // The two names that sit beside Owner on the slide. Only overwritten when
  // supplied: a payload about milestones should not blank them.
  if (body.devLead !== undefined || body.programLead !== undefined) {
    await db
      .update(workstreams)
      .set({
        ...(body.devLead !== undefined ? { devLead: body.devLead?.slice(0, 200) ?? null } : {}),
        ...(body.programLead !== undefined
          ? { programLead: body.programLead?.slice(0, 200) ?? null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(workstreams.id, workstreamId))
  }

  const existing = await db
    .select()
    .from(milestones)
    .where(eq(milestones.entityId, workstreamId))
    .orderBy(asc(milestones.sortOrder))

  const byName = new Map(existing.map((w) => [w.name.trim().toLowerCase(), w]))
  const keep = new Set<string>()
  const written: string[] = []

  let order = 0
  for (const raw of body.milestones ?? []) {
    const name = String(raw.name ?? '').trim()
    if (!name) {
      dropped.push('a milestone with no name')
      continue
    }

    const status = STATUSES.has(String(raw.status)) ? String(raw.status) : 'planning'
    const values = {
      level: 'workstream' as const,
      entityId: workstreamId,
      name: name.slice(0, 200),
      details: raw.details ? String(raw.details).slice(0, 1000) : null,
      status,
      targetLabel: raw.targetLabel ? String(raw.targetLabel).slice(0, 80) : null,
      dependencies: raw.dependencies ? String(raw.dependencies).slice(0, 1000) : null,
      sortOrder: order++,
      authoredBy: agent,
      updatedAt: new Date(),
      // Only on a merge. A replace restates somebody's deck; there is no
      // judgement in it to explain, and carrying a stale note onto a freshly
      // transcribed row would attribute a decision to her that she did not make.
      ...(mode === 'merge' && raw.agentNote !== undefined
        ? {
            agentNote: raw.agentNote ? String(raw.agentNote).slice(0, 2000) : null,
            agentNoteAt: raw.agentNote ? new Date() : null,
          }
        : mode === 'replace'
          ? { agentNote: null, agentNoteAt: null }
          : {}),
    }

    const found = byName.get(name.toLowerCase())
    let id: string
    if (found) {
      await db.update(milestones).set(values).where(eq(milestones.id, found.id))
      id = found.id
    } else {
      const [row] = await db.insert(milestones).values(values).returning()
      id = row.id
    }
    keep.add(id)
    written.push(name)

    // Items and phases are replaced wholesale for a milestone that was named.
    // They are a snapshot of a list, and merging two versions of "what is in
    // progress" produces a list that was never true at any moment.
    if (raw.items) {
      await db.delete(milestoneItems).where(eq(milestoneItems.milestoneId, id))
      const items = raw.items
        .map((i, ix) => ({
          milestoneId: id,
          state: STATES.has(String(i.state)) ? String(i.state) : 'in_progress',
          text: String(i.text ?? '').trim().slice(0, 500),
          sortOrder: ix,
          authoredBy: agent,
        }))
        .filter((i) => i.text)
      if (items.length) await db.insert(milestoneItems).values(items)
    }

    if (raw.phases) {
      await db.delete(milestonePhases).where(eq(milestonePhases.milestoneId, id))
      const phases = raw.phases
        .filter((p) => {
          const ok = isPeriod(String(p.fromPeriod)) && isPeriod(String(p.toPeriod))
          if (!ok) dropped.push(`${name}: a calendar band with months that are not months`)
          return ok
        })
        .map((p) => ({
          milestoneId: id,
          phase: PHASES.has(String(p.phase)) ? String(p.phase) : 'tbd',
          label: p.label ? String(p.label).slice(0, 80) : null,
          fromPeriod: String(p.fromPeriod),
          toPeriod: String(p.toPeriod),
        }))
      if (phases.length) await db.insert(milestonePhases).values(phases)
    }
  }

  // A deck is a complete statement of the plan, so anything it stopped listing
  // is gone rather than merely unmentioned. A merge says nothing about the
  // ones it did not name.
  let removed = 0
  if (mode === 'replace') {
    const stale = existing.filter((w) => !keep.has(w.id)).map((w) => w.id)
    if (stale.length) {
      await db.delete(milestones).where(inArray(milestones.id, stale))
      removed = stale.length
    }
  }

  return Response.json({ workstream: workstream.name, written, removed, mode, dropped })
}

/**
 * The plan, for one piece of work or all of it.
 *
 * Shaped for rendering: a caller building a slide should not have to stitch
 * three tables together and guess at the ordering the team reads them in.
 */
export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  const needle = (new URL(req.url).searchParams.get('entity') ?? '').trim().toLowerCase()

  const [projs, inits, rows, items, phases] = await Promise.all([
    db.select().from(workstreams),
    db.select({ id: projects.id, name: projects.name, ownerId: projects.ownerId }).from(projects),
    db.select().from(milestones).orderBy(asc(milestones.sortOrder)),
    db.select().from(milestoneItems).orderBy(asc(milestoneItems.sortOrder)),
    db.select().from(milestonePhases),
  ])

  const projectName = new Map(inits.map((i) => [i.id, i.name]))
  const itemsFor = new Map<string, typeof items>()
  for (const i of items) itemsFor.set(i.milestoneId, [...(itemsFor.get(i.milestoneId) ?? []), i])
  const phasesFor = new Map<string, typeof phases>()
  for (const p of phases) phasesFor.set(p.milestoneId, [...(phasesFor.get(p.milestoneId) ?? []), p])

  const wanted = projs.filter((p) => {
    if (!needle) return true
    const project = p.projectId ? (projectName.get(p.projectId) ?? '') : ''
    return p.name.toLowerCase().includes(needle) || project.toLowerCase().includes(needle)
  })

  return Response.json({
    workstreams: wanted.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      project: p.projectId ? (projectName.get(p.projectId) ?? null) : null,
      projectId: p.projectId,
      devLead: p.devLead,
      programLead: p.programLead,
      milestones: rows
        .filter((w) => w.entityId === p.id)
        .map((w) => ({
          id: w.id,
          name: w.name,
          details: w.details,
          status: w.status,
          targetLabel: w.targetLabel,
          // The real date, alongside the label the deck prints. The label is
          // whatever a slide said ("early Q4"); the date is what an agent can
          // count days against, and a health call needs the second one.
          targetDate: w.targetDate ? w.targetDate.toISOString().slice(0, 10) : null,
          actualDate: w.actualDate ? w.actualDate.toISOString().slice(0, 10) : null,
          dependencies: w.dependencies,
          authoredBy: w.authoredBy,
          agentNote: w.agentNote,
          agentNoteAt: w.agentNoteAt,
          items: (itemsFor.get(w.id) ?? []).map((i) => ({ state: i.state, text: i.text })),
          phases: (phasesFor.get(w.id) ?? []).map((ph) => ({
            phase: ph.phase,
            label: ph.label,
            fromPeriod: ph.fromPeriod,
            toPeriod: ph.toPeriod,
          })),
        })),
    })),
  })
}
