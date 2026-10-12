'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/items/parts'
import type { Agenda } from '@/lib/series-agenda-core'
import { loadAgenda, setSeriesClosed, writeAgenda, type AgendaResult } from '../actions'
import { SeriesEditor } from '../editor'

interface Series {
  id: string
  name: string
  meetings: string[]
  status: string
  goals: string
  slackChannel: string
}

export function SeriesTools({ series, next }: { series: Series; next: string | null }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [agenda, setAgenda] = useState(false)
  const [busy, setBusy] = useState(false)
  const open = series.status === 'open'

  async function toggle() {
    setBusy(true)
    await setSeriesClosed({ id: series.id, closed: open }).catch(() => null)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="ser-tools">
      {open ? (
        <button type="button" className="btn btn-primary" onClick={() => setAgenda(true)}>
          Proposed agenda
        </button>
      ) : null}
      <button type="button" className="btn" onClick={() => setEditing(true)}>
        Edit
      </button>
      <button type="button" className="btn" onClick={toggle} disabled={busy}>
        {busy ? '…' : open ? 'Close' : 'Reopen'}
      </button>
      {editing ? <SeriesEditor series={series} onClose={() => setEditing(false)} /> : null}
      {agenda ? <AgendaPanel seriesId={series.id} next={next} onClose={() => setAgenda(false)} /> : null}
    </div>
  )
}

type Saved = NonNullable<AgendaResult['saved']>

function AgendaPanel({ seriesId, next, onClose }: { seriesId: string; next: string | null; onClose: () => void }) {
  const [saved, setSaved] = useState<Saved | null | undefined>(undefined)
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    loadAgenda(seriesId)
      .then((r) => live && (r.error ? setError(r.error) : setSaved(r.saved ?? null)))
      .catch(() => live && setError('Could not load the agenda.'))
    return () => {
      live = false
    }
  }, [seriesId])

  async function write() {
    setWriting(true)
    setError(null)
    const r = await writeAgenda(seriesId).catch(() => ({ error: 'The agenda could not be written. Try again.' }) as AgendaResult)
    setWriting(false)
    if (r.error) setError(r.error)
    else setSaved(r.saved ?? null)
  }

  async function copy(a: Agenda) {
    try {
      await navigator.clipboard.writeText(agendaText(a, next))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copying was blocked; select the text instead.')
    }
  }

  return (
    <Modal title={`Proposed agenda${next ? ` · ${next}` : ''}`} onClose={onClose}>
      <div className="ag">
        {saved === undefined && !error ? <p className="ag-wait">Loading…</p> : null}
        {writing ? <p className="ag-wait">Writing the agenda from the last sessions and the open items. This takes up to a minute.</p> : null}
        {error ? (
          <p className="mr-said mr-bad" role="alert">
            {error}
          </p>
        ) : null}
        {!writing && saved === null ? (
          <button type="button" className="btn btn-primary" onClick={write}>
            Write the agenda
          </button>
        ) : null}
        {!writing && saved ? (
          <>
            <div className="ag-bar">
              <span className={saved.current ? 'ag-fresh' : 'ag-stale'}>{saved.current ? 'Up to date' : 'Things have changed since this was written'}</span>
              <button type="button" className="linkish" onClick={write}>
                {saved.current ? 'Rewrite' : 'Update'}
              </button>
              <button type="button" className="linkish" onClick={() => copy(saved.agenda)}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <AgendaBody agenda={saved.agenda} />
          </>
        ) : null}
      </div>
    </Modal>
  )
}

function Refs({ refs }: { refs: string[] }) {
  if (!refs.length) return null
  return (
    <span className="ag-refs">
      {refs.map((r) => (
        <Link key={r} href={`/${r.startsWith('A') ? 'actions' : r.startsWith('D') ? 'decisions' : 'blockers'}?focus=${r}`}>
          {r}
        </Link>
      ))}
    </span>
  )
}

function AgendaBody({ agenda }: { agenda: Agenda }) {
  return (
    <>
      {agenda.goalCheck ? <p className="ag-goal">{agenda.goalCheck}</p> : null}
      {agenda.decideFirst.length ? (
        <section>
          <h3 className="ag-h ag-decide">Decide first</h3>
          <ol className="ag-list">
            {agenda.decideFirst.map((d, i) => (
              <li key={i}>
                <b>{d.title}</b> <Refs refs={d.refs} />
                {d.why ? <div className="ag-why">{d.why}</div> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {agenda.topics.length ? (
        <section>
          <h3 className="ag-h">Topics</h3>
          <ol className="ag-list">
            {agenda.topics.map((t, i) => (
              <li key={i}>
                <b>{t.title}</b>
                {t.minutes ? <span className="ag-min">{t.minutes} min</span> : null} <Refs refs={t.refs} />
                {t.why ? <div className="ag-why">{t.why}</div> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {agenda.flags.length ? (
        <section>
          <h3 className="ag-h ag-flag">Flags</h3>
          <ul className="ag-list">
            {agenda.flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

/** Plain text for pasting into a meeting invite or a chat. */
function agendaText(a: Agenda, next: string | null): string {
  const lines: string[] = [`Agenda${next ? ` · ${next}` : ''}`, '']
  if (a.decideFirst.length) {
    lines.push('Decide first')
    a.decideFirst.forEach((d, i) => lines.push(`${i + 1}. ${d.title}${d.refs.length ? ` (${d.refs.join(', ')})` : ''}`))
    lines.push('')
  }
  if (a.topics.length) {
    lines.push('Topics')
    a.topics.forEach((t, i) => lines.push(`${i + 1}. ${t.title}${t.minutes ? ` - ${t.minutes} min` : ''}${t.refs.length ? ` (${t.refs.join(', ')})` : ''}`))
  }
  return lines.join('\n')
}
