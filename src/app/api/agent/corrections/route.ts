/**
 * Corrections waiting to become routing rules.
 *
 *   GET  /api/agent/corrections     what nobody has turned into a rule yet
 *   POST /api/agent/corrections     mark them done, with the rule each became
 *
 * Protected by SYNC_TOKEN.
 *
 * WHY YAARA PULLS RATHER THAN THE APP PUSHING
 *
 * The app has no idea whether she is running. A push would have to be retried,
 * queued, and given somewhere to fail to — which is a small outbox, built to
 * deliver a handful of rows a week. Pulling costs one request per pass and
 * cannot lose a correction: a row stays pending until she says she has acted
 * on it, so a pass that dies half way through re-reads it next time.
 *
 * WHY THE ROW IS KEPT AFTERWARDS
 *
 * `consumed_at` rather than a delete. Months later the question is "why does
 * she think that channel is GPC", and the answer is this row: who said so,
 * when, about which update, and in what words. A rule with no provenance is
 * one nobody dares remove.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { routingCorrections } from '@/db/schema'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  const rows = await db
    .select()
    .from(routingCorrections)
    .where(isNull(routingCorrections.consumedAt))
    .orderBy(asc(routingCorrections.createdAt))
    .limit(200)

  return Response.json({
    corrections: rows.map((r) => ({
      id: r.id,
      wrong: { entityType: r.wrongEntityType, entityId: r.wrongEntityId },
      // Null together means the evidence belongs to nothing — an exclusion,
      // which is a real answer and not a missing one.
      right: r.rightEntityId ? { entityType: r.rightEntityType, entityId: r.rightEntityId } : null,
      source: r.source,
      location: r.location,
      author: r.author,
      evidenceId: r.evidenceId,
      evidenceTitle: r.evidenceTitle,
      note: r.note,
      createdBy: r.createdBy,
      createdAt: r.createdAt?.toISOString() ?? null,
    })),
  })
}

interface Done {
  id?: string
  ruleId?: string
}

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  let body: { done?: Done[] }
  try {
    body = (await req.json()) as { done?: Done[] }
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const done = (body.done ?? []).filter((d) => typeof d.id === 'string' && d.id)
  if (done.length === 0) return Response.json({ marked: 0 })

  const ids = done.map((d) => d.id as string)
  const known = await db
    .select({ id: routingCorrections.id })
    .from(routingCorrections)
    .where(and(inArray(routingCorrections.id, ids), isNull(routingCorrections.consumedAt)))
  const live = new Set(known.map((r) => r.id))

  const now = new Date()
  let marked = 0
  // One statement each rather than one for the batch, because each carries its
  // own rule id: what makes the rule explainable later is knowing which
  // correction produced it, and a bulk update would have to throw that away.
  for (const d of done) {
    if (!live.has(d.id as string)) continue
    await db
      .update(routingCorrections)
      .set({ consumedAt: now, ruleId: typeof d.ruleId === 'string' ? d.ruleId : null })
      .where(eq(routingCorrections.id, d.id as string))
    marked++
  }

  return Response.json({ marked, ignored: done.length - marked })
}
