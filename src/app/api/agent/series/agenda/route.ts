/**
 * The proposed agenda for a series' next session, for Yaara to post.
 *
 *   POST /api/agent/series/agenda { seriesId }         the current agenda, written now if missing or out of date
 *   PATCH /api/agent/series/agenda { seriesId, forDay, posted: true }
 *   GET /api/agent/series/agenda?seriesId=…   the saved agenda or null, never written here
 *     (13 October 2026: for a chat answer, which should not wait on a model)
 *
 * Protected by SYNC_TOKEN (or Yaara's own token). Writing one calls the
 * advanced model and can take a minute.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { seriesAgendas } from '@/db/schema'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { generateAgenda, savedAgenda } from '@/lib/series-agenda'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 240

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const seriesId = new URL(req.url).searchParams.get('seriesId') ?? ''
  if (!seriesId) return Response.json({ error: 'Send ?seriesId=.' }, { status: 400 })
  return Response.json({ saved: await savedAgenda(seriesId) })
}

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const seriesId = String(b?.seriesId ?? '')
  if (!seriesId) return Response.json({ error: 'Send { seriesId }.' }, { status: 400 })
  try {
    const saved = await savedAgenda(seriesId)
    if (saved?.current) return Response.json(saved)
    return Response.json(await generateAgenda(seriesId, 'Yaara'))
  } catch (err) {
    return Response.json({ error: (err as Error).message.slice(0, 300) }, { status: 502 })
  }
}

export async function PATCH(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const seriesId = String(b?.seriesId ?? '')
  const forDay = String(b?.forDay ?? '')
  if (!seriesId || !forDay || b?.posted !== true) return Response.json({ error: 'Send { seriesId, forDay, posted: true }.' }, { status: 400 })
  const done = await db
    .update(seriesAgendas)
    .set({ postedAt: new Date() })
    .where(and(eq(seriesAgendas.seriesId, seriesId), eq(seriesAgendas.forDay, forDay)))
    .returning({ id: seriesAgendas.id })
  return Response.json({ ok: done.length > 0 })
}
