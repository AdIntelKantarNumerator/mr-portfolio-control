'use client'

/**
 * Import a 360 Explore report (12 November 2026): client, then user, then
 * report, then what converting it to GPC changes - every dropped, changed or
 * approximate item with why - then Import, which saves it and hands it back
 * to the page to run.
 *
 * The lists come from the snapshot `npm run load:360` keeps; the preview and
 * the import run on the server (lib/import360/service.ts).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { DIMENSIONS, MEASURE_INFO, type DimKey, type MeasureKey } from '@/lib/report-builder/data/types'
import type { SavedItem } from '@/lib/report-builder/page-view'

type Client = { usrsetId: number; name: string; licenseGroup: string | null; reports: number }
type User = { usrId: number; name: string; reports: number }
type Report = { key: string; name: string; type: string; lastUsed: string | null }
type Note = { impact: 'dropped' | 'changed' | 'approximate'; what: string; why: string; did: string }
type Preview = {
  key: string
  report: { name: string; client: string; user: string; type: string; lastUsed: string | null }
  described: {
    rows: Array<{ label: string }>
    columns: Array<{ label: string }>
    pages: Array<{ label: string }>
    data: Array<{ label: string }>
    selections: Array<{ label: string; picked: unknown[]; excluded: unknown[] }>
    time: { label: string | null }
  }
  converted: { verdict: 'ok' | 'partial' | 'refused'; refusal: string | null; spec: { rows?: DimKey[]; columns?: DimKey | null; measures?: MeasureKey[]; calcs?: string[]; filters?: Record<string, string[]> }; notes: Note[] }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/prototypes/report-builder/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ import360: body }) })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `The server said ${res.status}.`)
  return json
}

const IMPACT: Record<Note['impact'], { label: string; order: number }> = {
  dropped: { label: 'Dropped', order: 0 },
  approximate: { label: 'Approximate', order: 1 },
  changed: { label: 'Changed', order: 2 },
}
const dimLabel = (d: DimKey) => DIMENSIONS[d]?.label ?? d
const plural = (n: number, one: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : `${one}s`}`

export function Import360({ onClose, onImported }: { onClose: () => void; onImported: (saved: { id: string; name: string; saved: SavedItem[] }) => void }) {
  const [step, setStep] = useState<'client' | 'user' | 'report' | 'review'>('client')
  const [q, setQ] = useState('')
  const [info, setInfo] = useState<{ reports: number; loaded: string | null } | null>(null)
  const [clients, setClients] = useState<Client[] | null>(null)
  const [client, setClient] = useState<Client | null>(null)
  const [users, setUsers] = useState<User[] | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [reports, setReports] = useState<Report[] | null>(null)
  const [rq, setRq] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [nearest, setNearest] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async <T,>(label: string, f: () => Promise<T>): Promise<T | null> => {
    setBusy(label)
    setError(null)
    try {
      return await f()
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    // The client list itself loads through the search below, with an empty search.
    void call<{ reports: number; loaded: string | null }>({ op: 'info' }).then(setInfo, (e: Error) => setError(e.message))
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Searching clients as the person types, a moment after they stop.
  useEffect(() => {
    if (step !== 'client') return
    const t = setTimeout(() => void call<Client[]>({ op: 'clients', q }).then(setClients, (e: Error) => setError(e.message)), 250)
    return () => clearTimeout(t)
  }, [q, step])

  const pickClient = (c: Client) => {
    setClient(c)
    setStep('user')
    void run('Loading users', async () => setUsers(await call({ op: 'users', usrsetId: c.usrsetId })))
  }
  const pickUser = (u: User) => {
    setUser(u)
    setStep('report')
    setRq('')
    void run('Loading reports', async () => setReports(await call({ op: 'reports', usrId: u.usrId })))
  }
  const pickReport = (r: Report, near = false) => {
    setStep('review')
    setNearest(near)
    setPreview(null)
    void run('Converting: matching names to GPC', async () => setPreview(await call({ op: 'preview', key: r.key, nearest: near })))
  }
  const doImport = () => {
    if (!preview) return
    void run('Importing', async () => {
      const out = await call<{ id: string; name: string; saved: SavedItem[] }>({ op: 'import', key: preview.key, nearest })
      onImported(out)
    })
  }
  const back = () => {
    setError(null)
    if (step === 'review') setStep('report')
    else if (step === 'report') setStep('user')
    else if (step === 'user') setStep('client')
  }

  const crumbs = [client?.name, step !== 'user' && step !== 'client' ? user?.name : null, step === 'review' ? preview?.report.name : null].filter(Boolean)
  const shownReports = (reports ?? []).filter((r) => !rq.trim() || r.name.toLowerCase().includes(rq.trim().toLowerCase()))

  let body: ReactNode = null
  if (step === 'client')
    body = (
      <>
        <input className="rb-imp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients or license groups" aria-label="Search clients" autoFocus />
        <div className="rb-imp-list">
          {clients?.length === 0 ? <p className="rb-muted">{info?.reports ? 'No client matches.' : 'No 360 reports have been copied yet. Run npm run load:360 from a machine that can reach the 360 SQL Server.'}</p> : null}
          {clients?.map((c) => (
            <button key={c.usrsetId} type="button" className="rb-imp-item" onClick={() => pickClient(c)}>
              <b>{c.name}</b>
              <small>
                {c.licenseGroup ? `${c.licenseGroup} · ` : ''}
                {plural(c.reports, 'report')}
              </small>
            </button>
          ))}
        </div>
      </>
    )
  else if (step === 'user')
    body = (
      <div className="rb-imp-list">
        {users?.map((u) => (
          <button key={u.usrId} type="button" className="rb-imp-item" onClick={() => pickUser(u)}>
            <b>{u.name}</b>
            <small>{plural(u.reports, 'report')}</small>
          </button>
        ))}
      </div>
    )
  else if (step === 'report')
    body = (
      <>
        <input className="rb-imp-search" value={rq} onChange={(e) => setRq(e.target.value)} placeholder="Search this user's reports" aria-label="Search reports" autoFocus />
        <div className="rb-imp-list">
          {reports && !shownReports.length ? <p className="rb-muted">No report matches.</p> : null}
          {shownReports.map((r) => (
            <button key={r.key} type="button" className="rb-imp-item" onClick={() => pickReport(r)}>
              <b>{r.name}</b>
              <small>
                {r.type}
                {r.lastUsed ? ` · last used ${r.lastUsed}` : ''}
              </small>
            </button>
          ))}
        </div>
      </>
    )
  else if (preview) {
    const d = preview.described
    const c = preview.converted
    const notes = [...c.notes].sort((a, b) => IMPACT[a.impact].order - IMPACT[b.impact].order)
    const filters = Object.entries(c.spec.filters ?? {}).map(([k, ids]) => `${dimLabel(k as DimKey)}: ${plural(ids.length, 'value')}`)
    body =
      c.verdict === 'refused' && !nearest ? (
        <div className="rb-imp-refused">
          <p>
            <b>This report can&apos;t be imported as it is.</b> {c.refusal}
          </p>
          <p className="rb-muted">The nearest report Report Builder can build is a summary with the same selections and breakouts. Nothing is saved until you choose Import.</p>
          <div className="rb-row">
            <button type="button" className="btn btn-primary" onClick={() => pickReport({ key: preview.key, name: preview.report.name, type: preview.report.type, lastUsed: preview.report.lastUsed }, true)}>
              Show the nearest report
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="rb-imp-compare">
            <div>
              <div className="rb-eyebrow">In 360</div>
              <dl className="rb-dl">
                <dt>Type</dt>
                <dd>{preview.report.type}</dd>
                <dt>Rows</dt>
                <dd>{[...d.pages, ...d.rows].map((r) => r.label).join(' › ') || '—'}</dd>
                <dt>Columns</dt>
                <dd>{d.columns.map((r) => r.label).join(', ') || '—'}</dd>
                <dt>Data</dt>
                <dd>{d.data.map((r) => r.label).join(', ') || '—'}</dd>
                <dt>Selections</dt>
                <dd>{d.selections.map((s) => `${s.label}: ${s.picked.length}${s.excluded.length ? ` (−${s.excluded.length})` : ''}`).join(' · ') || '—'}</dd>
                <dt>Period</dt>
                <dd>{d.time.label ?? '—'}</dd>
              </dl>
            </div>
            <div>
              <div className="rb-eyebrow">In Report Builder</div>
              <dl className="rb-dl">
                <dt>Rows</dt>
                <dd>{(c.spec.rows ?? []).map(dimLabel).join(' › ')}</dd>
                <dt>Columns</dt>
                <dd>{c.spec.columns ? dimLabel(c.spec.columns) : '—'}</dd>
                <dt>Data</dt>
                <dd>
                  {(c.spec.measures ?? []).map((m) => MEASURE_INFO[m].label).join(', ')}
                  {c.spec.calcs?.includes('share') ? ', % down' : ''}
                  {c.spec.calcs?.includes('share_across') ? ', % across' : ''}
                </dd>
                <dt>Selections</dt>
                <dd>{filters.join(' · ') || 'Everything'}</dd>
                <dt>Period</dt>
                <dd>Aug – Oct 2026</dd>
              </dl>
            </div>
          </div>
          <div className="rb-eyebrow">What changes ({notes.length})</div>
          <ul className="rb-imp-notes">
            {notes.map((n, i) => (
              <li key={i}>
                <span className={`rb-imp-tag rb-imp-${n.impact}`}>{IMPACT[n.impact].label}</span>
                <span>
                  <b>{n.what}.</b> {n.why} {n.did}
                </span>
              </li>
            ))}
          </ul>
          <div className="rb-row">
            <button type="button" className="btn btn-primary" onClick={doImport} disabled={!!busy}>
              Import and run
            </button>
            <button type="button" className="btn" onClick={back} disabled={!!busy}>
              Back
            </button>
          </div>
        </>
      )
  }

  return (
    <div className="rb-imp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rb-imp" role="dialog" aria-modal="true" aria-label="Import a 360 Explore report">
        <div className="rb-imp-head">
          <div>
            <div className="rb-eyebrow">Import 360 Explore report</div>
            <h2>{step === 'client' ? 'Choose the client' : step === 'user' ? 'Choose the user' : step === 'report' ? 'Choose the report' : 'Review the conversion'}</h2>
            {crumbs.length ? <p className="rb-muted rb-cap">{crumbs.join(' › ')}</p> : info ? <p className="rb-muted rb-cap">{info.reports.toLocaleString('en-US')} reports used in 2026{info.loaded ? `, copied ${info.loaded}` : ''}</p> : null}
          </div>
          <button type="button" className="rb-imp-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="rb-imp-body">
          {step !== 'client' && step !== 'review' ? (
            <button type="button" className="rb-imp-back" onClick={back}>
              ‹ Back
            </button>
          ) : null}
          {error ? <p className="rb-notes">{error}</p> : null}
          {busy ? <p className="rb-muted">{busy}…</p> : body}
        </div>
      </div>
    </div>
  )
}
