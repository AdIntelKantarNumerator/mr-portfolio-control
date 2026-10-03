/**
 * "Reassess now" requests from the home page, collected by Yaara.
 *
 *   GET  /api/agent/reassess?wait=25   → { request: { id, entityType, entityId, requestedBy } | null }
 *   POST /api/agent/reassess           { id, note }  she published (note: anything worth telling the person)
 *                                      { id, error } she could not
 *
 * Protected by SYNC_TOKEN. She collects, as she does chat questions, because
 * nothing can call her. See src/lib/reassess-rules.ts.
 */
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { claimNextReassessment, finishReassessment } from '@/lib/reassess-queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const wait = Math.max(0, Math.min(25, Number(new URL(req.url).searchParams.get('wait') ?? 0) || 0))
  const request = await claimNextReassessment(wait * 1000, req.signal)
  return Response.json({ request })
}

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'The body is not JSON.' }, { status: 400 })
  }
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return Response.json({ error: 'id is required.' }, { status: 400 })

  if (typeof body.error === 'string') {
    return Response.json({ ok: true, live: await finishReassessment(id, { error: body.error }) })
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null
  return Response.json({ ok: true, live: await finishReassessment(id, { note }) })
}
