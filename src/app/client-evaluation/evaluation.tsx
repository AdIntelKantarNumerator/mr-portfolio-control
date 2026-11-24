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
import type { UsageClient } from '@/lib/client-eval/ratings-usage'
import type { InactiveAccount } from '@/lib/client-eval/inactive'
import { ACCOUNT_TYPE_LABEL, ENTITY_TYPE, SET_LABEL } from '@/lib/client-eval/migration/catalog'
import type { MigrationPlan } from '@/lib/client-eval/migration/types'
import { csvField } from '@/lib/client-eval/csv'
import type { ClientRow, PersonRow, SourceInfo } from '@/lib/client-eval/store'
import { memberKey, PLATFORM_LABEL, PLATFORMS, SNAPSHOT_ONLY, type Ent360, type EntClassic, type EntMagnifier, type Entitlements, type Platform } from '@/lib/client-eval/types'

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
                  <a className="ce-csv" href={`/client-evaluation/users?platform=${s.platform}`} download title={`Every active ${PLATFORM_LABEL[s.platform]} user: name, email, account, username, created, last login (CSV)`}>
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
  | { kind: 'ratings' }
  | { kind: 'inactive' }
  | { kind: 'plan'; client: ClientRow }

export function ClientEvaluation({ contact }: { contact: string }) {
  const [q, setQ] = useState('')
  const [platform, setPlatform] = useState('all')
  const [sort, setSort] = useState('reports')
  const [active, setActive] = useState(true)
  const [internal, setInternal] = useState(false)
  // Canada is left out of the analysis unless asked for (Scott, 24 November 2026).
  const [noCanada, setNoCanada] = useState(true)
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

  const params = useMemo(() => ({ op: 'clients', q, platform, sort, active: active ? '1' : '0', internal: internal ? '1' : '0', canada: noCanada ? '0' : '1' }), [q, platform, sort, active, internal, noCanada])
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
        <label className="ce-tick" title="Leave out clients whose accounts are all Canadian (Magnifier's Canadian data, 360 limited to Canadian media)">
          <input id="ce-no-canada" type="checkbox" checked={noCanada} onChange={(e) => setNoCanada(e.target.checked)} /> Exclude Canada
        </label>
        <label className="ce-tick">
          <input id="ce-internal" type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Show internal
        </label>
        <button type="button" className="btn ce-sm" onClick={() => push({ kind: 'ratings' })} title="360 reports run with VideoAmp ratings, by client and user, for the months you pick">
          Ratings Usage
        </button>
        <button type="button" className="btn ce-sm" onClick={() => push({ kind: 'inactive' })} title="Active accounts where nobody has logged in since the date you pick">
          No Recent Logins
        </button>
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
                    <button type="button" className="btn ce-sm ce-deck-btn" onClick={() => push({ kind: 'plan', client: c })} title="What this client becomes in Insights Studio: accounts, entitlements, users, workspaces and impact">
                      Migration Plan
                    </button>
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
                              <button type="button" className="btn ce-sm" onClick={() => openDeck({ kind: 'account', key: m.key }, m.name)} title="Build a PowerPoint of what changes for this account in Insights Studio">
                                Impact deck
                              </button>
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
      {top?.kind === 'ratings' ? <RatingsUsagePopup onClose={pop} /> : null}
      {top?.kind === 'plan' ? <MigrationPlanPopup client={top.client} onClose={pop} /> : null}
      {top?.kind === 'inactive' ? <InactivePopup onClose={pop} onAccount={(key) => push({ kind: 'account', key })} /> : null}
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

// ------------------------------------------------------------------ Ratings Usage

interface UsageData {
  months: string[]
  reports: number
  users: number
  clients: UsageClient[]
}

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

/** 360 reports run with VideoAmp ratings in a span of months, by client, then user (Scott, 23 November 2026). Read live. */
function RatingsUsagePopup({ onClose }: { onClose: () => void }) {
  const [months, setMonths] = useState<string[]>([])
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [data, setData] = useState<UsageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [internal, setInternal] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const pick = (set: (m: string) => void, m: string) => {
    setBusy(true)
    setError(null)
    set(m)
  }
  useEffect(() => {
    get<UsageData>({ op: 'ratings', ...(from ? { from } : {}), ...(to ? { to } : {}) }).then(
      (r) => {
        setData(r)
        setMonths(r.months)
        if (!from) setFrom(r.months[0] ?? null)
        if (!to) setTo(r.months[r.months.length - 1] ?? null)
        setBusy(false)
      },
      (e) => {
        setError((e as Error).message)
        setBusy(false)
      },
    )
    // from and to start empty: the first read fills them in, and then is not repeated for that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from && to ? `${from}|${to}` : ''])
  const shown = (data?.clients ?? []).filter((c) => internal || !c.internal)
  const total = shown.reduce((s, c) => s + c.reports, 0)
  const people = new Set(shown.flatMap((c) => c.users.map((u) => u.usrId))).size
  const key = (c: UsageClient) => c.id ?? c.name
  function exportCsv() {
    const head = ['Client', 'Account', 'Application', 'User', 'Email', 'Username', 'VideoAmp reports', 'Last run']
    const lines = [head.join(',')]
    for (const c of shown) for (const u of c.users) lines.push([c.name, u.account, u.app, u.name, u.email, u.login, String(u.reports), u.last].map(csvField).join(','))
    const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `VideoAmp ratings usage ${from}${to !== from ? ` to ${to}` : ''}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  return (
    <Modal title="Ratings Usage: VideoAmp" onClose={onClose}>
      <div className="ce-pop">
        <div className="ce-controls">
          <label className="ce-tick">
            From
            <select id="ce-ru-from" value={from ?? ''} onChange={(e) => pick(setFrom, e.target.value)} disabled={!months.length}>
              {months.map((m) => (
                <option key={m} value={m} disabled={!!to && m > to}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="ce-tick">
            To
            <select id="ce-ru-to" value={to ?? ''} onChange={(e) => pick(setTo, e.target.value)} disabled={!months.length}>
              {months.map((m) => (
                <option key={m} value={m} disabled={!!from && m < from}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="ce-tick">
            <input id="ce-ru-internal" type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Show internal
          </label>
          <span className="ce-count">{busy ? 'Reading 360…' : `${n(total)} reports · ${n(shown.length)} clients · ${n(people)} users`}</span>
          <button type="button" className="btn btn-primary ce-sm" disabled={busy || !shown.length} onClick={exportCsv}>
            Export
          </button>
        </div>
        <p className="ce-muted ce-sm">360 reports run with VideoAmp ratings. 360 records the ratings provider from October 2026.</p>
        {error ? <p className="mr-said mr-bad">{error}</p> : null}
        <div className="ce-table ce-scroll">
          <table className="dtable">
            <thead>
              <tr>
                <th>Client</th>
                <th>Users</th>
                <th>VideoAmp reports</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const isOpen = open.has(key(c))
                return (
                  <Fragment key={key(c)}>
                    <tr className={isOpen ? 'ce-open' : undefined}>
                      <td>
                        <button
                          type="button"
                          className="ce-name"
                          aria-expanded={isOpen}
                          onClick={() =>
                            setOpen((s) => {
                              const next = new Set(s)
                              if (next.has(key(c))) next.delete(key(c))
                              else next.add(key(c))
                              return next
                            })
                          }
                        >
                          <span className="ce-caret">{isOpen ? '▾' : '▸'}</span>
                          <b>{c.name}</b>
                        </button>
                        {c.internal ? <span className="ce-muted"> · internal</span> : null}
                      </td>
                      <td>{n(c.users.length)}</td>
                      <td>
                        <b>{n(c.reports)}</b>
                      </td>
                    </tr>
                    {isOpen
                      ? c.users.map((u) => (
                          <tr key={`${u.app}:${u.usrId}`} className="ce-subrow">
                            <td>
                              <div className="ce-indent">
                                {u.name}
                                <div className="ce-sub">
                                  {u.email ?? u.login ?? ''} · {u.account} · {u.app}
                                </div>
                              </div>
                            </td>
                            <td className="ce-date">Last {u.last}</td>
                            <td>{n(u.reports)}</td>
                          </tr>
                        ))
                      : null}
                  </Fragment>
                )
              })}
              {!busy && !shown.length && !error ? (
                <tr>
                  <td colSpan={3} className="ce-muted">
                    No VideoAmp reports in these months.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ Migration Plan

interface PlanResponse {
  status: 'none' | 'queued' | 'building' | 'ready' | 'failed'
  depth: 'full' | 'light' | null
  plan: MigrationPlan | null
  builtAt: string | null
  step: string | null
  error: string | null
  ahead: number | null
  admin: boolean
  planner: { running: boolean; total: number; ready: number; full: number; queued: number; building: string | null; failed: number } | null
}

const PLAN_TABS = ['Summary', 'Accounts', 'Users', 'Workspaces', 'Saved views', 'Impact', 'Checklist'] as const
type PlanTab = (typeof PLAN_TABS)[number]
const VERDICT: Record<MigrationPlan['review']['verdict'], { label: string; cls: string }> = {
  ok: { label: 'Looks right', cls: 'ce-ok' },
  check: { label: 'Points to check', cls: 'ce-warn' },
  problem: { label: 'Problems to resolve', cls: 'ce-bad' },
}

/** A client's Migration Plan to Insights Studio (Scott, 23 November 2026). */
/** What the media chips' colours mean. Each kind shows only where the list has it. */
function MediaKey({ premium, withheld, lost }: { premium?: boolean; withheld?: boolean; lost?: boolean }) {
  return (
    <div className="ce-key ce-sm ce-muted" aria-label="Key">
      <span className="ce-name-chip">Has today, keeps</span>
      {premium ? <span className="ce-name-chip ce-m-premium">Premium, has today, keeps</span> : null}
      <span className="ce-name-chip ce-m-added">Added</span>
      {lost ? <span className="ce-name-chip ce-out">Loses</span> : null}
      {withheld ? <span className="ce-name-chip ce-withheld">Premium, not included</span> : null}
    </div>
  )
}

function MigrationPlanPopup({ client, onClose }: { client: ClientRow; onClose: () => void }) {
  const [view, setView] = useState<PlanResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<PlanTab>('Summary')
  const [tick, setTick] = useState(0)
  const asked = useRef(false)
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | null = null
    get<PlanResponse>({ op: 'plan', client: client.id }).then(
      async (r) => {
        if (!live) return
        setView(r)
        // No plan yet, or a light one: ask for it in full, once. A failed one only on request: it may have stopped the server.
        if (!asked.current && (r.status === 'none' || (r.status === 'ready' && r.depth === 'light'))) {
          asked.current = true
          try {
            await post({ op: 'plan', client: client.id })
          } catch (e) {
            setError((e as Error).message)
          }
          timer = setTimeout(() => setTick((t) => t + 1), 1500)
          return
        }
        if (r.status === 'queued' || r.status === 'building') timer = setTimeout(() => setTick((t) => t + 1), 3000)
      },
      (e) => live && setError((e as Error).message),
    )
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
  }, [client.id, tick])

  async function rebuild() {
    try {
      await post({ op: 'plan', client: client.id })
      setTick((t) => t + 1)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function refreshAll() {
    if (!window.confirm('Rebuild every Migration Plan in the background? Plans stay readable until each is rebuilt.')) return
    try {
      await post({ op: 'plans-refresh' })
      setTick((t) => t + 1)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const plan = view?.plan ?? null
  const working = view?.status === 'queued' || view?.status === 'building' || view?.status === 'none'
  const accountName = new Map((plan?.accounts ?? []).map((a) => [a.key, a.name]))
  const userName = new Map((plan?.users ?? []).map((u) => [u.key, u.name]))
  const created = (plan?.users ?? []).filter((u) => u.create.value)

  return (
    <Modal title={`Migration Plan: ${client.name}`} onClose={onClose}>
      <div className="ce-pop ce-plan">
        <div className="ce-controls">
          {plan ? (
            <span className={`ce-verdict ${VERDICT[plan.review.verdict].cls}`}>{VERDICT[plan.review.verdict].label}</span>
          ) : null}
          <span className="ce-muted ce-sm">
            {working
              ? view?.status === 'building'
                ? `Building: ${view.step ?? 'starting'}…`
                : `Queued${view?.ahead ? ` (${n(view.ahead)} ahead)` : ''}…`
              : view?.status === 'failed'
                ? 'The last build failed.'
                : view?.builtAt
                  ? `Built ${when(view.builtAt)}${view.depth === 'light' ? ' · light' : ''}`
                  : ''}
          </span>
          <span className="ce-count" />
          <button type="button" className="btn ce-sm" disabled={!plan} onClick={() => openDeck({ kind: 'client', clientId: client.id }, client.name)} title="The Impact Deck, leading with the advertisers this plan found">
            Impact Deck ↓
          </button>
          <a className={`btn btn-primary ce-sm${plan ? '' : ' ce-disabled'}`} href={plan ? `/client-evaluation/api?op=plan-doc&client=${encodeURIComponent(client.id)}` : undefined} download aria-disabled={!plan} title="The plan as a Word document">
            Migration Plan ↓
          </a>
          {view?.admin || view?.status === 'failed' ? (
            <button type="button" className="btn ce-sm" disabled={working} onClick={() => void rebuild()} title={view?.status === 'failed' ? 'Build this plan again' : "Admins: rebuild this client's plan now"}>
              {view?.status === 'failed' ? 'Try again' : 'Rebuild'}
            </button>
          ) : null}
        </div>
        {view?.admin && view.planner ? (
          <div className="ce-planner ce-sm ce-muted">
            Planner {view.planner.running ? 'running' : 'stopped'}: {n(view.planner.ready)} of {n(view.planner.total)} plans built ({n(view.planner.full)} full) · {n(view.planner.queued)} queued
            {view.planner.failed ? ` · ${n(view.planner.failed)} failed` : ''}
            {view.planner.building ? ` · now: ${view.planner.building}` : ''}
            <button type="button" className="ce-link" onClick={() => void refreshAll()}>
              Refresh all plans
            </button>
          </div>
        ) : null}
        {error ? <p className="mr-said mr-bad">{error}</p> : null}
        {view?.status === 'failed' && view.error ? <p className="mr-said mr-bad">{view.error}</p> : null}
        {!plan ? (
          <p className="ce-muted">{!view && !error ? 'Loading the plan…' : working ? 'Building the plan: a minute or two. You can close this and come back.' : 'No plan yet.'}</p>
        ) : (
          <>
            <div className="ce-seg" role="tablist" aria-label="Plan">
              {PLAN_TABS.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'ce-on' : undefined} onClick={() => setTab(t)}>
                  {t}
                  {t === 'Users' ? <span className="ce-muted"> {n(created.length)}</span> : null}
                  {t === 'Workspaces' ? <span className="ce-muted"> {n(plan.workspaces.length)}</span> : null}
                  {t === 'Saved views' ? <span className="ce-muted"> {n(plan.savedViews?.length ?? 0)}</span> : null}
                  {t === 'Accounts' ? <span className="ce-muted"> {n(plan.accounts.length)}</span> : null}
                </button>
              ))}
            </div>
            <div className="ce-scroll ce-plan-body">
              {tab === 'Summary' ? (
                <>
                  <div className="ce-plan-stats">
                    <div>
                      <b>{n(plan.accounts.length)}</b>
                      <span>Insights Studio {plan.accounts.length === 1 ? 'account' : 'accounts'}</span>
                    </div>
                    <div>
                      <b>{n(created.length)}</b>
                      <span>users to create</span>
                    </div>
                    <div>
                      <b>{n(plan.workspaces.length)}</b>
                      <span>workspaces</span>
                    </div>
                    <div>
                      <b>{n(plan.accounts[0]?.coverage.media.filter((m) => m.status === 'added').length ?? 0)}</b>
                      <span>media added</span>
                    </div>
                  </div>
                  <ul className="ce-plan-list">
                    {plan.summary.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                  {plan.review.issues.length ? (
                    <>
                      <h4>Review</h4>
                      <ul className="ce-plan-list">
                        {plan.review.issues.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  <p className="ce-muted ce-sm">
                    Organization: <b>{plan.organization.name}</b>. {plan.organization.why}
                  </p>
                </>
              ) : null}

              {tab === 'Accounts'
                ? plan.accounts.map((a) => (
                    <div key={a.key} className="ce-report">
                      <div>
                        <b>{a.name}</b> <span className="ce-badge ce-360">{ACCOUNT_TYPE_LABEL[a.type.value]}</span> <span className="ce-muted ce-sm">{n(a.seats)} users</span>
                      </div>
                      <div className="ce-muted ce-sm">{a.why}</div>
                      <dl className="ce-dl">
                        <dt>Replaces</dt>
                        <dd>{a.from.map((f) => `${PLATFORM_LABEL[f.platform]}: ${f.name}`).join(' · ')}</dd>
                        <dt>Packages</dt>
                        <dd>
                          {a.packages.map((p) => (
                            <div key={p.key}>
                              <b>{p.name}</b>
                              {p.kind === 'add_on' ? <span className="ce-muted"> (add-on)</span> : null} <span className="ce-muted ce-sm">{p.why}</span>
                            </div>
                          ))}
                        </dd>
                        <dt>History</dt>
                        <dd>
                          {a.contract.lookbackYears.value} years <span className="ce-muted ce-sm">{a.contract.lookbackYears.why}</span>
                        </dd>
                        <dt>Preliminary</dt>
                        <dd>
                          {a.contract.includePreliminary.value ? 'Yes' : 'No'} <span className="ce-muted ce-sm">{a.contract.includePreliminary.why}</span>
                        </dd>
                        <dt>Countries</dt>
                        <dd>{a.coverage.countries.map((c) => c.name).join(', ')}</dd>
                        <dt>Media</dt>
                        <dd>
                          <MediaKey withheld={a.coverage.withheld.length > 0} premium={a.coverage.media.some((m) => m.status === 'premium')} />
                          <div className="ce-names">
                            {a.coverage.media.map((m) => (
                              <span key={m.id} className={`ce-name-chip ce-m-${m.status}`} title={m.status === 'added' ? 'New to them' : m.status === 'premium' ? 'Premium, kept: they have it today' : 'They have it today'}>
                                {m.name}
                              </span>
                            ))}
                            {a.coverage.withheld.map((w) => (
                              <span key={w.name} className="ce-name-chip ce-withheld" title={w.why}>
                                {w.name}
                              </span>
                            ))}
                          </div>
                        </dd>
                        {a.coverage.widened.length ? (
                          <>
                            <dt>Lifted</dt>
                            <dd className="ce-sm">
                              {a.coverage.widened.slice(0, 8).map((w, i) => (
                                <div key={i}>{w}</div>
                              ))}
                              {a.coverage.widened.length > 8 ? <div className="ce-muted">and {a.coverage.widened.length - 8} more</div> : null}
                            </dd>
                          </>
                        ) : null}
                      </dl>
                    </div>
                  ))
                : null}

              {tab === 'Users' ? (
                <div className="ce-table">
                  <table className="dtable">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Account</th>
                        <th>Last login</th>
                        <th>Create</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.users.slice(0, 500).map((u) => (
                        <tr key={u.key} className={u.create.value ? undefined : 'ce-inactive'}>
                          <td>
                            <b>{u.name}</b>
                            <div className="ce-sub">
                              {u.email ?? ''} · {[...new Set(u.logins.map((l) => PLATFORM_LABEL[l.platform]))].join(', ')}
                            </div>
                          </td>
                          <td>{accountName.get(u.account ?? '') ?? '—'}</td>
                          <td className="ce-date">{u.lastSeen ?? <span className="ce-muted">None on record</span>}</td>
                          <td title={u.create.why}>{u.create.value ? <b>Yes</b> : <span className="ce-muted">No: {u.create.why}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {plan.users.length > 500 ? <p className="ce-muted ce-sm">Showing 500 of {n(plan.users.length)}. The Word document has them all.</p> : null}
                </div>
              ) : null}

              {tab === 'Workspaces' ? (
                plan.workspaces.length ? (
                  plan.workspaces.map((w) => (
                    <div key={w.key} className="ce-report">
                      <div>
                        <b>{w.name}</b> <span className="ce-muted ce-sm">· {accountName.get(w.account)} · {w.source}</span>
                      </div>
                      <div className="ce-muted ce-sm">
                        For {w.users.slice(0, 6).map((k) => userName.get(k) ?? k).join(', ')}
                        {w.users.length > 6 ? ` and ${w.users.length - 6} more` : ''}
                      </div>
                      {w.sets.map((s) => (
                        <div key={s.set}>
                          <span className="ce-sm">
                            <b>{SET_LABEL[s.set]}</b> <span className="ce-muted">{n(s.items.length + s.more)} · {n(s.items.filter((i) => i.gpc).length)} matched{s.items.some((i) => i.gpc?.guess) ? ` (${n(s.items.filter((i) => i.gpc?.guess).length)} best guess)` : ''}</span>
                          </span>
                          <div className="ce-names">
                            {s.items.slice(0, 24).map((i) => (
                              <span key={`${i.entityType}:${i.legacy.id}`} className={`ce-name-chip${i.gpc ? (i.gpc.guess ? ' ce-guess' : '') : ' ce-unmatched'}`} title={`${ENTITY_TYPE[i.entityType] ?? i.entityType} · from ${PLATFORM_LABEL[i.legacy.platform]} ${i.legacy.list}${i.gpc ? ` · Insights Studio: ${i.gpc.name} #${i.gpc.id} · ${i.gpc.how}` : ' · not matched yet'}`}>
                                {i.gpc?.name ?? i.name}
                                {i.gpc?.guess ? ' ?' : ''}
                              </span>
                            ))}
                            {s.items.length + s.more > 24 ? <span className="ce-muted ce-sm">+{n(s.items.length + s.more - 24)}</span> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  <p className="ce-muted">No workspaces: none of the users have lists or restrictions to keep.</p>
                )
              ) : null}

              {tab === 'Saved views' ? (
                plan.savedViews?.length ? (
                  <>
                    <p className="ce-muted ce-sm">Magnifier saved searches saved or updated in 2026, to recreate as Insights Studio saved views.</p>
                    {plan.savedViews.slice(0, 300).map((v) => (
                      <div key={v.key} className="ce-report">
                        <div>
                          <b>{v.title}</b> <span className="ce-muted ce-sm">· {userName.get(v.user) ?? v.user}{v.updated ? ` · updated ${v.updated}` : ''}{v.shared ? ' · shared' : ''}</span>
                        </div>
                        <div className="ce-muted ce-sm">{[v.period, v.keyword ? `keyword "${v.keyword}"` : null, v.media.length ? v.media.join(', ') : null].filter(Boolean).join(' · ') || 'No filters'}</div>
                        {v.filters.map((f) => (
                          <div key={f.label} className="ce-sm">
                            <b>{f.label}</b> <span className="ce-muted">{f.items.slice(0, 8).join(', ')}{f.total > 8 ? ` +${n(f.total - 8)}` : ''}{f.excluded.length ? ` · not ${f.excluded.slice(0, 4).join(', ')}` : ''}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                    {plan.savedViews.length > 300 ? <p className="ce-muted ce-sm">Showing 300 of {n(plan.savedViews.length)}. The Word document has them all.</p> : null}
                  </>
                ) : (
                  <p className="ce-muted">{plan.savedViews ? 'No Magnifier saved searches from 2026 for the users created.' : 'Rebuild the plan to see saved searches.'}</p>
                )
              ) : null}

              {tab === 'Impact' ? (
                <>
                  {plan.impact.gains.length ? (
                    <>
                      <h4>Gains</h4>
                      <ul className="ce-plan-list">
                        {plan.impact.gains.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {plan.impact.losses.length ? (
                    <>
                      <h4>Losses</h4>
                      <ul className="ce-plan-list">
                        {plan.impact.losses.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {plan.impact.notInV1.length ? (
                    <>
                      <h4>Not in Insights Studio V1</h4>
                      <ul className="ce-plan-list">
                        {plan.impact.notInV1.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  <h4>Media by platform</h4>
                  <MediaKey lost={plan.impact.media.some((m) => m.change.dropped.length > 0)} />
                  {plan.impact.media.map((m) => (
                    <div key={m.platform} className="ce-report">
                      <b>{PLATFORM_LABEL[m.platform]}</b>
                      <div className="ce-names">
                        {m.change.kept.map((x) => (
                          <span key={x} className="ce-name-chip ce-m-kept">
                            {x}
                          </span>
                        ))}
                        {m.change.dropped.map((x) => (
                          <span key={x} className="ce-name-chip ce-out" title="Not in Insights Studio yet">
                            {x}
                          </span>
                        ))}
                        {m.change.added.map((x) => (
                          <span key={x} className="ce-name-chip ce-m-added" title="New to them">
                            {x}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              ) : null}

              {tab === 'Checklist' ? (
                <ul className="ce-plan-list">
                  {plan.checklist.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                  {plan.notes.map((s, i) => (
                    <li key={`n${i}`} className="ce-muted">
                      {s}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ No Recent Logins

interface InactiveData {
  since: string
  loginFrom: Record<Platform, string | null>
  accounts: InactiveAccount[]
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
const QUIET = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '6 months', days: 182 },
  { label: '1 year', days: 365 },
  { label: '2 years', days: 730 },
]
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
/** Kept while an account popup is open over this one, so coming back keeps the choices. */
const inactiveChoice = { since: '', platform: 'all', internal: false, noCanada: true }
const SHOW_MAX = 500

/** Active accounts with no login since a day (Scott, 23 November 2026). From the snapshot. */
function InactivePopup({ onClose, onAccount }: { onClose: () => void; onAccount: (key: string) => void }) {
  const [since, setSince] = useState(inactiveChoice.since || daysAgo(182))
  const [platform, setPlatform] = useState(inactiveChoice.platform)
  const [internal, setInternal] = useState(inactiveChoice.internal)
  const [noCanada, setNoCanada] = useState(inactiveChoice.noCanada)
  const [data, setData] = useState<InactiveData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  Object.assign(inactiveChoice, { since, platform, internal, noCanada })
  const choose = (d: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d === since) return
    setBusy(true)
    setError(null)
    setSince(d)
  }
  useEffect(() => {
    let live = true
    get<InactiveData>({ op: 'inactive', since }).then(
      (r) => {
        if (!live) return
        setData(r)
        setBusy(false)
      },
      (e) => {
        if (!live) return
        setError((e as Error).message)
        setBusy(false)
      },
    )
    return () => {
      live = false
    }
  }, [since])
  const shown = (data?.accounts ?? []).filter((a) => (internal || !a.internal) && (!noCanada || !a.canada) && (platform === 'all' || a.platform === platform))
  const users = shown.reduce((s, a) => s + a.activeUsers, 0)
  const never = shown.filter((a) => !a.lastLogin).length
  // Platforms whose login record starts after the chosen day: "none on record" there is not "never".
  const short = PLATFORMS.filter((p) => (platform === 'all' || p === platform) && data?.loginFrom[p] && data.loginFrom[p]! > since)
  function exportCsv() {
    const head = ['Platform', 'Account', 'Account code', 'Client', 'Active users', 'Users', 'Reports', 'Last login', 'Created']
    const lines = [head.join(',')]
    for (const a of shown) lines.push([PLATFORM_LABEL[a.platform], a.name, a.accountId, a.client, String(a.activeUsers), String(a.users), String(a.reports), a.lastLogin ?? 'None on record', a.created].map(csvField).join(','))
    const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `No logins since ${since}${platform === 'all' ? '' : ` - ${PLATFORM_LABEL[platform as Platform]}`}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const preset = QUIET.find((x) => daysAgo(x.days) === since)
  return (
    <Modal title="No Recent Logins" onClose={onClose}>
      <div className="ce-pop">
        <div className="ce-controls">
          <label className="ce-tick">
            No login in
            <select id="ce-in-preset" value={preset ? String(preset.days) : ''} onChange={(e) => e.target.value && choose(daysAgo(Number(e.target.value)))}>
              {QUIET.map((x) => (
                <option key={x.days} value={x.days}>
                  the last {x.label}
                </option>
              ))}
              {!preset ? <option value="">since {dayLabel(since)}</option> : null}
            </select>
          </label>
          <label className="ce-tick">
            or since
            <input id="ce-in-since" type="date" value={since} max={daysAgo(0)} onChange={(e) => choose(e.target.value)} />
          </label>
          <select id="ce-in-platform" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
            <option value="all">All platforms</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
          <label className="ce-tick">
            <input id="ce-in-internal" type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Show internal
          </label>
          <label className="ce-tick">
            <input id="ce-in-no-canada" type="checkbox" checked={noCanada} onChange={(e) => setNoCanada(e.target.checked)} /> Exclude Canada
          </label>
          <span className="ce-count">{busy ? 'Loading…' : `${n(shown.length)} accounts · ${n(users)} active users · ${n(never)} with no login on record`}</span>
          <button type="button" className="btn btn-primary ce-sm" disabled={busy || !shown.length} onClick={exportCsv}>
            Export
          </button>
        </div>
        <p className="ce-muted ce-sm">
          Active accounts where nobody has logged in since {dayLabel(since)}, from the last refresh.
          {short.map((p) => ` ${PLATFORM_LABEL[p]} logins are on record from ${dayLabel(data!.loginFrom[p]!)} only.`).join('')}
        </p>
        {error ? <p className="mr-said mr-bad">{error}</p> : null}
        <div className="ce-table ce-scroll">
          <table className="dtable">
            <thead>
              <tr>
                <th>Account</th>
                <th>Platform</th>
                <th>Active users</th>
                <th>Reports</th>
                <th>Last login</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, SHOW_MAX).map((a) => (
                <tr key={`${a.platform}:${a.accountId}`}>
                  <td>
                    <button type="button" className="ce-name" onClick={() => onAccount(memberKey(a.platform, a.accountId))}>
                      <b>{a.name}</b>
                    </button>
                    <div className="ce-sub">
                      {a.accountId}
                      {a.client && a.client !== a.name ? ` · ${a.client}` : ''}
                      {a.internal ? ' · internal' : ''}
                    </div>
                  </td>
                  <td>{PLATFORM_LABEL[a.platform]}</td>
                  <td>{n(a.activeUsers)}</td>
                  <td>{n(a.reports)}</td>
                  <td className="ce-date">{a.lastLogin ?? <span className="ce-muted">None on record</span>}</td>
                  <td className="ce-date">{a.created ?? ''}</td>
                </tr>
              ))}
              {shown.length > SHOW_MAX ? (
                <tr>
                  <td colSpan={6} className="ce-muted">
                    Showing {n(SHOW_MAX)} of {n(shown.length)}. Export has them all.
                  </td>
                </tr>
              ) : null}
              {!busy && !shown.length && !error ? (
                <tr>
                  <td colSpan={6} className="ce-muted">
                    Every active account has a login since then.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
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
