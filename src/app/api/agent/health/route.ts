/**
 * Restate an agent's current health call in its own words, keeping what it
 * cites (Scott, 23 October 2026).
 *
 *   POST /api/agent/health  { entityType, entityId, rag, confidence, rationale, agent? }
 *
 * Protected by SYNC_TOKEN (or Yaara's own token).
 *
 * WHY
 *
 * On 22 October the assessment rules changed: an open milestone past its date
 * is not a miss, and "no evidence of progress" or "unconfirmed" is not a
 * problem. A health call is only rewritten when the work is assessed again,
 * and work with no new evidence is not - so 61 cards went on showing calls
 * like "unknown: No evidence of activity" and "red: the Discovery milestone
 * remains overdue", made under the old rules. This replaces such a call with
 * one restated under the new ones.
 *
 * It is a restatement, not a new assessment: it needs a current call by the
 * same agent to replace, and the new one cites what that one cited. An
 * "unknown" may cite nothing, and most of the old ones did; restated as
 * something else it cites what the latest assessment's bullets cite, so the
 * citation bar is the same as for a new call.
 */
import { readTier, vocabularyOf } from '@/lib/tier-aliases'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { agentObservations, assessments } from '@/db/schema'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RAGS = new Set(['green', 'amber', 'red', 'unknown'])
const CONFIDENCES = new Set(['low', 'medium', 'high'])
const ENTITY_TYPES = new Set(['objective', 'initiative', 'project'])

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const read = readTier(body.entityType == null ? null : String(body.entityType), vocabularyOf(req.headers))
  const entityType = read.tier ?? ''
  const entityId = String(body.entityId ?? '')
  const rag = String(body.rag ?? '')
  const confidence = CONFIDENCES.has(String(body.confidence)) ? String(body.confidence) : 'low'
  const rationale = String(body.rationale ?? '').trim()
  const agent = String(body.agent ?? 'yaara').slice(0, 64)
  if (!ENTITY_TYPES.has(entityType) || !entityId) {
    return Response.json({ error: read.problem ?? 'entityType must be "objective", "initiative" or "project", and entityId is required.' }, { status: 400 })
  }
  if (!RAGS.has(rag) || !rationale) return Response.json({ error: 'Send rag (green | amber | red | unknown) and a rationale.' }, { status: 400 })

  const where = and(eq(assessments.entityType, entityType), eq(assessments.entityId, entityId), eq(assessments.authoredBy, agent), eq(assessments.current, true))
  const [was] = await db.select().from(assessments).where(where).limit(1)
  if (!was) return Response.json({ error: `No current ${agent} health call on that ${entityType} to restate.` }, { status: 404 })
  let evidence = was.evidence?.trim() || ''
  if (!evidence && rag !== 'unknown') {
    const [latest] = await db
      .select({ items: agentObservations.items })
      .from(agentObservations)
      .where(and(eq(agentObservations.entityType, entityType), eq(agentObservations.entityId, entityId), eq(agentObservations.agent, agent)))
      .orderBy(desc(agentObservations.generatedAt))
      .limit(1)
    let cited: string[] = []
    try {
      cited = (JSON.parse(latest?.items ?? '[]') as Array<{ citations?: unknown }>).flatMap((b) => (Array.isArray(b.citations) ? b.citations.map(String) : []))
    } catch {}
    evidence = [...new Set(cited)].slice(0, 6).join(', ')
    if (!evidence) return Response.json({ error: 'Nothing to cite: neither the call being replaced nor the latest assessment cites any evidence, so only "unknown" can replace it.' }, { status: 400 })
  }

  await db.update(assessments).set({ current: false }).where(where)
  await db.insert(assessments).values({
    entityType,
    entityId,
    rag,
    confidence,
    rationale: rationale.slice(0, 2000),
    evidence,
    asOf: new Date(),
    authoredBy: agent,
    reviewedBy: null,
    reviewedAt: null,
    current: true,
  })
  return Response.json({ restated: true, was: { rag: was.rag, rationale: was.rationale } })
}
