'use client'

/**
 * Client Evaluation's page: the snapshots and their refresh, the client list,
 * and the popups for a client's people, a 360 user's reports, a report's spec,
 * and an account's entitlements. Everything is read from ./api.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/items/parts'
import type { Described } from '@/lib/import360/decode'
import type { ReadableRel } from '@/lib/client-eval/rel'
import type { ProfileSummary } from '@/lib/client-eval/profiles'
import type { ClientRow, PersonRow, SourceInfo } from '@/lib/client-eval/store'
import { PLATFORM_LABEL, SNAPSHOT_ONLY, type Ent360, type EntClassic, type EntMagnifier, type Entitlements, type Platform } from '@/lib/client-eval/types'

type Source = SourceInfo & { refreshable: boolean }
const API = '/client-evaluation/api'

async function get<T>(params: Record<string, string>): Promise<T> {
  const res = await fetch(`${API}?${new URLSearchParams(params)}`, { cache: 'no-store' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
  return body as T
}
async function post(body: Record<string, unknown>) {
  const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error ?? `Request failed (${res.status})`)
  return out
}

const n = (x: number) => x.toLocaleString('en-US')

type DeckScope = { kind: 'client'; clientId: string } | { kind: 'account'; key: string } | { kind: 'person'; clientId: string; person: string }

/** Open the Impact Deck's own window, which builds the deck and downloads it. */
function openDeck(scope: DeckScope, title: string) {
  const url = `/client-evaluation/deck?scope=${encodeURIComponent(JSON.stringify(scope))}&title=${encodeURIComponent(title)}`
  window.open(url, '_blank', 'popup,width=760,height=600')
}

function DeckButton({ scope, title }: { scope: DeckScope; title: string }) {
  return (
    <button type="button" className="btn ce-sm ce-deck-btn" onClick={() => openDeck(scope, title)} title="Build a PowerPoint of what changes for them in Insights Studio">
      Impact deck
    </button>
  )
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')

function Badge({ p, onClick, title }: { p: Platform; onClick?: () => void; title?: string }) {
  const cls = `ce-badge ce-${p}`
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title={title ?? `${PLATFORM_LABEL[p]} entitlements`}>
      {PLATFORM_LABEL[p]}
    </button>
  ) : (
    <span className={cls} title={title}>
      {PLATFORM_LABEL[p]}
    </span>
  )
}

// ------------------------------------------------------------------ the snapshots

function Sources({ contact, onReady }: { contact: string; onReady: () => void }) {
  const [list, setList] = useState<Source[] | null>(null)
  const [confirm, setConfirm] = useState<Platform | null>(null)
  const [error, setError] = useState<string | null>(null)
  const running = list?.some((s) => s.status === 'running') ?? false
  const was = useRef(false)

  const load = useCallback(async () => {
    try {
      setList((await get<{ sources: Source[] }>({ op: 'sources' })).sources)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    get<{ sources: Source[] }>({ op: 'sources' }).then(
      (r) => setList(r.sources),
      (e) => setError((e as Error).message),
    )
  }, [])
  useEffect(() => {
    if (!running) {
      if (was.current) onReady()
      was.current = false
      return
    }
    was.current = true
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [running, load, onReady])

  async function refresh(p: Platform) {
    setConfirm(null)
    setError(null)
    try {
      await post({ op: 'refresh', platform: p })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <div className="ce-sources">
        {(list ?? []).map((s) => {
          const pct = s.total ? Math.round((100 * s.done) / s.total) : null
          return (
            <div key={s.platform} className={`ce-source ce-st-${s.status}`}>
              <div className="ce-source-head">
                <Badge p={s.platform} />
                {SNAPSHOT_ONLY[s.platform] ? <span className="ce-snaponly" title={`Refreshed from a laptop. Ask ${contact} if you need it refreshed.`}>Snapshot only</span> : null}
                {s.refreshable && s.status !== 'running' ? (
                  <button type="button" className="btn ce-refresh" onClick={() => setConfirm(s.platform)}>
                    Refresh
                  </button>
                ) : null}
              </div>
              {s.status === 'running' ? (
                <div className="ce-progress">
                  <div className="ce-progress-step">{s.step ?? 'Working'}…</div>
                  <div className="ce-track">
                    <div className={`ce-bar${pct === null ? ' ce-indet' : ''}`} style={pct === null ? undefined : { width: `${Math.max(4, pct)}%` }} />
                  </div>
                </div>
              ) : s.status === 'empty' ? (
                <div className="ce-source-meta">Not loaded yet.</div>
              ) : (
                <div className="ce-source-meta">
                  {s.counts ? (
                    <b>
                      {n(s.counts.accounts ?? 0)} accounts · {n(s.counts.users ?? 0)} users
                    </b>
                  ) : null}
                  <span>As of {when(s.loadedAt)}</span>
                  {s.status === 'failed' ? <span className="ce-bad">Last refresh failed: {s.error}</span> : null}
                  <a className="ce-dl" href={`/client-evaluation/users?platform=${s.platform}`} download title={`Every active ${PLATFORM_LABEL[s.platform]} user: name, email, account, username, created, last login (CSV)`}>
                    Active users ↓ CSV
                  </a>
                </div>
              )}
              {SNAPSHOT_ONLY[s.platform] ? <div className="ce-source-note">Ping {contact} to refresh.</div> : null}
            </div>
          )
        })}
      </div>
      {error ? <p className="mr-said mr-bad">{error}</p> : null}
      {confirm ? (
        <Modal title={`Refresh ${PLATFORM_LABEL[confirm]}?`} onClose={() => setConfirm(null)}>
          <p>This reads every {PLATFORM_LABEL[confirm]} client, user and entitlement again and rebuilds the client list. It takes a few minutes. The current snapshot stays on screen until it finishes.</p>
          <div className="pd-actions">
            <button type="button" className="btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void refresh(confirm)}>
              Refresh
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}

// ------------------------------------------------------------------ the export

const EXPORT_MAX = 300

/**
 * Export the ticked clients and their users (Scott, 20 November 2026: the
 * whole list was too big). Built on request and downloaded straight away;
 * nothing is kept on the server.
 */
function ExportPicked({ picked, onClear }: { picked: Map<string, string>; onClear: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!picked.size) return <span className="ce-muted ce-sm">Tick clients to export them</span>
  async function exportPicked() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'export', clients: [...picked.keys()] }) })
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `The export failed (${res.status}).`)
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'Client Evaluation export.xlsx'
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const over = picked.size > EXPORT_MAX
  return (
    <span className="ce-tick">
      <b>{n(picked.size)} selected</b>
      <button type="button" className="btn btn-primary ce-sm" disabled={busy || over} onClick={() => void exportPicked()} title="The ticked clients, every user in each of their accounts, and each user's last login, as an Excel workbook">
        {busy ? 'Exporting…' : 'Export selected'}
      </button>
      <button type="button" className="btn ce-sm" disabled={busy} onClick={onClear}>
        Clear
      </button>
      {over ? <span className="ce-bad">Up to {EXPORT_MAX} at a time</span> : null}
      {error ? <span className="ce-bad">{error}</span> : null}
    </span>
  )
}

// ------------------------------------------------------------------ the list

type Popup =
  | { kind: 'account'; key: string }
  | { kind: 'people'; client: ClientRow; platform?: Platform }
  | { kind: 'reports'; usrId: number; who: string }
  | { kind: 'mreports'; accountKey: string; who: string }
  | { kind: 'searches'; user: string; account: string; who: string }
  | { kind: 'profiles'; usrId: number; who: string }
  | { kind: 'report'; key: string }
  | { kind: 'merge'; client: ClientRow }

export function ClientEvaluation({ contact }: { contact: string }) {
  const [q, setQ] = useState('')
  const [platform, setPlatform] = useState('all')
  const [sort, setSort] = useState('reports')
  const [active, setActive] = useState(true)
  const [internal, setInternal] = useState(false)
  const [rows, setRows] = useState<ClientRow[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  /** Clients ticked for export, by id, with their names; kept across searches and pages. */
  const [picked, setPicked] = useState<Map<string, string>>(new Map())
  const pick = (c: ClientRow, on: boolean) =>
    setPicked((m) => {
      const next = new Map(m)
      if (on) next.set(c.id, c.name)
      else next.delete(c.id)
      return next
    })
  const [stack, setStack] = useState<Popup[]>([])
  const [tick, setTick] = useState(0)
  const push = (p: Popup) => setStack((s) => [...s, p])
  const pop = () => setStack((s) => s.slice(0, -1))

  const params = useMemo(() => ({ op: 'clients', q, platform, sort, active: active ? '1' : '0', internal: internal ? '1' : '0' }), [q, platform, sort, active, internal])
  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await get<{ rows: ClientRow[]; total: number }>(params)
        if (live) {
          setRows(r.rows)
          setTotal(r.total)
          setError(null)
        }
      } catch (e) {
        if (live) setError((e as Error).message)
      } finally {
        if (live) setBusy(false)
      }
    }, 200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [params, tick])

  async function more() {
    const r = await get<{ rows: ClientRow[]; total: number }>({ ...params, offset: String(rows.length) })
    setRows((x) => [...x, ...r.rows])
  }
  const reload = useCallback(() => setTick((t) => t + 1), [])

  async function split(member: string) {
    try {
      await post({ op: 'split', member })
      reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const top = stack[stack.length - 1]
  return (
    <div className="ce">
      <Sources contact={contact} onReady={reload} />

      <div className="ce-controls">
        <input id="ce-q" className="ce-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" aria-label="Search clients" />
        <select id="ce-platform" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
          <option value="all">All platforms</option>
          <option value="360">360</option>
          <option value="classic">Classic</option>
          <option value="magnifier">Magnifier</option>
          <option value="multi">On 2+ platforms</option>
        </select>
        <select id="ce-sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="reports">Most 360 reports</option>
          <option value="users">Most users</option>
          <option value="logins">Most recent logins</option>
          <option value="name">A–Z</option>
        </select>
        <label className="ce-tick">
          <input id="ce-active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active only
        </label>
        <label className="ce-tick">
          <input id="ce-internal" type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Show internal
        </label>
        <span className="ce-count">{busy ? 'Loading…' : `${n(total)} clients`}</span>
        {q.trim() && total > 0 ? (
          <button
            type="button"
            className="btn ce-sm"
            disabled={total > EXPORT_MAX}
            title={total > EXPORT_MAX ? `Narrow the search: select all takes up to ${EXPORT_MAX} clients` : 'Tick every client this search finds'}
            onClick={async () => {
              try {
                const r = await get<{ clients: Array<{ id: string; name: string }> }>({ ...params, ids: '1' })
                setPicked((m) => {
                  const next = new Map(m)
                  for (const c of r.clients) next.set(c.id, c.name)
                  return next
                })
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          >
            Select all {n(total)}
          </button>
        ) : null}
        <ExportPicked picked={picked} onClear={() => setPicked(new Map())} />
      </div>
      {error ? <p className="mr-said mr-bad">{error}</p> : null}

      <div className="ce-table">
        <table className="dtable">
          <thead>
            <tr>
              <th className="ce-pick" />
              <th>Client</th>
              <th>Platforms</th>
              <th className="ce-num" title="Distinct people across the platforms, by email. Active / all.">Users</th>
              <th className="ce-num" title="360: reports used in 2026. Magnifier: distinct reports set up across the client's Magnifier accounts.">Reports</th>
              <th>Entitlements</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const isOpen = open === c.id
              const byPlatform = (p: Platform) => c.members.filter((m) => m.platform === p)
              return [
                <tr key={c.id} className={isOpen ? 'ce-open' : undefined}>
                  <td className="ce-pick">
                    <input id={`ce-pick-${c.id}`} type="checkbox" checked={picked.has(c.id)} onChange={(e) => pick(c, e.target.checked)} aria-label={`Tick ${c.name} for export`} />
                  </td>
                  <td>
                    <button type="button" className="ce-name" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}>
                      <span className="ce-caret">{isOpen ? '▾' : '▸'}</span>
                      <b>{c.name}</b>
                    </button>
                    <div className="ce-sub">
                      {c.members.length > 1 ? `${c.members.length} accounts` : '1 account'}
                      {c.company ? ` · 360 company: ${c.company}` : ''}
                      {!c.active ? ' · inactive' : ''}
                      {c.internal ? ' · internal' : ''}
                    </div>
                    <DeckButton scope={{ kind: 'client', clientId: c.id }} title={c.name} />
                  </td>
                  <td>
                    <div className="ce-badges">
                      {c.platforms.map((p) => (
                        <Badge key={p} p={p} onClick={() => push({ kind: 'account', key: byPlatform(p)[0]!.key })} />
                      ))}
                    </div>
                  </td>
                  <td className="ce-num">
                    <button type="button" className="ce-pill" onClick={() => push({ kind: 'people', client: c })} title="People, and each person's reports">
                      {n(c.activeUsers)}
                      <span className="ce-of"> / {n(c.users)}</span> ›
                    </button>
                    {c.logins30 ? <div className="ce-sub" title="Logins in the last 30 days: 360 sessions, Classic logins, Magnifier SSO sign-ins">{n(c.logins30)} logins · 30 days</div> : null}
                  </td>
                  <td className="ce-num">
                    <div className="ce-reps">
                      {c.reports ? (
                        <button type="button" className="ce-pill" onClick={() => push({ kind: 'people', client: c, platform: '360' })} title="360 reports used in 2026: open a person's reports, then a report's spec">
                          <Badge p="360" /> {n(c.reports)} ›
                        </button>
                      ) : null}
                      {c.magnifierSearches ? (
                        <button type="button" className="ce-pill" onClick={() => push({ kind: 'people', client: c, platform: 'magnifier' })} title="Magnifier searches saved or updated in 2026: open a person's searches">
                          <Badge p="magnifier" /> {n(c.magnifierSearches)} searches ›
                        </button>
                      ) : null}
                      {c.magnifierReports ? (
                        <button type="button" className="ce-pill" onClick={() => push({ kind: 'people', client: c, platform: 'magnifier' })} title="Magnifier reports set up for the client's accounts">
                          <Badge p="magnifier" /> {n(c.magnifierReports)} reports ›
                        </button>
                      ) : null}
                      {!c.reports && !c.magnifierReports && !c.magnifierSearches ? <span className="ce-muted">—</span> : null}
                    </div>
                  </td>
                  <td className="ce-ents">
                    {c.platforms.map((p) => {
                      const ms = byPlatform(p)
                      return (
                        <button key={p} type="button" className="ce-ent" onClick={() => push({ kind: 'account', key: ms[0]!.key })}>
                          <Badge p={p} />
                          <span>{ms[0]!.summary ?? '—'}</span>
                          {ms.length > 1 ? <span className="ce-muted"> +{ms.length - 1} more</span> : null}
                        </button>
                      )
                    })}
                  </td>
                </tr>,
                isOpen ? (
                  <tr key={`${c.id}-m`} className="ce-members-row">
                    <td colSpan={6}>
                      <div className="ce-members">
                        {c.members.map((m) => (
                          <div key={m.key} className="ce-member">
                            <Badge p={m.platform} />
                            <span className="ce-member-name">
                              {m.name} <span className="ce-muted">{m.accountId}</span>
                              {!m.active ? <span className="ce-muted"> · inactive</span> : null}
                            </span>
                            <span className="ce-muted">
                              {n(m.activeUsers)}/{n(m.users)} users{m.platform === '360' && m.reports ? ` · ${n(m.reports)} reports` : ''}
                              {m.platform === 'magnifier' && m.reports ? ` · ${n(m.reports)} reports` : ''}
                            </span>
                            <span className="ce-member-acts">
                              <DeckButton scope={{ kind: 'account', key: m.key }} title={m.name} />
                              <button type="button" className="btn ce-sm" onClick={() => push({ kind: 'account', key: m.key })}>
                                Entitlements
                              </button>
                              {c.members.length > 1 ? (
                                <button type="button" className="btn ce-sm" onClick={() => void split(m.key)} title="Take this account out of this client. Kept through refreshes.">
                                  Split out
                                </button>
                              ) : null}
                            </span>
                          </div>
                        ))}
                        <div className="ce-how">
                          {c.how.length ? (
                            <>
                              <b>Why together:</b> {[...new Set(c.how.map((h) => h.why))].slice(0, 6).join(' · ')}
                              {new Set(c.how.map((h) => h.why)).size > 6 ? ' …' : ''}
                            </>
                          ) : (
                            <span className="ce-muted">Matched to nothing on another platform.</span>
                          )}
                          <button type="button" className="btn ce-sm" onClick={() => push({ kind: 'merge', client: c })}>
                            Merge with another client…
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ]
            })}
          </tbody>
        </table>
        {!rows.length && !busy ? <p className="tile-empty">No clients match.</p> : null}
      </div>
      {rows.length < total ? (
        <button type="button" className="btn ce-more" onClick={() => void more()}>
          Show more ({n(total - rows.length)} left)
        </button>
      ) : null}

      {top?.kind === 'account' ? <AccountPopup k={top.key} onClose={pop} /> : null}
      {top?.kind === 'people' ? (
        <PeoplePopup client={top.client} initialPlatform={top.platform} onClose={pop} onReports={(usrId, who) => push({ kind: 'reports', usrId, who })} onMagnifierReports={(accountKey, who) => push({ kind: 'mreports', accountKey, who })} onSearches={(user, account, who) => push({ kind: 'searches', user, account, who })} onProfiles={(usrId, who) => push({ kind: 'profiles', usrId, who })} />
      ) : null}
      {top?.kind === 'profiles' ? <ProfilesPopup usrId={top.usrId} who={top.who} onClose={pop} /> : null}
      {top?.kind === 'searches' ? <SearchesPopup user={top.user} account={top.account} who={top.who} onClose={pop} /> : null}
      {top?.kind === 'mreports' ? <MagnifierReportsPopup k={top.accountKey} who={top.who} onClose={pop} /> : null}
      {top?.kind === 'reports' ? <ReportsPopup usrId={top.usrId} who={top.who} onClose={pop} onReport={(key) => push({ kind: 'report', key })} /> : null}
      {top?.kind === 'report' ? <ReportPopup k={top.key} onClose={pop} /> : null}
      {top?.kind === 'merge' ? (
        <MergePopup
          client={top.client}
          onClose={pop}
          onMerged={() => {
            pop()
            setOpen(null)
            reload()
          }}
        />
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------ people

/** A person's report volume: their 360 reports, and the reports on their Magnifier accounts. */
const volume = (p: PersonRow) => p.accounts.reduce((t, a) => t + (a.platform !== 'classic' ? a.reports : 0), 0) + Math.max(0, ...p.accounts.map((a) => (a.platform === 'magnifier' ? a.accountReports : 0)))

function PeoplePopup({
  client,
  initialPlatform,
  onClose,
  onReports,
  onMagnifierReports,
  onSearches,
  onProfiles,
}: {
  client: ClientRow
  initialPlatform?: Platform
  onClose: () => void
  onReports: (usrId: number, who: string) => void
  onMagnifierReports: (accountKey: string, who: string) => void
  onSearches: (user: string, account: string, who: string) => void
  onProfiles: (usrId: number, who: string) => void
}) {
  const [data, setData] = useState<{ name: string; people: PersonRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('reports')
  const [activeOnly, setActiveOnly] = useState(false)
  const [platform, setPlatform] = useState<Platform | 'all'>(initialPlatform ?? 'all')
  useEffect(() => {
    get<{ name: string; people: PersonRow[] }>({ op: 'people', client: client.id }).then(setData, (e) => setError((e as Error).message))
  }, [client.id])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data?.people ?? [])
      .map((p) => (platform === 'all' ? p : { ...p, accounts: p.accounts.filter((a) => a.platform === platform) }))
      .map((p) => (platform === 'all' ? p : { ...p, active: p.accounts.some((a) => a.active), reports: platform === '360' ? p.accounts.reduce((t, a) => t + a.reports, 0) : platform === 'magnifier' ? Math.max(0, ...p.accounts.map((a) => a.accountReports)) : 0 }))
      .filter((p) => p.accounts.length && (!activeOnly || p.active) && (!needle || `${p.name} ${p.email ?? ''} ${p.accounts.map((a) => a.login ?? '').join(' ')}`.toLowerCase().includes(needle)))
      .sort((a, b) =>
        sort === 'name'
          ? a.name.localeCompare(b.name)
          : sort === 'logins'
            ? b.logins30 - a.logins30 || (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '') || a.name.localeCompare(b.name)
            : volume(b) - volume(a) || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name),
      )
  }, [data, q, sort, activeOnly, platform])

  return (
    <Modal title={`People at ${client.name}`} onClose={onClose}>
      <div className="ce-pop">
        <div className="ce-seg" role="tablist" aria-label="Application">
          {(['all', '360', 'magnifier', 'classic'] as const).map((x) => (
            <button key={x} type="button" role="tab" aria-selected={platform === x} className={platform === x ? 'ce-on' : undefined} onClick={() => setPlatform(x)}>
              {x === 'all' ? 'All' : PLATFORM_LABEL[x]}
              <span className="ce-muted"> {n(x === 'all' ? (data?.people.length ?? 0) : (data?.people.filter((p) => p.accounts.some((a) => a.platform === x)).length ?? 0))}</span>
            </button>
          ))}
        </div>
        <div className="ce-controls">
          <input id="ce-people-q" className="ce-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" autoFocus />
          <select id="ce-people-sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort people">
            <option value="reports">Most reports</option>
            <option value="logins">Most recent logins</option>
            <option value="name">A–Z</option>
          </select>
          <label className="ce-tick">
            <input id="ce-people-active" type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active only
          </label>
          <span className="ce-count">{data ? `${n(shown.length)} of ${n(data.people.length)}` : 'Loading…'}</span>
        </div>
        {error ? <p className="mr-said mr-bad">{error}</p> : null}
        <div className="ce-table ce-scroll">
          <table className="dtable">
            <thead>
              <tr>
                <th>Person</th>
                <th>Platforms</th>
                <th title="From each application's own records: 360 and Magnifier user creation dates. Classic records none, so its first login. The earliest across a person's applications.">Created</th>
                <th title="360: latest login session. Classic: latest login. Magnifier: latest sign-in through the SSO pool, which all MediaRadar apps share.">Last seen</th>
                <th title="360: reports this person used in 2026. Magnifier: the reports set up for their account.">Reports</th>
                {platform !== 'magnifier' && platform !== 'classic' ? <th title="360 reporting profiles: the measures, media, markets and demographics a person reports with">Reporting profiles</th> : null}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 500).map((p) => (
                <tr key={p.key} className={p.active ? undefined : 'ce-inactive'}>
                  <td>
                    <b>{p.name}</b>
                    {!p.active ? <span className="ce-muted"> · inactive</span> : null}
                    <div className="ce-sub">{p.email ?? p.accounts[0]?.login ?? ''}</div>
                    <DeckButton scope={{ kind: 'person', clientId: client.id, person: p.key }} title={`${p.name} (${client.name})`} />
                  </td>
                  <td>
                    <div className="ce-accts">
                      {p.accounts.map((a) => (
                        <span key={`${a.platform}:${a.accountId}:${a.userId}`} className={`ce-acct${a.active ? '' : ' ce-off'}`} title={`${a.accountName}${a.login ? ` · login ${a.login}` : ''}${a.active ? '' : ' · inactive'}`}>
                          <Badge p={a.platform} />
                          <span>{a.accountName}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td title={p.accounts.filter((a) => a.created).map((a) => `${a.platform === 'classic' ? 'Classic (first login)' : a.platform === '360' ? '360' : 'Magnifier'}: ${a.created}`).join('\n')} className="ce-date">
                    {p.created ?? <span className="ce-muted">—</span>}
                  </td>
                  <td className="ce-date">
                    {p.lastSeen ?? <span className="ce-muted">—</span>}
                    {p.logins30 ? <div className="ce-sub" title="Logins in the last 30 days: 360 sessions, Classic logins, Magnifier SSO sign-ins">{n(p.logins30)} logins · 30 days</div> : null}
                  </td>
                  <td>
                    <div className="ce-accts">
                      {p.accounts
                        .filter((a) => a.platform === '360' && a.reports > 0)
                        .map((a) => (
                          <button key={`360:${a.userId}`} type="button" className="ce-pill" onClick={() => onReports(Number(a.userId), p.name)}>
                            <Badge p="360" /> {n(a.reports)} report{a.reports === 1 ? '' : 's'} ›
                          </button>
                        ))}
                      {p.accounts
                        .filter((a) => a.platform === 'magnifier' && a.accountReports > 0)
                        .map((a) => (
                          <button key={`m:${a.accountId}`} type="button" className="ce-pill" onClick={() => onMagnifierReports(`magnifier:${a.accountId}`, a.accountName)} title={`The reports set up for ${a.accountName}`}>
                            <Badge p="magnifier" /> {n(a.accountReports)} report{a.accountReports === 1 ? '' : 's'} ›
                          </button>
                        ))}
                      {p.accounts
                        .filter((a) => a.platform === 'magnifier' && a.reports > 0)
                        .map((a) => (
                          <button key={`ms:${a.accountId}:${a.userId}`} type="button" className="ce-pill" onClick={() => onSearches(a.userId, a.accountId, p.name)} title={`Searches ${p.name} saved or updated in 2026 on ${a.accountName}`}>
                            <Badge p="magnifier" /> {n(a.reports)} saved search{a.reports === 1 ? '' : 'es'} ›
                          </button>
                        ))}
                      {!p.accounts.some((a) => (a.platform !== 'classic' && a.reports > 0) || (a.platform === 'magnifier' && a.accountReports > 0)) ? <span className="ce-muted">—</span> : null}
                    </div>
                  </td>
                  {platform !== 'magnifier' && platform !== 'classic' ? (
                    <td>
                      <div className="ce-accts">
                        {p.accounts
                          .filter((a) => a.platform === '360' && a.profiles > 0)
                          .map((a) => (
                            <button key={`rp:${a.userId}`} type="button" className="ce-pill" onClick={() => onProfiles(Number(a.userId), p.name)}>
                              {n(a.profiles)} profile{a.profiles === 1 ? '' : 's'} ›
                            </button>
                          ))}
                        {!p.accounts.some((a) => a.platform === '360' && a.profiles > 0) ? <span className="ce-muted">—</span> : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 500 ? <p className="ce-muted">Showing the first 500. Search to narrow.</p> : null}
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ 360 reporting profiles

function ProfilesPopup({ usrId, who, onClose }: { usrId: number; who: string; onClose: () => void }) {
  const [list, setList] = useState<ProfileSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => {
    get<{ profiles: ProfileSummary[] }>({ op: 'profiles', user: String(usrId) }).then(
      (r) => {
        setList(r.profiles)
        if (r.profiles.length === 1) setOpen(r.profiles[0]!.id)
      },
      (e) => setError((e as Error).message),
    )
  }, [usrId])
  return (
    <Modal title={`${who}'s 360 reporting profiles`} onClose={onClose}>
      <div className="ce-pop">
        <span className="ce-count">{list ? `${n(list.length)} profile${list.length === 1 ? '' : 's'}, read live from 360` : 'Reading 360…'}</span>
        {error ? <p className="mr-said mr-bad">{error}</p> : null}
        <div className="ce-filters">
          {(list ?? []).map((p) => (
            <div key={p.id} className="ce-report">
              <div>
                <button type="button" className="ce-link" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  {open === p.id ? '▾' : '▸'} {p.name}
                </button>{' '}
                {p.isDefault ? <span className="ce-name-chip">Default</span> : null}{' '}
                <span className="ce-muted">
                  last used {p.lastUsed ?? '—'}
                  {p.lists.length ? ` · ${p.lists.map((l) => `${l.list} ${n(l.count)}`).join(' · ')}` : ''}
                </span>
              </div>
              {open === p.id ? (
                <dl className="ce-dl">
                  {p.description ? (
                    <>
                      <dt>About</dt>
                      <dd>{p.description}</dd>
                    </>
                  ) : null}
                  {p.lists.map((l) => (
                    <Fragment key={`${l.list}|${l.type}`}>
                      <dt>
                        {l.list}
                        <div className="ce-muted">{l.type}</div>
                      </dt>
                      <dd>
                        <Names items={l.names} total={l.count} />
                      </dd>
                    </Fragment>
                  ))}
                  <dt>Media</dt>
                  <dd>
                    {p.media === null ? (
                      'All media'
                    ) : p.media.length ? (
                      <div className="ce-filters">
                        {p.media.map((g) => (
                          <div key={g.type}>
                            <b>{g.type}</b> <MediaChips media={g.media} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="ce-muted">Not set</span>
                    )}
                  </dd>
                  <dt>Measures</dt>
                  <dd>{p.measures.length ? <MediaChips media={p.measures} /> : <span className="ce-muted">Not set</span>}</dd>
                  <dt>Markets</dt>
                  <dd>{p.markets === null ? 'All markets' : p.markets.length ? <Names items={p.markets} /> : <span className="ce-muted">Not set</span>}</dd>
                  <dt>Demographics</dt>
                  <dd>
                    {p.demographics.length ? p.demographics.join(', ') : '—'}
                    {p.demographicMarket ? <span className="ce-muted"> · {p.demographicMarket} market</span> : null}
                  </dd>
                  {p.rating ? (
                    <>
                      <dt>Ratings</dt>
                      <dd>{p.rating}</dd>
                    </>
                  ) : null}
                  <dt>Layout</dt>
                  <dd className="ce-muted">{p.options.join(' · ') || '—'}</dd>
                </dl>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ 360 reports

function ReportsPopup({ usrId, who, onClose, onReport }: { usrId: number; who: string; onClose: () => void; onReport: (key: string) => void }) {
  const [list, setList] = useState<Array<{ key: string; name: string; type: string; lastUsed: string | null }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState('recent')
  useEffect(() => {
    get<{ reports: typeof list }>({ op: 'reports', user: String(usrId) }).then((r) => setList(r.reports), (e) => setError((e as Error).message))
  }, [usrId])
  const shown = [...(list ?? [])].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '')))
  return (
    <Modal title={`${who}'s 360 reports used in 2026`} onClose={onClose}>
      <div className="ce-pop">
        <div className="ce-controls">
          <select id="ce-reports-sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort reports">
            <option value="recent">Last used</option>
            <option value="name">A–Z</option>
          </select>
          <span className="ce-count">{list ? `${n(list.length)} reports, read live from 360` : 'Reading 360…'}</span>
        </div>
        {error ? <p className="mr-said mr-bad">{error}</p> : null}
        <div className="ce-table ce-scroll">
          <table className="dtable">
            <tbody>
              {shown.map((r) => (
                <tr key={r.key}>
                  <td>
                    <button type="button" className="ce-link" onClick={() => onReport(r.key)}>
                      {r.name}
                    </button>
                    <div className="ce-sub">{r.type}</div>
                  </td>
                  <td className="ce-num">{r.lastUsed ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  )
}

function ReportPopup({ k, onClose }: { k: string; onClose: () => void }) {
  const [r, setR] = useState<{ name: string; client: string; user: string; lastUsed: string | null; described: Described } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    get<NonNullable<typeof r>>({ op: 'report', key: k }).then(setR, (e) => setError((e as Error).message))
  }, [k])
  const d = r?.described
  const sel = d?.selections.find((s) => `${s.mpt}:${s.e}` === open)
  return (
    <Modal title={r?.name ?? 'Report'} onClose={onClose}>
      <div className="ce-pop">
        {error ? <p className="mr-said mr-bad">{error}</p> : null}
        {!r && !error ? <p className="ce-muted">Reading the report from 360…</p> : null}
        {r && d ? (
          <>
            <p className="ce-muted">
              {r.client} · {r.user} · last used {r.lastUsed ?? '—'}
            </p>
            <dl className="ce-dl">
              <dt>Type</dt>
              <dd>{d.type.name}</dd>
              <dt>Rows</dt>
              <dd>{[...d.pages, ...d.rows].map((x) => x.label).join(' › ') || '—'}</dd>
              <dt>Columns</dt>
              <dd>{d.columns.map((x) => x.label).join(', ') || '—'}</dd>
              <dt>Data</dt>
              <dd>{d.data.map((x) => x.label).join(', ') || '—'}</dd>
              <dt>Period</dt>
              <dd>{d.time.label ?? '—'}</dd>
              <dt>Selections</dt>
              <dd>
                {d.selections.length ? (
                  <div className="ce-chips">
                    {d.selections.map((s) => (
                      <button key={`${s.mpt}:${s.e}`} type="button" className={`ce-chip${open === `${s.mpt}:${s.e}` ? ' ce-on' : ''}`} onClick={() => setOpen(open === `${s.mpt}:${s.e}` ? null : `${s.mpt}:${s.e}`)}>
                        {s.label}: {s.picked.length}
                        {s.excluded.length ? ` (−${s.excluded.length})` : ''}
                      </button>
                    ))}
                  </div>
                ) : (
                  '—'
                )}
              </dd>
            </dl>
            {sel ? (
              <div className="ce-list">
                <b>{sel.label}</b>
                <ul>
                  {sel.picked.slice(0, 300).map((p) => (
                    <li key={p.id}>{p.name}</li>
                  ))}
                  {sel.excluded.slice(0, 100).map((p) => (
                    <li key={`x${p.id}`} className="ce-bad">
                      not {p.name}
                    </li>
                  ))}
                </ul>
                {sel.picked.length > 300 ? <p className="ce-muted">and {n(sel.picked.length - 300)} more</p> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ entitlements

type MagnifierReport = {
  id: string
  name: string
  kind: string | null
  detail: {
    schema: string | null
    country: string | null
    description: string | null
    rel: { id: string | null; name: string | null; end: string | null; readable?: ReadableRel }
    defaultRel: { id: string | null; name: string | null; readable?: ReadableRel }
  }
}

interface AccountDetail {
  key: string
  platform: Platform
  accountId: string
  name: string
  company: string | null
  active: boolean
  users: number
  activeUsers: number
  reports: number
  summary: string | null
  entitlements: Entitlements
  info: Record<string, unknown>
  magnifierReports: MagnifierReport[]
}

function AccountPopup({ k, onClose }: { k: string; onClose: () => void }) {
  const [a, setA] = useState<AccountDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    get<AccountDetail>({ op: 'account', key: k }).then(setA, (e) => setError((e as Error).message))
  }, [k])
  return (
    <Modal title={a ? `${a.name} · ${PLATFORM_LABEL[a.platform]}` : 'Entitlements'} onClose={onClose}>
      <div className="ce-pop">
        {error ? <p className="mr-said mr-bad">{error}</p> : null}
        {a ? (
          <>
            <p className="ce-muted">
              Account {a.accountId}
              {a.company ? ` · 360 company ${a.company}` : ''} · {a.active ? 'active' : 'inactive'} · {n(a.activeUsers)} of {n(a.users)} users active
            </p>
            {a.entitlements.kind === '360' ? <Ent360View e={a.entitlements} /> : null}
            {a.entitlements.kind === 'classic' ? <EntClassicView e={a.entitlements} /> : null}
            {a.entitlements.kind === 'magnifier' ? <EntMagnifierView e={a.entitlements} reports={a.magnifierReports} /> : null}
          </>
        ) : !error ? (
          <p className="ce-muted">Loading…</p>
        ) : null}
      </div>
    </Modal>
  )
}

function MediaChips({ media }: { media: string[] }) {
  return (
    <div className="ce-media">
      {media.map((m) => (
        <span key={m}>{m}</span>
      ))}
    </div>
  )
}

/** Names as chips: all of them when there are few, the first ones and a "show all" when there are many. */
function Names({ items, out = false, total }: { items: string[]; out?: boolean; total?: number }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, 24)
  const more = (total ?? items.length) - shown.length
  return (
    <div className="ce-names">
      {shown.map((x) => (
        <span key={x} className={`ce-name-chip${out ? ' ce-out' : ''}`}>
          {x}
        </span>
      ))}
      {more > 0 ? (
        all || shown.length >= items.length ? (
          <span className="ce-muted">and {n(more)} more</span>
        ) : (
          <button type="button" className="ce-link" onClick={() => setAll(true)}>
            show all {n(total ?? items.length)}
          </button>
        )
      ) : null}
    </div>
  )
}

function Ent360View({ e }: { e: Ent360 }) {
  return (
    <>
      <dl className="ce-dl">
        <dt>Media</dt>
        <dd>
          {!e.media ? (
            'All media'
          ) : e.media.include.length ? (
            <MediaChips media={e.media.include} />
          ) : (
            <>
              All but <MediaChips media={e.media.exclude} />
            </>
          )}
        </dd>
        <dt>Application</dt>
        <dd>{e.application}</dd>
        <dt>History</dt>
        <dd>{e.years ? `${e.years} years` : '—'}</dd>
        {e.filters.map((f) => (
          <Fragment key={f.type}>
            <dt>{f.type}</dt>
            <dd>
              <Names items={f.include} total={f.count - f.exclude.length} />
              {f.exclude.length ? (
                <>
                  <span className="ce-muted">Not:</span> <Names items={f.exclude} out />
                </>
              ) : null}
            </dd>
          </Fragment>
        ))}
      </dl>
      {!e.filters.length ? <p className="ce-muted">No advertiser, category or property restrictions.</p> : null}
      <details className="ce-filter">
        <summary>
          <b>Features</b> <span className="ce-muted">{n(e.features.length)}</span>
        </summary>
        <p>{e.features.length ? e.features.join(', ') : 'None'}</p>
      </details>
    </>
  )
}

function EntClassicView({ e }: { e: EntClassic }) {
  return (
    <>
      <dl className="ce-dl">
        {e.media.length ? (
          <>
            <dt>Media</dt>
            <dd>
              <MediaChips media={e.media} />
            </dd>
          </>
        ) : null}
        <dt>Account type</dt>
        <dd>
          {e.accountType}
          {e.subAccountType ? ` · ${e.subAccountType}` : ''}
        </dd>
        <dt>Side</dt>
        <dd>{e.side ?? '—'}</dd>
        <dt>Expires</dt>
        <dd>{e.expires ?? '—'}</dd>
        <dt>Owned properties</dt>
        <dd>{e.owned.length ? e.owned.map((o) => `${o.format} ${n(o.count)}`).join(', ') : 'None'}</dd>
        <dt>Extra access</dt>
        <dd>{e.extra.length ? e.extra.map((x) => `${x.what}: ${n(x.items)} (${n(x.users)} users)`).join(' · ') : 'None'}</dd>
      </dl>
      <details className="ce-filter">
        <summary>
          <b>Features</b> <span className="ce-muted">{n(e.features.length)}</span>
        </summary>
        <p>{e.features.length ? e.features.join(', ') : 'None'}</p>
      </details>
      <p className="ce-muted">Classic has no category or product restrictions: media only. A publisher&apos;s media follow the properties it owns.</p>
    </>
  )
}

function EntMagnifierView({ e, reports }: { e: EntMagnifier; reports: MagnifierReport[] }) {
  return (
    <>
      <dl className="ce-dl">
        <dt>Media</dt>
        <dd>{e.media.length ? <MediaChips media={e.media} /> : e.reports ? 'Not restricted by media' : '—'}</dd>
        <dt>Countries</dt>
        <dd>{e.countries.length ? e.countries.join(', ') : '—'}</dd>
        {e.access.map((x) => (
          <Fragment key={x.label}>
            <dt>{x.label}</dt>
            <dd>
              <Names items={x.items} total={x.total} />
            </dd>
          </Fragment>
        ))}
        <dt>Contract</dt>
        <dd>{e.contract.start || e.contract.end ? `${e.contract.start ?? '…'} to ${e.contract.end ?? '…'}` : '—'}</dd>
      </dl>
      {e.namesNote ? <p className="ce-muted">{e.namesNote}</p> : null}
      <details className="ce-filter">
        <summary>
          <b>Features</b> <span className="ce-muted">{n(e.flags.length)}</span>
        </summary>
        <p>{e.flags.length ? e.flags.join(', ') : 'None'}</p>
      </details>
      <h3 className="ce-h3">Reports</h3>
      <MagnifierReportList reports={reports} />
    </>
  )
}

function MagnifierReportList({ reports }: { reports: MagnifierReport[] }) {
  const [open, setOpen] = useState<string | null>(reports.length === 1 ? reports[0]!.id : null)
  if (!reports.length) return <p className="ce-muted">No reports set up.</p>
  return (
    <div className="ce-filters">
      {reports.map((r) => {
        const rel = r.detail.rel.readable
        return (
          <div key={r.id} className="ce-report">
            <div>
              <button type="button" className="ce-link" onClick={() => setOpen(open === r.id ? null : r.id)}>
                {open === r.id ? '▾' : '▸'} {r.name}
              </button>{' '}
              <span className="ce-muted">
                {[r.kind, r.detail.country].filter(Boolean).join(' · ')}
                {rel?.media.length ? ` · ${rel.media.join(', ')}` : ''}
              </span>
            </div>
            {open === r.id ? <RelView rel={rel} name={r.detail.rel.name} end={r.detail.rel.end} description={r.detail.description} /> : null}
          </div>
        )
      })}
    </div>
  )
}

function RelView({ rel, name, end, description }: { rel?: ReadableRel; name: string | null; end: string | null; description: string | null }) {
  if (!rel) return <p className="ce-muted">This report was loaded before RELs were read into names. Refresh Magnifier to see it.</p>
  return (
    <dl className="ce-dl">
      {description ? (
        <>
          <dt>About</dt>
          <dd>{description}</dd>
        </>
      ) : null}
      <dt>Media</dt>
      <dd>{rel.media.length ? <MediaChips media={rel.media} /> : 'Not restricted by media'}</dd>
      {rel.rows.map((row) => (
        <Fragment key={row.label}>
          <dt>{row.label}</dt>
          <dd>
            {row.items.length ? <Names items={row.items} total={row.total - row.excluded.length} /> : null}
            {row.excluded.length ? (
              <>
                <span className="ce-muted">Not:</span> <Names items={row.excluded} out />
              </>
            ) : null}
          </dd>
        </Fragment>
      ))}
      {rel.dates.length ? (
        <>
          <dt>Dates</dt>
          <dd>{rel.dates.join(' · ')}</dd>
        </>
      ) : null}
      {!rel.rows.length ? (
        <>
          <dt>Restrictions</dt>
          <dd>None beyond media and dates</dd>
        </>
      ) : null}
      <dt>Criteria</dt>
      <dd className="ce-muted">
        {name ?? '—'}
        {end ? ` · ends ${end}` : ''}
      </dd>
    </dl>
  )
}

function MagnifierReportsPopup({ k, who, onClose }: { k: string; who: string; onClose: () => void }) {
  const [a, setA] = useState<AccountDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    get<AccountDetail>({ op: 'account', key: k }).then(setA, (e) => setError((e as Error).message))
  }, [k])
  return (
    <Modal title={`Magnifier reports for ${who}`} onClose={onClose}>
      <div className="ce-pop">
        <p className="ce-muted">Magnifier sets reports up for the account, so everyone on it shares these.</p>
        {error ? <p className="mr-said mr-bad">{error}</p> : null}
        {a ? <MagnifierReportList reports={a.magnifierReports} /> : !error ? <p className="ce-muted">Loading…</p> : null}
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ Magnifier saved searches

interface SearchView {
  id: string
  title: string
  report: string | null
  country: string | null
  period: string | null
  keyword: string | null
  shared: boolean
  saved: string | null
  updated: string | null
  rel: ReadableRel
}

function SearchesPopup({ user, account, who, onClose }: { user: string; account: string; who: string; onClose: () => void }) {
  const [data, setData] = useState<{ searches: SearchView[]; namesNote: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    get<{ searches: SearchView[]; namesNote: string | null }>({ op: 'searches', user: user.trim(), accounts: account.trim() }).then(
      (r) => {
        setData(r)
        if (r.searches.length === 1) setOpen(r.searches[0]!.id)
      },
      (e) => setError((e as Error).message),
    )
  }, [user, account])
  return (
    <Modal title={`${who}'s Magnifier saved searches`} onClose={onClose}>
      <div className="ce-pop">
        <span className="ce-count">{data ? `${n(data.searches.length)} saved or updated in 2026, read live from Magnifier` : 'Reading Magnifier…'}</span>
        {error ? <p className="mr-said mr-bad">{error}</p> : null}
        {data?.namesNote ? <p className="ce-muted">{data.namesNote}</p> : null}
        <div className="ce-filters">
          {(data?.searches ?? []).map((s) => (
            <div key={s.id} className="ce-report">
              <div>
                <button type="button" className="ce-link" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  {open === s.id ? '▾' : '▸'} {s.title}
                </button>{' '}
                {s.shared ? <span className="ce-name-chip">Shared</span> : null}{' '}
                <span className="ce-muted">
                  {[s.country, s.period, `updated ${s.updated ?? s.saved ?? '—'}`].filter(Boolean).join(' · ')}
                  {s.rel.media.length ? ` · ${s.rel.media.join(', ')}` : ''}
                </span>
              </div>
              {open === s.id ? (
                <dl className="ce-dl">
                  {s.keyword ? (
                    <>
                      <dt>Keywords</dt>
                      <dd>{s.keyword}</dd>
                    </>
                  ) : null}
                  <dt>Media</dt>
                  <dd>{s.rel.media.length ? <MediaChips media={s.rel.media} /> : 'Not restricted by media'}</dd>
                  {s.rel.rows.map((row) => (
                    <Fragment key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>
                        {row.items.length ? <Names items={row.items} total={row.total - row.excluded.length} /> : null}
                        {row.excluded.length ? (
                          <>
                            <span className="ce-muted">Not:</span> <Names items={row.excluded} out />
                          </>
                        ) : null}
                      </dd>
                    </Fragment>
                  ))}
                  <dt>Period</dt>
                  <dd>{s.period ?? '—'}</dd>
                  <dt>Report</dt>
                  <dd className="ce-muted">
                    {s.report ?? '—'} · saved {s.saved ?? '—'}
                  </dd>
                </dl>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ merging by hand

function MergePopup({ client, onClose, onMerged }: { client: ClientRow; onClose: () => void; onMerged: () => void }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<ClientRow[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (q.trim().length < 2) return
    const t = setTimeout(() => {
      get<{ rows: ClientRow[] }>({ op: 'clients', q, platform: 'all', sort: 'name', active: '0', internal: '1' }).then(
        (r) => setFound(r.rows.filter((x) => x.id !== client.id).slice(0, 20)),
        (e) => setError((e as Error).message),
      )
    }, 250)
    return () => clearTimeout(t)
  }, [q, client.id])
  async function merge(target: ClientRow) {
    try {
      await post({ op: 'merge', member: client.members[0]!.key, withMember: target.members[0]!.key })
      onMerged()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <Modal title={`Merge ${client.name} with…`} onClose={onClose}>
      <div className="ce-pop">
        <p className="ce-muted">The merge is kept through refreshes. Split an account out again from the client&apos;s row.</p>
        <input id="ce-merge-q" className="ce-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find the other client" aria-label="Find the other client" autoFocus />
        {error ? <p className="mr-said mr-bad">{error}</p> : null}
        <div className="ce-merge-list">
          {(q.trim().length < 2 ? [] : found).map((c) => (
            <button key={c.id} type="button" className="ce-merge-pick" onClick={() => void merge(c)}>
              <b>{c.name}</b>
              <span className="ce-badges">
                {c.platforms.map((p) => (
                  <Badge key={p} p={p} />
                ))}
              </span>
              <span className="ce-muted">{c.members.map((m) => m.name).slice(0, 3).join(' · ')}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
