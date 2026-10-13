/**
 * GET /series/<id>/export?s=<summaryId>
 *
 * The session's summary and the next session's agenda as a Word document
 * (lib/series-export.ts). The latest session when s is absent. Behind the
 * sign-in like every page: the link Yaara shares in Slack opens for anyone
 * with a company account and nobody else.
 *
 * Reads only. A missing agenda is said so in the document rather than
 * written here: a download should not wait a minute on a model.
 */
import { getSummary } from '@/lib/series-summaries'
import { savedAgenda } from '@/lib/series-agenda'
import { seriesView } from '@/lib/series-data'
import { buildSeriesDocx, exportFilename } from '@/lib/series-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The address people use, not the container's own: App Service forwards the host. */
function origin(req: Request): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '')
  return host ? `${proto}://${host}` : new URL(req.url).origin
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const s = new URL(req.url).searchParams.get('s')
  const view = await seriesView(id)
  if (!view) return new Response('No such series.', { status: 404 })
  const [summary, agenda] = await Promise.all([getSummary(id, s), savedAgenda(id).catch(() => null)])
  const bytes = await buildSeriesDocx({
    seriesName: view.name,
    goals: view.goals ?? null,
    summary: summary && { meeting: summary.meeting, sessionDay: summary.sessionDay, markdown: summary.markdown, edited: summary.edited },
    agenda: agenda && { forDay: agenda.forDay, agenda: agenda.agenda, current: agenda.current, generatedAt: agenda.generatedAt },
    pageUrl: `${origin(req)}/series/${encodeURIComponent(id)}`,
  })
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': `attachment; filename="${exportFilename(view.name, summary?.sessionDay ?? null)}"`,
      'cache-control': 'no-store',
    },
  })
}
