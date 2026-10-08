/**
 * One meeting series: what its last session produced, and what has happened
 * since to everything that came before it, with the thing to check next time.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Kicker } from '@/components/ui'
import { knownMeetings, seriesView, type SeriesRow } from '@/lib/series-data'
import { shortDay, type Bucket } from '@/lib/series'
import { SeriesTools } from './tools'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const view = await seriesView(id)
  return { title: view?.name ?? 'Meeting series' }
}

const KIND = { blocker: 'Blocker', decision: 'Decision', action: 'Action' } as const

const SECTIONS: Array<{ key: Bucket; title: (last: string) => string; tone: string }> = [
  { key: 'new', title: (last) => `From the last session · ${last}`, tone: 'var(--c1)' },
  { key: 'changed', title: () => 'Changed since', tone: 'var(--warn)' },
  { key: 'quiet', title: () => 'Not discussed since', tone: 'var(--crit)' },
  { key: 'resolved', title: () => 'Resolved since', tone: 'var(--good)' },
]

export default async function SeriesDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [view, known] = await Promise.all([seriesView(id), knownMeetings()])
  if (!view) notFound()

  const last = shortDay(view.lastSession)
  const next = view.nextSession ? shortDay(view.nextSession) : null
  const unowned = Object.values(view.sections)
    .flat()
    .filter((r) => r.check === 'Needs an owner').length

  const stats: Array<{ n: number; label: string; tone: string }> = [
    { n: view.sections.new.length, label: 'New last session', tone: 'var(--c1)' },
    { n: view.sections.changed.length, label: 'Changed', tone: 'var(--warn)' },
    { n: view.sections.quiet.length, label: 'Not discussed', tone: 'var(--crit)' },
    { n: view.sections.resolved.length, label: 'Resolved', tone: 'var(--good)' },
    { n: unowned, label: 'Need an owner', tone: 'var(--muted)' },
  ]

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>
            <Link href="/series">Meeting series</Link>
          </Kicker>
          <h1>{view.name}</h1>
          <div className="ser-when">
            <span>Last {last}</span>
            {next ? <b>Next {next}</b> : <span className="status quiet">Closed</span>}
          </div>
        </div>
        <SeriesTools series={{ id: view.id, name: view.name, meetings: view.meetings, status: view.status }} known={known} />
      </div>

      <div className="ser-mtg-chips">
        {view.meetings.map((m) => (
          <span key={m} className="chip tone-slate">
            {m}
          </span>
        ))}
      </div>

      <div className="ser-stats">
        {stats.map((s) => (
          <div key={s.label} className="ser-stat" style={{ borderTopColor: s.tone }}>
            <b style={{ color: s.tone }}>{s.n}</b>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {SECTIONS.map((sec) => {
        const rows = view.sections[sec.key]
        if (!rows.length) return null
        return (
          <section key={sec.key} className="tile ser-sec" style={{ borderLeftColor: sec.tone }}>
            <div className="tile-head">
              <h2>{sec.title(last)}</h2>
              <span className="ser-n">{rows.length}</span>
            </div>
            <Rows rows={rows} bucket={sec.key} next={next} />
          </section>
        )
      })}

      {Object.values(view.sections).every((r) => r.length === 0) ? (
        <div className="blank">
          <h2>Nothing on record from these meetings yet</h2>
        </div>
      ) : null}
    </div>
  )
}

function Rows({ rows, bucket, next }: { rows: SeriesRow[]; bucket: Bucket; next: string | null }) {
  const showChange = bucket === 'changed' || bucket === 'resolved'
  const showCheck = bucket !== 'resolved'
  return (
    <div className="ser-table">
      <table className="dtable">
        <thead>
          <tr>
            <th>Item</th>
            <th className="ser-owner">Owner</th>
            {showChange ? <th>{bucket === 'resolved' ? 'How' : 'What changed'}</th> : null}
            {showCheck ? <th className="ser-checkh">Next check{next ? ` · ${next}` : ''}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ref}>
              <td>
                <Link href={r.href} className="ser-item">
                  <span className={`ser-kind ser-${r.kind}`}>{KIND[r.kind]}</span>
                  <span className="ser-ref">{r.ref}</span>
                  <span className="ser-title">{r.title}</span>
                </Link>
              </td>
              <td className="ser-owner">{r.owner ?? '—'}</td>
              {showChange ? (
                <td>
                  {r.change ?? '—'}
                  {r.where ? (
                    <div className="ser-where">
                      {r.whereUrl ? (
                        <a href={r.whereUrl} target="_blank" rel="noreferrer">
                          {r.where}
                        </a>
                      ) : (
                        r.where
                      )}
                    </div>
                  ) : null}
                </td>
              ) : null}
              {showCheck ? (
                <td className={`ser-check${r.check === 'Needs an owner' || r.check?.startsWith('Overdue') ? ' ser-alert' : ''}`}>{r.check ?? '—'}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
