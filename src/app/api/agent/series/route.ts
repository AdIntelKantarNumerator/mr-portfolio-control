/**
 * The meeting series, for Yaara.
 *
 *   GET /api/agent/series
 *     -> { series: [{ id, name, meetings, goals, slackChannel, status, lastSession, nextSession }],
 *          summarised: [{ seriesId, externalId, revision }],
 *          agendas: [{ seriesId, forDay, postedAt }] }
 *
 * Protected by SYNC_TOKEN (or Yaara's own token). She uses it to tell which of
 * the documents she reads are sessions of a series, and which of those already
 * have a summary at their current revision (12 October 2026), and whether the
 * agenda for a series' next session has been posted, so the evening check is
 * a read rather than a model call.
 */
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { listSeries } from '@/lib/series-data'
import { db } from '@/db/client'
import { seriesAgendas } from '@/db/schema'
import { summarisedDocuments } from '@/lib/series-summaries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const [series, summarised, agendas] = await Promise.all([
    listSeries(),
    summarisedDocuments(),
    db.select({ seriesId: seriesAgendas.seriesId, forDay: seriesAgendas.forDay, postedAt: seriesAgendas.postedAt }).from(seriesAgendas),
  ])
  return Response.json({ series, summarised, agendas })
}
