/**
 * "What would this change affect?", asked of the Workflow Assessment map.
 *
 *   POST /api/agent/assess   { question, askedBy? }
 *
 * Protected by SYNC_TOKEN. The same assessment the /workflow chat runs, on
 * the map as it is now, so a question put to Yaara gets the answer the screen
 * would give rather than her own reading of the map. The answer is kept with
 * the others on /workflow, marked as asked through her, so the person can
 * open it and see it lit on the map.
 */
import { db } from '@/db/client'
import { workflowAssessments } from '@/db/schema'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { runAssessment } from '@/lib/assessment-run'
import { readAssessmentInputs } from '@/lib/workflow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const body = (await req.json().catch(() => ({}))) as { question?: unknown; askedBy?: unknown }
  const question = String(body.question ?? '').trim()
  if (question.length < 8) return Response.json({ error: 'Describe the change in a few words.' }, { status: 400 })
  if (question.length > 1500) return Response.json({ error: 'Keep the question under 1,500 characters.' }, { status: 400 })

  const { components, links, groups } = await readAssessmentInputs()
  if (!components.length) return Response.json({ error: 'The map is empty, so there is nothing to assess against yet.' }, { status: 409 })

  const result = await runAssessment(question, components, links, groups)
  const askedBy = typeof body.askedBy === 'string' && body.askedBy.trim() ? `${body.askedBy.trim()} (through Yaara)` : 'Yaara'
  await db.insert(workflowAssessments).values({
    question,
    askedBy,
    method: result.method,
    model: result.model,
    answer: JSON.stringify(result.answer),
    relied: JSON.stringify(result.relied),
  })

  const a = result.answer
  const names = (items: Array<{ name: string; why: string }>) => items.map((i) => ({ name: i.name, why: i.why }))
  return Response.json({
    method: result.method,
    model: result.model,
    summary: a.summary,
    changesDirectly: names(a.direct),
    likelyAffected: names(a.likely),
    possiblyAffected: names(a.possible),
    reachedButUnaffected: a.unaffected.map((u) => u.name),
    nothingMatched: a.none,
    suggestedComponent: a.suggestion,
    notes: a.notes,
    seeIt: '/workflow',
  })
}
