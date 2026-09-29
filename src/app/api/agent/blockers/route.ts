/**
 * Who is holding up what, and who owes an answer.
 *
 *   GET /api/agent/blockers
 *
 * Protected by SYNC_TOKEN.
 *
 * This is the one thing an agent cannot work out by reading tickets: the
 * dependency graph and the decisions register are things people entered here
 * precisely because no tracker held them. Without this endpoint Yaara can only
 * infer blockage from the text of Linear updates, which means she is guessing
 * at exactly the question people most want answered.
 *
 * Read-only, and still deliberately narrow: names, owners, dates, status. The
 * caller is an agent that also reads pull request titles and chat messages, so
 * it gets what the job needs and no more.
 *
 * Unowned items are the point rather than an omission. A blocker with nobody's
 * name on it is the most actionable row in the response, so `owner` is null and
 * `unowned` is true rather than the row being filtered out.
 */
import { inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { decisions, dependencies, initiatives, milestones, people, projects } from '@/db/schema'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Resolved but never blocking; accepted risk is a decision already taken. */
const LIVE_DEPENDENCY_STATUSES = ['open', 'at_risk']
const LIVE_DECISION_STATUSES = ['open', 'watch']

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  const [deps, decisionRows, folk, inits, projs, miles] = await Promise.all([
    db.select().from(dependencies).where(inArray(dependencies.status, LIVE_DEPENDENCY_STATUSES)),
    db.select().from(decisions).where(inArray(decisions.status, LIVE_DECISION_STATUSES)),
    db.select().from(people),
    db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives),
    db.select({ id: projects.id, name: projects.name }).from(projects),
    db.select({ id: milestones.id, name: milestones.name }).from(milestones),
  ])

  const personName = new Map(folk.map((p) => [p.id, p.name]))
  const entityName = new Map<string, string>([
    ...inits.map((i) => [`initiative:${i.id}`, i.name] as const),
    ...projs.map((p) => [`project:${p.id}`, p.name] as const),
    ...miles.map((m) => [`milestone:${m.id}`, m.name] as const),
  ])

  // An "external" dependency has no row to point at, which is why the label
  // exists. Falling back to it rather than to an id keeps the response readable
  // by something that has never seen this database.
  const nameFor = (type: string, id: string, label: string | null) =>
    entityName.get(`${type}:${id}`) ?? label ?? `${type} ${id}`

  const now = Date.now()
  const daysUntil = (d: Date | null) =>
    d ? Math.round((d.getTime() - now) / 86_400_000) : null

  return Response.json({
    dependencies: deps.map((d) => {
      const owner = d.ownerId ? (personName.get(d.ownerId) ?? null) : null
      return {
        id: d.id,
        // "A is blocked by B" reads the way people say it out loud.
        blocked: nameFor(d.fromType, d.fromId, d.fromLabel),
        blockedBy: nameFor(d.toType, d.toId, d.toLabel),
        kind: d.kind,
        status: d.status,
        criticality: d.criticality,
        description: d.description,
        owner,
        unowned: !owner,
        dueDate: d.dueDate?.toISOString() ?? null,
        daysUntilDue: daysUntil(d.dueDate),
        overdue: d.dueDate ? d.dueDate.getTime() < now : false,
      }
    }),

    decisions: decisionRows.map((d) => {
      const owner = d.ownerId ? (personName.get(d.ownerId) ?? null) : (d.ownerText ?? null)
      return {
        id: d.id,
        ref: d.ref,
        title: d.title,
        category: d.category,
        status: d.status,
        contested: d.contested,
        owner,
        unowned: !owner,
        // Free text on purpose in the schema: "Next Leads", "~7/10", "This week".
        dueBy: d.dueBy,
        nextAction: d.nextAction,
        entityType: d.entityType,
        entityId: d.entityId,
        entityName:
          d.entityType && d.entityId ? (entityName.get(`${d.entityType}:${d.entityId}`) ?? null) : null,
      }
    }),
  })
}
