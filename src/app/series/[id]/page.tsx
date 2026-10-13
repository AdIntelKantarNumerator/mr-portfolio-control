/**
 * One meeting series, summary first (12 October 2026).
 *
 * The page opens on the most recent session's summary, as written by Yaara
 * from its notes; earlier sessions are one click back. "Proposed agenda" sets
 * out what the next session should spend its time on. The items themselves
 * are folded into a strip of counts and open only when asked, grouped by
 * topic, with the buttons to close what is finished.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Kicker } from '@/components/ui'
import { seriesName, seriesView } from '@/lib/series-data'
import { getSummary, listSummaries } from '@/lib/series-summaries'
import { linkRefs, shortDay } from '@/lib/series'
import { SeriesTools } from './tools'
import { SessionView } from './session'
import { SeriesDetail } from './detail'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: (await seriesName(id)) ?? 'Meeting series' }
}

export default async function SeriesDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ s?: string }>
}) {
  const { id } = await params
  const { s } = await searchParams
  const [view, sessions, summary] = await Promise.all([seriesView(id), listSummaries(id), getSummary(id, s)])
  if (!view) notFound()

  const next = view.nextSession ? shortDay(view.nextSession) : null
  const hrefs = new Map(Object.entries(view.refHrefs))
  const rows = Object.entries(view.sections).flatMap(([bucket, list]) => list.map((r) => ({ ...r, bucket })))

  return (
    <div className="stack">
      <div className="titlerow ser-head">
        <div>
          <Kicker>
            <Link href="/series">Meeting series</Link>
          </Kicker>
          <h1>{view.name}</h1>
          <div className="ser-when">
            {view.lastSession ? <span>Last {shortDay(view.lastSession)}</span> : null}
            {next ? <b>Next {next}</b> : view.status !== 'open' ? <span className="status quiet">Closed</span> : null}
          </div>
        </div>
        <SeriesTools
          series={{ id: view.id, name: view.name, meetings: view.meetings, status: view.status, goals: view.goals ?? '' }}
          next={next}
        />
      </div>

      {view.goals ? <p className="ser-goals">{view.goals}</p> : null}

      <SessionView
        seriesId={view.id}
        sessions={sessions.map((x) => ({ id: x.id, label: `${shortDay(x.sessionDay)} · ${x.meeting}` }))}
        summary={
          summary && {
            id: summary.id,
            label: `${shortDay(summary.sessionDay)} · ${summary.meeting}`,
            markdown: linkRefs(summary.markdown, hrefs),
            raw: summary.markdown,
            edited: summary.edited,
            editedBy: summary.editedBy,
            notesChanged: Boolean(summary.notesChangedAt),
            documentUrl: summary.documentUrl,
          }
        }
      />

      <SeriesDetail seriesId={view.id} seriesName={view.name} rows={rows} />
    </div>
  )
}
