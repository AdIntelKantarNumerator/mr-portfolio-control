'use client'

/**
 * Import a 360 Explore report (12 November 2026): client, then user, then
 * report, then what converting it to GPC changes - every dropped, changed or
 * approximate item with why - then Import, which saves it and hands it back
 * to the page to run.
 *
 * The lists come from the snapshot `npm run load:360` keeps; the preview and
 * the import run on the server (lib/import360/service.ts).
 *
 * An advertiser, parent or brand not found in GPC by name is looked up by
 * its creatives, one at a time with progress shown (tens of seconds each).
 * What that settles is used; what it does not is put to the person: pick a
 * suggested GPC match, or leave it out. In the review, each selection's count
 * opens its items, in 360 and in Report Builder.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DIMENSIONS, MEASURE_INFO, type DimKey, type MeasureKey } from '@/lib/report-builder/data/types'
import type { SavedItem } from '@/lib/report-builder/page-view'

type Client = { usrsetId: number; name: string; licenseGroup: string | null; reports: number }
type User = { usrId: number; name: string; reports: number }
type Report = { key: string; name: string; type: string; lastUsed: string | null }
type Note = { impact: 'dropped' | 'changed' | 'approximate'; what: string; why: string; did: string }
type Unresolved = { e: number; label: string; id: number; name: string }
type Suggestion = { id: string; name: string; context?: string; share: number; via: 'creatives' | 'name' }
type Resolution = { status: 'matched' | 'uncertain'; pick?: { ids: string[]; names: string[]; why: string }; suggestions: Suggestion[]; followed: number; error?: string }
type Choice = { ids: string[]; names: string[]; how: 'creatives' | 'picked'; why?: string } | null
type Preview = {
  key: string
  report: { name: string; client: string; user: string; type: string; lastUsed: string | null }
  described: {
    rows: Array<{ label: string }>
    columns: Array<{ label: string }>
    pages: Array<{ label: string }>
    data: Array<{ label: string }>
    selections: Array<{ label: string; picked: Array<{ name: string }>; excluded: Array<{ name: string }> }>
    time: { label: string | null }
  }
  converted: {
    verdict: 'ok' | 'partial' | 'refused'
    refusal: string | null
    spec: { rows?: DimKey[]; columns?: DimKey | null; measures?: MeasureKey[]; calcs?: string[]; filters?: Record<string, string[]> }
    notes: Note[]
    unresolved?: Unresolved[]
    lists?: Array<{ label: string; from: string[]; to: Array<{ id: string; name: string }> }>
  }
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
const KIND: Record<string, string> = { advertiser: 'Advertiser', top_parent: 'Parent company', product: 'Product' }
const dimLabel = (d: DimKey) => DIMENSIONS[d]?.label ?? d
const plural = (n: number, one: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : `${one}s`}`
const keyOf = (u: Unresolved) => `${u.e}:${u.id}`

export function Import360({ onClose, onImported }: { onClose: () => void; onImported: (saved: { id: string; name: string; saved: SavedItem[] }) => void }) {
  const [step, setStep] = useState<'client' | 'user' | 'report' | 'lookup' | 'review'>('client')
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
  // The creative lookup: what is left to find, what each lookup found, and what is chosen.
  const [todo, setTodo] = useState<Unresolved[]>([])
  const [found, setFound] = useState<Record<string, Resolution>>({})
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [current, setCurrent] = useState(-1)
  const [elapsed, setElapsed] = useState(0)
  // The selection list open in the review: "360:<label>" or "rb:<dimension>".
  const [open, setOpen] = useState<string | null>(null)
  const cancelled = useRef(false)

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

  // A ticking clock while a lookup runs: they take tens of seconds.
  useEffect(() => {
    if (step !== 'lookup' || current < 0 || current >= todo.length) return
    const t = setInterval(() => setElapsed((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [step, current, todo.length])

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

  const review = (key: string, near: boolean, c: Record<string, Choice>) =>
    run('Converting with these matches', async () => {
      setPreview(await call<Preview>({ op: 'preview', key, nearest: near, choices: c }))
      setStep('review')
    })

  // One name at a time, so the person sees each one land.
  const lookup = async (p: Preview, items: Unresolved[], near: boolean) => {
    cancelled.current = false
    setStep('lookup')
    setTodo(items)
    const got: Record<string, Resolution> = {}
    const chosen: Record<string, Choice> = {}
    for (let i = 0; i < items.length; i++) {
      if (cancelled.current) return
      const u = items[i]!
      setCurrent(i)
      setElapsed(0)
      let r: Resolution
      try {
        r = await call<Resolution>({ op: 'resolve', e: u.e, id: u.id, name: u.name })
      } catch (e) {
        r = { status: 'uncertain', suggestions: [], followed: 0, error: (e as Error).message }
      }
      got[keyOf(u)] = r
      if (r.status === 'matched' && r.pick) chosen[keyOf(u)] = { ids: r.pick.ids, names: r.pick.names, how: 'creatives', why: r.pick.why }
      else {
        // Preselect the likeliest: the top creative suggestion, else leave it out.
        const s = r.suggestions.find((x) => x.via === 'creatives')
        chosen[keyOf(u)] = s ? { ids: [s.id], names: [s.name], how: 'picked' } : null
      }
      setFound({ ...got })
      setChoices({ ...chosen })
    }
    if (cancelled.current) return
    setCurrent(items.length)
    // Nothing left to ask: straight on to the review with what was found.
    if (Object.values(got).every((r) => r.status === 'matched')) await review(p.key, near, chosen)
  }

  const pickReport = (r: Report, near = false) => {
    cancelled.current = true
    setStep('review')
    setNearest(near)
    setPreview(null)
    setTodo([])
    setFound({})
    setChoices({})
    setOpen(null)
    void run('Converting: matching names to GPC', async () => {
      const p = await call<Preview>({ op: 'preview', key: r.key, nearest: near })
      setPreview(p)
      if (p.converted.unresolved?.length) void lookup(p, p.converted.unresolved, near)
    })
  }
  // Several GPC matches may stand for one 360 name (Michelob Ultra: its light beer and its zero); none left means leave it out.
  const togglePick = (key: string, sg: Suggestion) => {
    const cur = choices[key]
    const ids = cur ? [...cur.ids] : []
    const names = cur ? [...cur.names] : []
    const at = ids.indexOf(sg.id)
    if (at >= 0) {
      ids.splice(at, 1)
      names.splice(at, 1)
    } else {
      ids.push(sg.id)
      names.push(sg.name)
    }
    setChoices({ ...choices, [key]: ids.length ? { ids, names, how: 'picked' } : null })
  }

  const doImport = () => {
    if (!preview) return
    void run('Importing', async () => {
      const out = await call<{ id: string; name: string; saved: SavedItem[] }>({ op: 'import', key: preview.key, nearest, choices })
      onImported(out)
    })
  }
  const back = () => {
    setError(null)
    if (step === 'review' || step === 'lookup') {
      cancelled.current = true
      setStep('report')
    } else if (step === 'report') setStep('user')
    else if (step === 'user') setStep('client')
  }

  const crumbs = [client?.name, step !== 'user' && step !== 'client' ? user?.name : null, step === 'review' || step === 'lookup' ? preview?.report.name : null].filter(Boolean)
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
  else if (step === 'lookup') {
    const done = Math.min(Math.max(current, 0), todo.length)
    const asking = todo.filter((u) => found[keyOf(u)]?.status === 'uncertain')
    const progress = todo.length ? ((done + (done < todo.length ? Math.min(0.9, elapsed / 60) : 0)) / todo.length) * 100 : 100
    body = (
      <>
        <p>
          {done < todo.length ? (
            <>
              <b>
                Looking up {todo[done]?.name} by its creatives ({done + 1} of {todo.length})…
              </b>{' '}
              <span className="rb-muted">{elapsed}s. Not found in GPC by name, so a sample of its creatives is followed into GPC; each takes up to a minute.</span>
            </>
          ) : asking.length ? (
            <b>{asking.length === 1 ? 'One name needs your choice.' : `${asking.length} names need your choice.`}</b>
          ) : (
            <b>Every name was found.</b>
          )}
        </p>
        <div className="rb-imp-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <ul className="rb-imp-lookup">
          {todo.map((u, i) => {
            const r = found[keyOf(u)]
            const c = choices[keyOf(u)]
            return (
              <li key={keyOf(u)}>
                <div>
                  <span className={`rb-imp-tag ${!r ? 'rb-imp-changed' : r.status === 'matched' ? 'rb-imp-ok' : 'rb-imp-approximate'}`}>{!r ? (i === done ? 'Looking' : 'Waiting') : r.status === 'matched' ? 'Found' : 'Your pick'}</span> <b>{u.name}</b>
                  <small className="rb-muted"> · 360 {u.label.toLowerCase()}</small>
                </div>
                {r?.status === 'matched' && r.pick ? (
                  <p className="rb-muted">
                    → {r.pick.names.join(', ')}: {r.pick.why}.
                  </p>
                ) : null}
                {r?.status === 'uncertain' ? (
                  <div className="rb-imp-pick">
                    <p className="rb-muted">{r.error ? r.error : r.followed ? 'Its creatives land on several GPC entities, none clearly.' : 'No creatives with spend were found for it.'} Pick one or more GPC matches, or leave it out.</p>
                    {r.suggestions.map((sg) => (
                      <label key={sg.id}>
                        <input type="checkbox" checked={!!c && c.ids.includes(sg.id)} onChange={() => togglePick(keyOf(u), sg)} />
                        <span>
                          <b>{sg.name}</b>{' '}
                          <small className="rb-muted">
                            {KIND[sg.id.split(':')[0]!] ?? ''}
                            {sg.context ? ` · ${sg.context}` : ''} · {sg.via === 'creatives' ? `${Math.round(sg.share * 100)}% of its creatives' spend` : 'similar name'}
                          </small>
                        </span>
                      </label>
                    ))}
                    <label>
                      <input type="checkbox" checked={c === null} onChange={() => setChoices({ ...choices, [keyOf(u)]: null })} />
                      <span>Leave it out</span>
                    </label>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
        <div className="rb-row">
          <button type="button" className="btn btn-primary" disabled={done < todo.length || !!busy} onClick={() => preview && void review(preview.key, nearest, choices)}>
            Continue to the review
          </button>
          <button type="button" className="btn" onClick={back}>
            Back
          </button>
        </div>
      </>
    )
  } else if (preview) {
    const d = preview.described
    const c = preview.converted
    const notes = [...c.notes].sort((a, b) => IMPACT[a.impact].order - IMPACT[b.impact].order)
    const names = new Map((c.lists ?? []).flatMap((l) => l.to.map((t) => [t.id, t.name] as const)))
    const filters = Object.entries(c.spec.filters ?? {})
    const toggle = (k: string) => setOpen(open === k ? null : k)
    let shown: { title: string; items: string[]; excluded: string[] } | null = null
    if (open?.startsWith('360:')) {
      const s = d.selections.find((x) => x.label === open.slice(4))
      if (s) shown = { title: `${s.label} in 360`, items: s.picked.map((p) => p.name), excluded: s.excluded.map((p) => p.name) }
    } else if (open?.startsWith('rb:')) {
      const k = open.slice(3)
      shown = { title: `${dimLabel(k as DimKey)} in Report Builder`, items: (c.spec.filters?.[k] ?? []).map((id) => names.get(id) ?? id), excluded: [] }
    }
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
                <dd>
                  {d.selections.length
                    ? d.selections.map((s) => (
                        <button key={s.label} type="button" className={`rb-imp-count${open === `360:${s.label}` ? ' rb-on' : ''}`} onClick={() => toggle(`360:${s.label}`)}>
                          {s.label}: {s.picked.length}
                          {s.excluded.length ? ` (−${s.excluded.length})` : ''}
                        </button>
                      ))
                    : '—'}
                </dd>
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
                <dd>
                  {filters.length
                    ? filters.map(([k, ids]) => (
                        <button key={k} type="button" className={`rb-imp-count${open === `rb:${k}` ? ' rb-on' : ''}`} onClick={() => toggle(`rb:${k}`)}>
                          {dimLabel(k as DimKey)}: {ids.length}
                        </button>
                      ))
                    : 'Everything'}
                </dd>
                <dt>Period</dt>
                <dd>Aug – Oct 2026</dd>
              </dl>
            </div>
          </div>
          {shown ? (
            <div className="rb-imp-items">
              <div className="rb-imp-items-head">
                <b>
                  {shown.title} ({shown.items.length})
                </b>
                <button type="button" className="rb-imp-close" onClick={() => setOpen(null)} aria-label="Close the list">
                  ×
                </button>
              </div>
              <ul>
                {shown.items.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
                {shown.excluded.map((x, i) => (
                  <li key={`x${i}`} className="rb-muted">
                    Excluded: {x}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
            {todo.length ? (
              <button type="button" className="btn" onClick={() => setStep('lookup')} disabled={!!busy}>
                Change matches
              </button>
            ) : null}
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
            <h2>{step === 'client' ? 'Choose the client' : step === 'user' ? 'Choose the user' : step === 'report' ? 'Choose the report' : step === 'lookup' ? 'Finding names by their creatives' : 'Review the conversion'}</h2>
            {crumbs.length ? <p className="rb-muted rb-cap">{crumbs.join(' › ')}</p> : info ? <p className="rb-muted rb-cap">{info.reports.toLocaleString('en-US')} reports used in 2026{info.loaded ? `, copied ${info.loaded}` : ''}</p> : null}
          </div>
          <button type="button" className="rb-imp-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="rb-imp-body">
          {step !== 'client' && step !== 'review' && step !== 'lookup' ? (
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
