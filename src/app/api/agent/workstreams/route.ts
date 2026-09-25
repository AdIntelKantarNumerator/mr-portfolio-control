/**
 * The program review plan: what a team says it is doing, and by when.
 *
 *   GET  /api/agent/workstreams?entity=Sports
 *   POST /api/agent/workstreams
 *
 * Protected by SYNC_TOKEN.
 *
 * WHAT THIS IS FOR
 *
 * Everything else an agent writes here is an observation: what a tracker said,
 * what a meeting decided. This is a plan — the thing a team states to a room
 * every other week — and it has lived in a slide deck, which meant the only
 * copy of "what are we trying to do on this project" was a file somebody
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
 * A workstream on a project that does not exist, a status or phase outside the
 * deck's own legend, and a calendar band whose months are not months. The
 * legend is the vocabulary the room reads; a value outside it would render as
 * a blank cell on a slide in a meeting.
 */
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  initiatives,
  projects,
  workstreamItems,
  workstreamPhases,
  workstreams,
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
  projectId?: string
  /** Owner is a Person elsewhere; these two are the deck's free-text pairings. */
  devLead?: string | null
  programLead?: string | null
  /**
   * replace — this project's plan is now exactly what is in this payload.
   *           Right for a deck: the deck is the authority and a workstream it
   *           no longer lists has been dropped, not forgotten.
   * merge   — update the ones named here by name, leave the rest alone. Right
   *           for keeping a plan current without claiming to restate it.
   */
  mode?: 'replace' | 'merge'
  workstreams?: IncomingWorkstream[]
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
  const projectId = String(body.projectId ?? '')
  const mode = body.mode === 'merge' ? 'merge' : 'replace'
  const dropped: string[] = []

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) return Response.json({ error: `No project with id ${projectId}.` }, { status: 400 })

  // The two names that sit beside Owner on the slide. Only overwritten when
  // supplied: a payload about workstreams should not blank them.
  if (body.devLead !== undefined || body.programLead !== undefined) {
    await db
      .update(projects)
      .set({
        ...(body.devLead !== undefined ? { devLead: body.devLead?.slice(0, 200) ?? null } : {}),
        ...(body.programLead !== undefined
          ? { programLead: body.programLead?.slice(0, 200) ?? null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId))
  }

  const existing = await db
    .select()
    .from(workstreams)
    .where(eq(workstreams.projectId, projectId))
    .orderBy(asc(workstreams.sortOrder))

  const byName = new Map(existing.map((w) => [w.name.trim().toLowerCase(), w]))
  const keep = new Set<string>()
  const written: string[] = []

  let order = 0
  for (const raw of body.workstreams ?? []) {
    const name = String(raw.name ?? '').trim()
    if (!name) {
      dropped.push('a workstream with no name')
      continue
    }

    const status = STATUSES.has(String(raw.status)) ? String(raw.status) : 'planning'
    const values = {
      projectId,
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
      await db.update(workstreams).set(values).where(eq(workstreams.id, found.id))
      id = found.id
    } else {
      const [row] = await db.insert(workstreams).values(values).returning()
      id = row.id
    }
    keep.add(id)
    written.push(name)

    // Items and phases are replaced wholesale for a workstream that was named.
    // They are a snapshot of a list, and merging two versions of "what is in
    // progress" produces a list that was never true at any moment.
    if (raw.items) {
      await db.delete(workstreamItems).where(eq(workstreamItems.workstreamId, id))
      const items = raw.items
        .map((i, ix) => ({
          workstreamId: id,
          state: STATES.has(String(i.state)) ? String(i.state) : 'in_progress',
          text: String(i.text ?? '').trim().slice(0, 500),
          sortOrder: ix,
          authoredBy: agent,
        }))
        .filter((i) => i.text)
      if (items.length) await db.insert(workstreamItems).values(items)
    }

    if (raw.phases) {
      await db.delete(workstreamPhases).where(eq(workstreamPhases.workstreamId, id))
      const phases = raw.phases
        .filter((p) => {
          const ok = isPeriod(String(p.fromPeriod)) && isPeriod(String(p.toPeriod))
          if (!ok) dropped.push(`${name}: a calendar band with months that are not months`)
          return ok
        })
        .map((p) => ({
          workstreamId: id,
          phase: PHASES.has(String(p.phase)) ? String(p.phase) : 'tbd',
          label: p.label ? String(p.label).slice(0, 80) : null,
          fromPeriod: String(p.fromPeriod),
          toPeriod: String(p.toPeriod),
        }))
      if (phases.length) await db.insert(workstreamPhases).values(phases)
    }
  }

  // A deck is a complete statement of the plan, so anything it stopped listing
  // is gone rather than merely unmentioned. A merge says nothing about the
  // ones it did not name.
  let removed = 0
  if (mode === 'replace') {
    const stale = existing.filter((w) => !keep.has(w.id)).map((w) => w.id)
    if (stale.length) {
      await db.delete(workstreams).where(inArray(workstreams.id, stale))
      removed = stale.length
    }
  }

  return Response.json({ project: project.name, written, removed, mode, dropped })
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
    db.select().from(projects),
    db.select({ id: initiatives.id, name: initiatives.name, ownerId: initiatives.ownerId }).from(initiatives),
    db.select().from(workstreams).orderBy(asc(workstreams.sortOrder)),
    db.select().from(workstreamItems).orderBy(asc(workstreamItems.sortOrder)),
    db.select().from(workstreamPhases),
  ])

  const initiativeName = new Map(inits.map((i) => [i.id, i.name]))
  const itemsFor = new Map<string, typeof items>()
  for (const i of items) itemsFor.set(i.workstreamId, [...(itemsFor.get(i.workstreamId) ?? []), i])
  const phasesFor = new Map<string, typeof phases>()
  for (const p of phases) phasesFor.set(p.workstreamId, [...(phasesFor.get(p.workstreamId) ?? []), p])

  const wanted = projs.filter((p) => {
    if (!needle) return true
    const initiative = p.initiativeId ? (initiativeName.get(p.initiativeId) ?? '') : ''
    return p.name.toLowerCase().includes(needle) || initiative.toLowerCase().includes(needle)
  })

  return Response.json({
    projects: wanted.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      initiative: p.initiativeId ? (initiativeName.get(p.initiativeId) ?? null) : null,
      initiativeId: p.initiativeId,
      devLead: p.devLead,
      programLead: p.programLead,
      workstreams: rows
        .filter((w) => w.projectId === p.id)
        .map((w) => ({
          id: w.id,
          name: w.name,
          details: w.details,
          status: w.status,
          targetLabel: w.targetLabel,
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
