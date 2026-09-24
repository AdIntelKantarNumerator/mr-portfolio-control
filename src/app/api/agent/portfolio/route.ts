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
import { initiatives, people, projects, sourceRecords } from '@/db/schema'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  const [inits, projs, folk, records] = await Promise.all([
    db.select().from(initiatives),
    db.select().from(projects),
    db.select().from(people),
    db.select().from(sourceRecords).where(eq(sourceRecords.system, 'linear')),
  ])

  const nameOf = new Map(folk.map((p) => [p.id, p.name]))
  const externalOf = new Map(records.map((r) => [`${r.entityType}:${r.entityId}`, r.externalId]))

  const entities = [
    ...inits.map((i) => ({
      type: 'initiative' as const,
      id: i.id,
      name: i.name,
      externalId: externalOf.get(`initiative:${i.id}`) ?? null,
      status: i.status,
      people: [nameOf.get(i.ownerId ?? ''), nameOf.get(i.sponsorId ?? '')].filter(Boolean) as string[],
      parent: null,
    })),
    ...projs.map((p) => ({
      type: 'project' as const,
      id: p.id,
      name: p.name,
      externalId: externalOf.get(`project:${p.id}`) ?? null,
      status: p.status,
      people: [nameOf.get(p.leadId ?? '')].filter(Boolean) as string[],
      parent: p.initiativeId,
    })),
  ]

  return Response.json({ entities })
}
