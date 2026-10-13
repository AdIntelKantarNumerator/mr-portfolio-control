/**
 * Session summaries, written by Yaara.
 *
 *   POST /api/agent/series/summaries
 *     { seriesId, meeting, sessionDay, document: { externalId, title, url, revision }, markdown, model }
 *     -> { id, outcome: created | updated | kept-edit }
 *   PATCH /api/agent/series/summaries { id, posted: true }   she posted it to Slack
 *   GET /api/agent/series/summaries?seriesId=…[&id=…]
 *     -> { summary: { id, meeting, sessionDay, markdown, edited } | null, sessions: [{ id, meeting, sessionDay }] }
 *     The latest session's summary (as shown, a person's edit included), for
 *     answering "how is that meeting going" (13 October 2026).
 *
 * Protected by SYNC_TOKEN (or Yaara's own token). A person's edit of a summary
 * is never overwritten: her new text is kept underneath it (lib/series-summaries).
 */
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { meetingSeries, seriesSummaries } from '@/db/schema'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { getSummary, listSummaries, upsertSummary } from '@/lib/series-summaries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const q = new URL(req.url).searchParams
  const seriesId = q.get('seriesId') ?? ''
  if (!seriesId) return Response.json({ error: 'Send ?seriesId=.' }, { status: 400 })
  const [summary, sessions] = await Promise.all([getSummary(seriesId, q.get('id')), listSummaries(seriesId)])
  return Response.json({
    summary: summary && { id: summary.id, meeting: summary.meeting, sessionDay: summary.sessionDay, markdown: summary.markdown, edited: summary.edited },
    sessions: sessions.map((s) => ({ id: s.id, meeting: s.meeting, sessionDay: s.sessionDay })),
  })
}

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const doc = (b?.document ?? {}) as Record<string, unknown>
  const seriesId = String(b?.seriesId ?? '')
  const sessionDay = String(b?.sessionDay ?? '')
  const markdown = String(b?.markdown ?? '').trim()
  const externalId = String(doc.externalId ?? '')
  if (!seriesId || !externalId || !markdown || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDay)) {
    return Response.json({ error: 'Send seriesId, sessionDay (YYYY-MM-DD), document.externalId and markdown.' }, { status: 400 })
  }
  const [series] = await db.select({ id: meetingSeries.id }).from(meetingSeries).where(eq(meetingSeries.id, seriesId)).limit(1)
  if (!series) return Response.json({ error: `No series ${seriesId}.` }, { status: 404 })
  const res = await upsertSummary({
    seriesId,
    meeting: String(b?.meeting ?? ''),
    sessionDay,
    document: { externalId, title: doc.title ? String(doc.title) : null, url: doc.url ? String(doc.url) : null, revision: doc.revision ? String(doc.revision) : null },
    markdown,
    model: b?.model ? String(b.model) : null,
  })
  return Response.json(res)
}

export async function PATCH(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const id = String(b?.id ?? '')
  if (!id || b?.posted !== true) return Response.json({ error: 'Send { id, posted: true }.' }, { status: 400 })
  const done = await db.update(seriesSummaries).set({ postedAt: new Date() }).where(eq(seriesSummaries.id, id)).returning({ id: seriesSummaries.id })
  return Response.json({ ok: done.length > 0 })
}
