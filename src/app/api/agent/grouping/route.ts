/**
 * Grouping proposals.
 *
 *   GET  /api/agent/grouping            what is already proposed or decided
 *   POST /api/agent/grouping            propose a grouping
 *
 * Protected by SYNC_TOKEN.
 *
 * SHE PROPOSES; A PERSON DECIDES
 *
 * Every other agent write in this app records something that happened. This
 * one records an opinion about how the portfolio should be arranged, which is
 * somebody's job and not hers. So there is no path from here to an initiative
 * actually moving: accepting a suggestion is a click on the objectives page,
 * made by a named person, and that is what creates the objective.
 *
 * WHAT IT REFUSES
 *
 * A grouping of fewer than two initiatives (that is not a grouping), one naming a
 * initiative that does not exist, one that repeats a pending suggestion, and one
 * that repeats a grouping a person already dismissed — being told no once is
 * enough, and re-proposing it every night is how an agent teaches people to
 * ignore it.
 */
import { desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { groupingSuggestions, objectives, initiatives } from '@/db/schema'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { closest, exact } from '@/lib/match-name'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface IncomingGroup {
  name?: string
  rationale?: string
  initiativeIds?: string[]
  initiativeNames?: string[]
  evidence?: Array<{ source: string; title: string; url?: string | null }>
}

interface Incoming {
  agent?: string
  model?: string
  groups?: IncomingGroup[]
}

/** Order-independent, so {A,B} and {B,A} are the same proposal. */
function key(ids: string[]): string {
  return [...new Set(ids)].sort().join(',')
}

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  const [rows, projs, groups] = await Promise.all([
    db.select().from(groupingSuggestions).orderBy(desc(groupingSuggestions.createdAt)),
    db.select({ id: initiatives.id, name: initiatives.name, objectiveId: initiatives.objectiveId }).from(initiatives),
    db.select({ id: objectives.id, name: objectives.name }).from(objectives),
  ])

  const nameOf = new Map(projs.map((p) => [p.id, p.name]))
  const initName = new Map(groups.map((g) => [g.id, g.name]))

  return Response.json({
    suggestions: rows.map((r) => ({
      id: r.id,
      name: r.name,
      rationale: r.rationale,
      status: r.status,
      decidedBy: r.decidedBy,
      becameObjective: r.objectiveId ? (initName.get(r.objectiveId) ?? null) : null,
      initiatives: r.initiativeIds
        .split(',')
        .filter(Boolean)
        .map((id) => ({ id, name: nameOf.get(id) ?? null })),
    })),
    // So she can see what is still loose without a second call.
    ungrouped: projs.filter((p) => !p.objectiveId).map((p) => ({ id: p.id, name: p.name })),
  })
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
  const model = body.model ? String(body.model).slice(0, 120) : null
  const incoming = Array.isArray(body.groups) ? body.groups : []
  if (incoming.length === 0) return Response.json({ proposed: [], dropped: [] })

  const [projs, existing] = await Promise.all([
    db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives),
    db.select().from(groupingSuggestions),
  ])

  const realIds = new Set(projs.map((p) => p.id))
  // Pending and dismissed both block a repeat. Accepted does not: the same
  // initiatives can legitimately be regrouped later, after somebody split them up.
  const blocked = new Map(
    existing
      .filter((e) => e.status === 'pending' || e.status === 'dismissed')
      .map((e) => [key(e.initiativeIds.split(',').filter(Boolean)), e.status]),
  )

  const proposed: string[] = []
  const dropped: string[] = []

  for (const g of incoming) {
    const name = String(g.name ?? '').trim()
    if (name.length < 3) {
      dropped.push('a grouping with no usable name')
      continue
    }

    const ids: string[] = []
    for (const id of g.initiativeIds ?? []) if (realIds.has(String(id))) ids.push(String(id))
    for (const asked of g.initiativeNames ?? []) {
      const found = exact(String(asked), projs)
      if (found) {
        if (!ids.includes(found.id)) ids.push(found.id)
      } else {
        const near = closest(String(asked), projs)
        dropped.push(
          near.length
            ? `"${name}" — no initiative called "${asked}"; did you mean ${near.map((n) => n.name).join(', or ')}?`
            : `"${name}" — no initiative called "${asked}"`,
        )
      }
    }

    if (ids.length < 2) {
      dropped.push(`"${name}" — a grouping needs at least two real initiatives; got ${ids.length}`)
      continue
    }

    const already = blocked.get(key(ids))
    if (already) {
      dropped.push(
        already === 'dismissed'
          ? `"${name}" — this exact grouping was dismissed already; it is not offered again`
          : `"${name}" — this exact grouping is already waiting for a decision`,
      )
      continue
    }

    const [row] = await db
      .insert(groupingSuggestions)
      .values({
        name: name.slice(0, 200),
        rationale: g.rationale ? String(g.rationale).slice(0, 1000) : null,
        initiativeIds: ids.join(','),
        agent,
        model,
        evidence: g.evidence ? JSON.stringify(g.evidence).slice(0, 4000) : null,
        status: 'pending',
      })
      .returning({ id: groupingSuggestions.id })

    blocked.set(key(ids), 'pending')
    proposed.push(row.id)
  }

  return Response.json({ proposed, dropped })
}

/**
 * Withdraw a proposal she no longer stands behind.
 *
 * Only her own pending ones, and only to `withdrawn`. An agent deleting a
 * suggestion a person already decided on would erase the record of the
 * decision, which is the only reason the row outlives the proposal.
 */
export async function DELETE(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  const id = new URL(req.url).searchParams.get('id') ?? ''
  const [row] = await db.select().from(groupingSuggestions).where(eq(groupingSuggestions.id, id)).limit(1)
  if (!row) return Response.json({ error: `No suggestion ${id}.` }, { status: 404 })
  if (row.status !== 'pending') {
    return Response.json({ error: `That suggestion was already ${row.status} by a person.` }, { status: 409 })
  }

  await db
    .update(groupingSuggestions)
    .set({ status: 'withdrawn', decidedAt: new Date() })
    .where(eq(groupingSuggestions.id, id))

  return Response.json({ withdrawn: id })
}
