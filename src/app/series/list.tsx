'use client'

/** Every series, searchable by name, with closed ones hidden until asked for. */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { SeriesSummary } from '@/lib/series-data'
import { shortDay } from '@/lib/series'
import { setSeriesClosed } from './actions'
import { SeriesEditor, type KnownMeeting } from './editor'

export function SeriesList({ rows, known }: { rows: SeriesSummary[]; known: KnownMeeting[] }) {
  const router = useRouter()
  const [find, setFind] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const q = find.trim().toLowerCase()
  const shown = rows.filter(
    (r) => (showClosed || r.status === 'open') && (!q || r.name.toLowerCase().includes(q) || r.meetings.some((m) => m.toLowerCase().includes(q))),
  )
  const closed = rows.filter((r) => r.status !== 'open').length

  async function toggle(r: SeriesSummary) {
    setBusy(r.id)
    await setSeriesClosed({ id: r.id, closed: r.status === 'open' }).catch(() => null)
    setBusy(null)
    router.refresh()
  }

  return (
    <>
      <div className="filters">
        <label className="fpill">
          <span>
            <span className="lab">Find</span>
            <input className="ffind" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Series or meeting" aria-label="Find a series" />
          </span>
        </label>
        {closed ? (
          <label className={`fpill${showClosed ? ' active' : ''}`}>
            <span>
              <span className="lab">Showing</span>
              <select className="fsel" value={showClosed ? 'all' : 'open'} onChange={(e) => setShowClosed(e.target.value === 'all')} aria-label="Which series to show">
                <option value="open">Open</option>
                <option value="all">Closed too ({closed})</option>
              </select>
            </span>
          </label>
        ) : null}
        <button type="button" className="btn btn-primary ser-new" onClick={() => setAdding(true)}>
          New series
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="blank">
          <h2>{q ? 'Nothing matches' : 'No series yet'}</h2>
        </div>
      ) : (
        <div className="ilist">
          {shown.map((r) => (
            <div key={r.id} className={`irow ser-row${r.status === 'open' ? '' : ' ser-closed'}`}>
              <div className="ser-open" title="Open items">
                <b>{r.open}</b>
                <span>open</span>
              </div>
              <div className="ir-body">
                <div className="ir-top">
                  <Link href={`/series/${r.id}`} className="ir-name ser-name">
                    {r.name}
                  </Link>
                  {r.status === 'open' ? null : <span className="status quiet">Closed</span>}
                  <button type="button" className="linkish ser-close" onClick={() => toggle(r)} disabled={busy === r.id}>
                    {busy === r.id ? '…' : r.status === 'open' ? 'Close' : 'Reopen'}
                  </button>
                </div>
                <div className="ir-facts">
                  <span>
                    <i>Last</i> {shortDay(r.lastSession)}
                  </span>
                  {r.nextSession ? (
                    <span className="ser-next">
                      <i>Next</i> {shortDay(r.nextSession)}
                    </span>
                  ) : null}
                  <span className="ser-mtgs">{r.meetings.join(' · ')}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? <SeriesEditor known={known} onClose={() => setAdding(false)} /> : null}
    </>
  )
}
