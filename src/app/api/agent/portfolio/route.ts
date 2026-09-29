/**
 * What an agent is allowed to know about the portfolio.
 *
 *   GET /api/agent/portfolio
 *
 * Protected by SYNC_TOKEN, the same as the other machine routes.
 *
 * Deliberately narrow: ids, names, status, the people involved, and the Linear
 * id where there is one. Not assessments, not decisions, not the intake
 * register. An agent needs enough to know what it is looking at and to attach
 * what it read to the right thing; handing it the whole portfolio would make
 * every future prompt-injection in a PR title that much more interesting.
 */
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { objectives, initiatives, people, projects, sourceRecords } from '@/db/schema'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  const [groups, projs, streams, folk, records] = await Promise.all([
    db.select().from(objectives),
    db.select().from(initiatives),
    db.select().from(projects),
    db.select().from(people),
    db.select().from(sourceRecords).where(eq(sourceRecords.system, 'linear')),
  ])

  const nameOf = new Map(folk.map((p) => [p.id, p.name]))
  const externalOf = new Map(records.map((r) => [`${r.entityType}:${r.entityId}`, r.externalId]))

  // All three tiers, each naming its parent. An agent that can see only two of
  // them cannot tell an ungrouped initiative from a grouped one, and "which
  // initiatives belong together" is a question about exactly that gap.
  const entities = [
    ...groups.map((g) => ({
      type: 'objective' as const,
      id: g.id,
      name: g.name,
      externalId: null,
      status: g.status,
      people: [nameOf.get(g.ownerId ?? '')].filter(Boolean) as string[],
      parent: null,
    })),
    ...projs.map((p) => ({
      type: 'initiative' as const,
      id: p.id,
      name: p.name,
      externalId: externalOf.get(`initiative:${p.id}`) ?? null,
      status: p.status,
      people: [nameOf.get(p.ownerId ?? ''), nameOf.get(p.sponsorId ?? '')].filter(Boolean) as string[],
      parent: p.objectiveId,
    })),
    ...streams.map((w) => ({
      type: 'project' as const,
      id: w.id,
      name: w.name,
      externalId: externalOf.get(`project:${w.id}`) ?? null,
      status: w.status,
      people: [nameOf.get(w.leadId ?? '')].filter(Boolean) as string[],
      parent: w.initiativeId,
    })),
  ]

  return Response.json({ entities })
}
