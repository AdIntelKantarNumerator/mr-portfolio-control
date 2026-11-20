'use client'

/**
 * Report Builder V2 (20 November 2026).
 *
 * Left: the V1 conversation. It starts with the recommended report types and
 * walks through the setup, and shows the preview and the full report as
 * tables and charts. Right: the report being built, as its selections, like
 * the Insights Studio builder prototype: report type, rows, columns, metrics,
 * period, data options, the person's own brands or properties and their
 * competitors, and filters. Change them there or keep talking; both edit the
 * same report on the server, so they never disagree.
 *
 * Top right: Save report, Run, Export and Schedule. None of them, and none of
 * the builder's edits, involve the model. Only typed messages do.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Kicker } from '@/components/ui'
import { CompPanel, MessageView, hintFor } from '../report-builder/chat'
import type { CompSetView } from '@/lib/report-builder/agent'
import type { SavedItem } from '@/lib/report-builder/page-view'
import type { IntelMode, View } from '@/lib/report-builder/tools'
import type { BuilderCatalog, BuilderState, Named } from '@/lib/report-builder/v2/builder'
import type { V2Reply } from '@/lib/report-builder/v2/service'
import type { ScheduleView } from '@/lib/report-builder/v2/schedule'

type Patch = { set?: Record<string, unknown>; add?: Record<string, unknown[]>; remove?: Record<string, unknown[]> }

type Action =
  | { type: 'start'; mode?: IntelMode }
  | { type: 'choose'; choice: string }
  | { type: 'run'; name?: string }
  | { type: 'save'; name: string; replace?: boolean }
  | { type: 'open_saved'; report: string }
  | { type: 'run_saved'; report: string }
  | { type: 'delete_saved'; report: string }
  | { type: 'save_comp_set' }
  | { type: 'edit'; patch: Patch }
  | { type: 'template'; id: string }
  | { type: 'export' }

interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
  view?: View | null
  /** Made by a change in the builder: what changed, for the model's next read. */
  builderNote?: string
}

type Hit = { id: string; label: string; kind: string; context: string }

const API = '/prototypes/report-builder-v2/api'
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `The server said ${res.status}.`)
  return json
}

const MODES: Record<IntelMode, { label: string; hello: string; examples: string[] }> = {
  buyer: {
    label: 'Competitive Intel',
    hello: 'Hi! Pick a report type to start, or tell me what you need. Your selections build up on the right, where you can change any of them.',
    examples: ['Competitive media mix for Toyota vs Honda and Ford', 'Where is Progressive advertising by market?', 'Who advertises in vehicle insurance, by media?', 'TV schedule for Verizon on ESPN, last 4 weeks'],
  },
  publisher: {
    label: 'Publisher Intel',
    hello: 'Hi! Pick a report type to start, or tell me what you need. Your selections build up on the right, where you can change any of them.',
    examples: ["Who's buying Network TV but not Fox?", 'Which advertisers are active in the Chicago market?', 'Who advertises on ESPN, by property?', 'Category trend for quick service restaurants'],
  },
}

const MEASURE_LABEL: Record<string, string> = { spend: 'Spend', occurrences: 'Units', impressions: 'Impressions' }
const CALC_LABEL: Record<string, string> = { share: '% of total', share_across: '% across', yoy: 'Change vs prior year' }

const PERIODS: Array<{ id: string; label: string; time: Record<string, unknown> | null }> = [
  { id: 'r1m', label: 'Previous month', time: { mode: 'rolling', unit: 'month', count: 1 } },
  { id: 'r3m', label: 'Rolling 3 months', time: { mode: 'rolling', unit: 'month', count: 3 } },
  { id: 'r6m', label: 'Rolling 6 months', time: { mode: 'rolling', unit: 'month', count: 6 } },
  { id: 'r12m', label: 'Rolling 12 months', time: { mode: 'rolling', unit: 'month', count: 12 } },
  { id: 'ytd', label: 'Year to date', time: { mode: 'ytd' } },
  { id: 'r1q', label: 'Previous quarter', time: { mode: 'rolling', unit: 'quarter', count: 1 } },
  { id: 'r4w', label: 'Last 4 broadcast weeks', time: { mode: 'rolling', unit: 'week', count: 4 } },
  { id: 'r13w', label: 'Last 13 broadcast weeks', time: { mode: 'rolling', unit: 'week', count: 13 } },
  { id: 'custom', label: 'Custom months', time: null },
]
function periodId(t: BuilderState['time']): string {
  if (!t) return ''
  if (t.mode === 'ytd') return 'ytd'
  if (t.mode === 'static') return 'custom'
  const p = PERIODS.find((x) => x.time && x.time.unit === t.unit && x.time.count === t.count)
  return p?.id ?? 'other'
}

/** Standard and broadcast calendars: the same breakdown on the other calendar. */
const CAL: Record<string, string> = { month: 'broadcast_month', broadcast_month: 'month', week: 'broadcast_week', broadcast_week: 'week' }

/** Kinds of names each side of a set holds. */
const SIDE_TYPES = {
  zero: { mine: ['property', 'media_owner'], versus: ['property', 'media_type', 'media_owner', 'market'] },
  compare: { mine: ['advertiser', 'top_parent', 'product'], versus: ['advertiser', 'top_parent', 'product', 'industry', 'category', 'subcategory'] },
}

// ---------------------------------------------------------------- small parts

function Chip({ children, onRemove, na, title, removeLabel }: { children: ReactNode; onRemove?: () => void; na?: boolean; title?: string; removeLabel?: string }) {
  return (
    <span className={`rb2-chip${na ? ' rb2-na' : ''}`} title={na ? 'Cannot be combined with the rest of this report: see the problem above' : title}>
      {children}
      {na ? <small className="rb2-natag">N/A</small> : null}
      {onRemove ? (
        <button type="button" aria-label={removeLabel ?? 'Remove'} onClick={onRemove}>
          ×
        </button>
      ) : null}
    </span>
  )
}

function Popover({ open, onClose, children, wide }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div ref={ref} className={`rb2-pop${wide ? ' rb2-popwide' : ''}`}>
      {children}
    </div>
  )
}

/** Pick a field from the catalog: grouped, searchable, with the ones in use greyed. */
function FieldPicker({ dims, inUse, onPick, label, footnote }: { dims: BuilderCatalog['dimensions']; inUse: Set<string>; onPick: (key: string) => void; label: string; footnote?: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const out = new Map<string, BuilderCatalog['dimensions']>()
    for (const d of dims) if (!q.trim() || d.label.toLowerCase().includes(q.trim().toLowerCase())) out.set(d.groupLabel, [...(out.get(d.groupLabel) ?? []), d])
    return [...out.entries()]
  }, [dims, q])
  const close = useCallback(() => setOpen(false), [])
  return (
    <span className="rb2-anchor">
      <button type="button" className="rb2-add" onClick={() => setOpen((o) => !o)}>
        + {label}
      </button>
      <Popover open={open} onClose={close}>
        <input className="rb2-search" autoFocus placeholder="Search fields…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="rb2-list">
          {groups.map(([g, ds]) => (
            <div key={g}>
              <div className="rb2-grouphead">{g}</div>
              {ds.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className="rb2-item"
                  disabled={inUse.has(d.key)}
                  onClick={() => {
                    onPick(d.key)
                    setOpen(false)
                    setQ('')
                  }}
                >
                  <span>{d.label}</span>
                  {inUse.has(d.key) ? <small>✓ In use</small> : null}
                </button>
              ))}
            </div>
          ))}
          {!groups.length ? <p className="rb-muted rb2-pad">Nothing matches.</p> : null}
        </div>
        {footnote ? <p className="rb2-foot">{footnote}</p> : null}
      </Popover>
    </span>
  )
}

/** Find a name (an advertiser, a network, a market) and add it. */
function NameAdd({ types, label, onAdd }: { types: string[]; label: string; onAdd: (h: Hit) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const seq = useRef(0)
  useEffect(() => {
    if (!open) return
    const n = ++seq.current
    const t = setTimeout(
      async () => {
        setBusy(true)
        try {
          const out = await post<Hit[]>({ search: { q, types } })
          if (n === seq.current) setHits(out)
        } catch {
          if (n === seq.current) setHits([])
        } finally {
          if (n === seq.current) setBusy(false)
        }
      },
      q ? 250 : 0,
    )
    return () => clearTimeout(t)
    // types is a fresh array each render; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open, types.join(',')])
  return (
    <span className="rb2-anchor">
      <button type="button" className="rb2-add" onClick={() => setOpen((o) => !o)}>
        + {label}
      </button>
      <Popover open={open} onClose={close}>
        <input className="rb2-search" autoFocus placeholder="Type a name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="rb2-list">
          {busy && !hits ? <p className="rb-muted rb2-pad">Looking…</p> : null}
          {hits && !hits.length ? <p className="rb-muted rb2-pad">Nothing matches.</p> : null}
          {(hits ?? []).map((h) => (
            <button
              key={h.id}
              type="button"
              className="rb2-item rb2-hit"
              onClick={() => {
                onAdd(h)
                setOpen(false)
                setQ('')
              }}
            >
              <span>{h.label}</span>
              <small>
                {h.kind}
                {h.context && h.context !== h.kind ? ` · ${h.context}` : ''}
              </small>
            </button>
          ))}
        </div>
      </Popover>
    </span>
  )
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="rb2-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`rb2-modal${wide ? ' rb2-modalwide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="rb2-modalhead">
          <h2>{title}</h2>
          <button type="button" className="rb2-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the builder (right)

function BuilderPanel({
  b,
  cat,
  mode,
  comp,
  brandSet,
  busy,
  name,
  setName,
  edit,
  pickTemplate,
  editSet,
}: {
  b: BuilderState
  cat: BuilderCatalog | null
  mode: IntelMode
  comp: CompSetView | null
  brandSet: CompSetView | null
  busy: boolean
  name: string
  setName: (n: string) => void
  edit: (patch: Patch, said: string) => void
  pickTemplate: (id: string, label: string) => void
  editSet: () => void
}) {
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null)
  const [filterDim, setFilterDim] = useState('')
  if (!cat) return <div className="rb2-card rb-muted">Loading…</div>

  const dimLabel = (k: string) => cat.dimensions.find((d) => d.key === k)?.label ?? k
  const rowKeys = b.rows.map((r) => r.key)
  const inUse = new Set([...rowKeys, ...(b.columns ? [b.columns.key] : [])])
  const z = b.sides
  const empty = b.status === 'empty'

  // Workspace scope: everything, or the person's stored set, as filters (reports without their own sides).
  const set = mode === 'buyer' ? brandSet : comp
  const setIds = (withVersus: boolean) => [...(set?.mine ?? []), ...(withVersus ? (set?.versus ?? []) : [])].map((x) => x.id)
  const dimsOf = (ids: string[]) => {
    const out: Record<string, string[]> = {}
    for (const id of ids) (out[id.split(':')[0]!] ??= []).push(id)
    return out
  }
  const filterIds = new Set(b.filters.flatMap((f) => f.items.map((i) => i.id)))
  const has = (ids: string[]) => ids.length > 0 && ids.every((id) => filterIds.has(id))
  const scope = has(setIds(true)) && (set?.versus.length ?? 0) > 0 ? 'mine_comp' : has(setIds(false)) ? 'mine' : 'all'
  function setScope(next: string) {
    const all = setIds(true)
    const patch: Patch = { set: {} }
    // Clear the set's names from the filters, then add what the new scope wants.
    const cur = Object.fromEntries(b.filters.map((f) => [f.dim, f.items.map((i) => i.id)]))
    for (const [dim, ids] of Object.entries(cur)) {
      const kept = ids.filter((id) => !all.includes(id))
      if (kept.length !== ids.length) patch.set![`filters.${dim}`] = kept.length ? kept : null
    }
    if (next !== 'all') for (const [dim, ids] of Object.entries(dimsOf(setIds(next === 'mine_comp')))) patch.set![`filters.${dim}`] = [...new Set([...((patch.set![`filters.${dim}`] as string[] | null | undefined) ?? (cur[dim] ?? []).filter((id) => !all.includes(id))), ...ids])]
    edit(patch, `Workspace: ${next === 'all' ? 'everything' : next === 'mine' ? (mode === 'buyer' ? 'my brands' : 'my properties') : mode === 'buyer' ? 'my brands and competitors' : 'my properties and competitive set'}`)
  }

  const moveRow = (i: number, d: -1 | 1) => {
    const next = [...rowKeys]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    edit({ set: { rows: next } }, `Rows: ${next.map(dimLabel).join(' › ')}`)
  }
  const pid = periodId(b.time)
  // Only offered where the data has both calendars: the sample data has calendar months only.
  const hasDim = (k: string) => cat.dimensions.some((d) => d.key === k)
  const timeDims = [...rowKeys, b.columns?.key].filter((k): k is string => Boolean(k && CAL[k] && hasDim(CAL[k]!)))
  const calendar = timeDims.some((k) => k.startsWith('broadcast')) ? 'broadcast' : 'standard'
  function setCalendar(next: string) {
    if (next === calendar) return
    const flip = (k: string) => (CAL[k] && hasDim(CAL[k]!) && (next === 'broadcast') !== k.startsWith('broadcast') ? CAL[k]! : k)
    edit({ set: { rows: rowKeys.map(flip), ...(b.columns ? { columns: flip(b.columns.key) } : {}) } }, `Calendar: ${next}`)
  }

  const sideTypes = z ? SIDE_TYPES[z.kind] : null
  const sidePath = z?.kind === 'zero' ? { mine: 'zero_share.mine', versus: 'zero_share.versus', own: 'zero_share.own' } : { mine: 'compare.mine', versus: 'compare.rivals', own: 'compare.own' }

  return (
    <div className={`rb2-card${busy ? ' rb2-busy' : ''}`} aria-label="Report being built">
      <div className="rb2-cardhead">
        <div className="rb-eyebrow">{b.editing ? 'Editing saved report' : 'Report being built'}</div>
        <span className={`rb-status rb-${b.status}`}>{b.statusText}</span>
      </div>
      <input className="rb2-name" aria-label="Report name" value={name} placeholder="Untitled report" onChange={(e) => setName(e.target.value)} />

      <label className="rb2-field">
        <span className="rb2-cap">Report type</span>
        <select value={b.template?.id ?? ''} disabled={busy} onChange={(e) => pickTemplate(e.target.value, cat.templates.find((t) => t.id === e.target.value)?.label ?? '')}>
          {!b.template ? <option value="">Choose a report type…</option> : null}
          {/* A saved or V1 report of a type this mode does not list still shows as what it is. */}
          {b.template && !cat.templates.some((t) => t.id === b.template!.id) ? <option value={b.template.id}>{b.template.label}</option> : null}
          {cat.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {b.template ? <small className="rb2-help">{b.template.description}</small> : null}
      </label>

      {b.errors.length ? (
        <div className="rb2-problem" role="alert">
          {b.errors.map((e, i) => (
            <div key={i}>
              <p>{e.message}</p>
              <div className="rb-row">
                {e.fixes.map((f) => (
                  <button key={f.label} type="button" className="btn rb-small" disabled={busy} onClick={() => edit(f.patch, f.label)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {b.question && !b.errors.length ? <p className="rb2-question">Waiting on: {b.question} Answer in the chat, or set it below.</p> : null}

      {empty ? (
        <p className="rb-muted">Pick a report type here or in the chat. Your selections appear here as you go.</p>
      ) : (
        <>
          {/* ---------------- whose report */}
          {z ? (
            <section className="rb2-section">
              <h3>{z.kind === 'compare' ? 'Your brands and competitors' : 'Your properties and competitors'}</h3>
              <div className="rb2-zonelabel">{z.mineLabel}</div>
              <div className={`rb2-zone${!z.mine.length ? ' rb2-zonewant' : ''}`}>
                {z.mine.map((x: Named) => (
                  <Chip key={x.id} title={x.kind} removeLabel={`Remove ${x.label}`} onRemove={() => edit({ remove: { [sidePath.mine]: [x.id] }, set: { [sidePath.own]: true } }, `Removed ${x.label} from yours`)}>
                    {x.label}
                  </Chip>
                ))}
                <NameAdd types={sideTypes!.mine} label={z.mine.length ? '' : z.kind === 'compare' ? 'Add your brand' : 'Add your property'} onAdd={(h) => edit({ add: { [sidePath.mine]: [h.id] }, set: { [sidePath.own]: true } }, `Added ${h.label} as yours`)} />
              </div>
              {z.versusLabel ? (
                <>
                  <div className="rb2-zonelabel">{z.versusLabel}</div>
                  {z.kind === 'zero' ? (
                    <label className="rb-check">
                      <input type="checkbox" checked={z.all} disabled={busy} onChange={(e) => edit({ set: { 'zero_share.all': e.target.checked, 'zero_share.own': true, ...(e.target.checked ? { 'zero_share.versus': [] } : {}) } }, e.target.checked ? 'Compare with every other property' : 'Compare with chosen properties')} /> Every other property
                    </label>
                  ) : null}
                  {!z.all ? (
                    <div className={`rb2-zone${!z.versus.length ? ' rb2-zonewant' : ''}`}>
                      {z.versus.map((x: Named) => (
                        <Chip key={x.id} title={x.kind} removeLabel={`Remove ${x.label}`} onRemove={() => edit({ remove: { [sidePath.versus]: [x.id] }, set: { [sidePath.own]: true } }, `Removed ${x.label} from competitors`)}>
                          {x.kind !== 'Property' && x.kind !== 'Advertiser' ? <small>{x.kind}</small> : null}
                          {x.label}
                        </Chip>
                      ))}
                      <NameAdd types={sideTypes!.versus} label={z.versus.length ? '' : 'Add a competitor'} onAdd={(h) => edit({ add: { [sidePath.versus]: [h.id] }, set: { [sidePath.own]: true, ...(z.kind === 'zero' ? { 'zero_share.all': false } : {}) } }, `Added ${h.label} as a competitor`)} />
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : (
            <section className="rb2-section">
              <h3>Workspace</h3>
              <div className="rb2-seg" role="group" aria-label="Workspace">
                {[
                  ['all', 'Everything'],
                  ['mine', mode === 'buyer' ? 'My brands' : 'My properties'],
                  ['mine_comp', mode === 'buyer' ? 'My brands + competitors' : 'Mine + competitive set'],
                ].map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={scope === k} disabled={busy || (k !== 'all' && !set?.mine.length) || (k === 'mine_comp' && !set?.versus.length)} onClick={() => setScope(k!)}>
                    {l}
                  </button>
                ))}
              </div>
              <button type="button" className="rb2-link" onClick={editSet}>
                {set?.mine.length ? `Edit ${mode === 'buyer' ? 'my brands and competitors' : 'my competitive set'}` : `Set up ${mode === 'buyer' ? 'my brands and competitors' : 'my competitive set'}`}
              </button>
            </section>
          )}

          {/* ---------------- the table */}
          <section className="rb2-section">
            <h3>Build your table</h3>
            <div className="rb2-zonelabel">Rows</div>
            <div className="rb2-zone">
              {b.rows.map((r, i) => (
                <Chip key={r.key} na={r.na} removeLabel={`Remove ${r.label} from rows`} onRemove={b.rows.length > 1 ? () => edit({ set: { rows: rowKeys.filter((k) => k !== r.key) } }, `Removed ${r.label} from rows`) : undefined}>
                  {b.rows.length > 1 ? (
                    <span className="rb2-move">
                      <button type="button" aria-label={`Move ${r.label} up`} disabled={i === 0} onClick={() => moveRow(i, -1)}>
                        ‹
                      </button>
                      <button type="button" aria-label={`Move ${r.label} down`} disabled={i === b.rows.length - 1} onClick={() => moveRow(i, 1)}>
                        ›
                      </button>
                    </span>
                  ) : null}
                  {r.label}
                </Chip>
              ))}
              <FieldPicker label={b.rows.length ? '' : 'Add a field'} dims={cat.dimensions} inUse={inUse} onPick={(k) => edit({ set: { rows: [...rowKeys, k] } }, `Added ${dimLabel(k)} to rows`)} />
            </div>
            <div className="rb2-zonelabel">Columns (optional)</div>
            <div className="rb2-zone">
              {b.columns ? (
                <Chip na={b.columns.na} removeLabel="Remove the columns" onRemove={() => edit({ set: { columns: null } }, 'Removed the columns')}>
                  {b.columns.label}
                </Chip>
              ) : (
                <FieldPicker
                  label="Add a field"
                  dims={cat.dimensions.filter((d) => d.canBeColumns)}
                  inUse={inUse}
                  footnote="Advertisers, brands and products can only go in Rows."
                  onPick={(k) => edit({ set: { columns: k } }, `Columns: ${dimLabel(k)}`)}
                />
              )}
            </div>
            <div className="rb2-zonelabel">
              Metrics <small className="rb2-help">The numbers in the cells.</small>
            </div>
            <div className="rb2-zone">
              {b.measures.map((m) => (
                <Chip key={m} removeLabel={`Remove ${MEASURE_LABEL[m] ?? m}`} onRemove={b.measures.length > 1 ? () => edit({ set: { measures: b.measures.filter((x) => x !== m) } }, `Removed ${MEASURE_LABEL[m] ?? m}`) : undefined}>
                  {MEASURE_LABEL[m] ?? m}
                </Chip>
              ))}
              {cat.measures.some((m) => !b.measures.includes(m.key)) ? (
                <span className="rb2-addmetrics">
                  {cat.measures
                    .filter((m) => !b.measures.includes(m.key))
                    .map((m) => (
                      <button key={m.key} type="button" className="rb2-add" title={m.note} onClick={() => edit({ set: { measures: [...b.measures, m.key] } }, `Added ${MEASURE_LABEL[m.key] ?? m.label}`)}>
                        + {MEASURE_LABEL[m.key] ?? m.label}
                      </button>
                    ))}
                </span>
              ) : null}
            </div>
            <div className="rb2-checks">
              {(['share', 'share_across', 'yoy'] as const).map((c) =>
                c === 'share_across' && !b.columns ? null : c === 'yoy' && b.columns ? null : (
                  <label key={c} className="rb-check" title={cat.calcs.find((x) => x.key === c)?.note}>
                    <input type="checkbox" checked={b.calcs.includes(c)} disabled={busy} onChange={(e) => edit(e.target.checked ? { add: { calcs: [c] } } : { remove: { calcs: [c] } }, `${e.target.checked ? 'Added' : 'Removed'} ${CALC_LABEL[c]}`)} />{' '}
                    {CALC_LABEL[c]}
                  </label>
                ),
              )}
              <label className="rb-check">
                Top
                <select value={b.topN ?? ''} disabled={busy} onChange={(e) => edit({ set: { 'options.top_n': e.target.value ? Number(e.target.value) : null } }, e.target.value ? `Top ${e.target.value} rows` : 'All rows')}>
                  <option value="">all rows</option>
                  {[10, 25, 50, 100, 500].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {/* ---------------- the data */}
          <section className="rb2-section">
            <h3>Choose your data</h3>
            <div className="rb2-grid2">
              <label className="rb2-field">
                <span className="rb2-cap">Date range</span>
                <select
                  value={custom ? 'custom' : pid}
                  disabled={busy}
                  onChange={(e) => {
                    const p = PERIODS.find((x) => x.id === e.target.value)
                    if (!p) return
                    if (!p.time) return setCustom({ start: b.time?.start ?? '', end: b.time?.end ?? '' })
                    setCustom(null)
                    edit({ set: { time: p.time } }, `Period: ${p.label}`)
                  }}
                >
                  {pid === 'other' ? <option value="other">{b.periodText}</option> : null}
                  {PERIODS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === 'custom' && b.time?.mode === 'static' ? `${b.time.start} to ${b.time.end}` : p.label}
                    </option>
                  ))}
                </select>
                <small className="rb2-help">{b.time?.mode === 'static' ? 'Fixed: will not move with new data' : 'Moves forward as new data loads'}</small>
              </label>
              <label className="rb2-field">
                <span className="rb2-cap">Data availability</span>
                <select value={b.finalOnly ? 'final' : 'prelim'} disabled={busy} onChange={(e) => edit({ set: { 'options.final_only': e.target.value === 'final' } }, e.target.value === 'final' ? 'Final data only' : 'Include preliminary data')}>
                  <option value="final">Final only (through {cat.dataThrough})</option>
                  <option value="prelim">Include preliminary (through {cat.prelimThrough})</option>
                </select>
              </label>
              {timeDims.length ? (
                <label className="rb2-field">
                  <span className="rb2-cap">Calendar</span>
                  <select value={calendar} disabled={busy} onChange={(e) => setCalendar(e.target.value)}>
                    <option value="standard">Standard</option>
                    <option value="broadcast">Broadcast</option>
                  </select>
                </label>
              ) : null}
            </div>
            {custom ? (
              <form
                className="rb-row rb2-custom"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!custom.start || !custom.end) return
                  edit({ set: { time: { mode: 'static', start: custom.start, end: custom.end } } }, `Period: ${custom.start} to ${custom.end}`)
                  setCustom(null)
                }}
              >
                <input type="month" aria-label="First month" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} />
                <span>to</span>
                <input type="month" aria-label="Last month" value={custom.end} onChange={(e) => setCustom({ ...custom, end: e.target.value })} />
                <button type="submit" className="btn btn-primary rb-small" disabled={!custom.start || !custom.end}>
                  Apply
                </button>
                <button type="button" className="btn rb-small" onClick={() => setCustom(null)}>
                  Cancel
                </button>
              </form>
            ) : null}
          </section>

          {/* ---------------- filters */}
          <section className="rb2-section">
            <h3>Filters</h3>
            {b.filters.map((f) => (
              <div key={f.dim} className="rb2-filter">
                <span className="rb2-zonelabel">{f.label}</span>
                <div className="rb2-zone">
                  {f.items.map((x) => (
                    <Chip key={x.id} na={f.na} removeLabel={`Remove ${x.label}`} onRemove={() => edit({ remove: { [`filters.${f.dim}`]: [x.id] } }, `Removed ${f.label}: ${x.label}`)}>
                      {x.label}
                    </Chip>
                  ))}
                  <NameAdd types={[f.dim]} label="" onAdd={(h) => edit({ add: { [`filters.${f.dim}`]: [h.id] } }, `Added ${f.label}: ${h.label}`)} />
                </div>
              </div>
            ))}
            <div className="rb-row">
              <select aria-label="Filter on" value={filterDim} onChange={(e) => setFilterDim(e.target.value)}>
                <option value="">Add a filter on…</option>
                {cat.dimensions
                  .filter((d) => d.canFilter && !b.filters.some((f) => f.dim === d.key))
                  .map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
              </select>
              {filterDim ? (
                <NameAdd
                  key={filterDim}
                  types={[filterDim]}
                  label={`Choose ${dimLabel(filterDim).toLowerCase()}`}
                  onAdd={(h) => {
                    edit({ add: { [`filters.${filterDim}`]: [h.id] } }, `Added ${dimLabel(filterDim)}: ${h.label}`)
                    setFilterDim('')
                  }}
                />
              ) : null}
              {b.filters.length ? (
                <button type="button" className="rb2-link" onClick={() => edit({ set: Object.fromEntries(b.filters.map((f) => [`filters.${f.dim}`, null])) }, 'Cleared the filters')}>
                  Clear all
                </button>
              ) : null}
            </div>
            {!b.filters.length ? <small className="rb2-help">No filters: every advertiser and medium in the US.</small> : null}
          </section>

          {b.warnings.length ? <p className="rb-notes">{Array.from(new Set(b.warnings)).join(' ')}</p> : null}
          <p className="rb2-state">
            {b.periodText ? `${b.periodText} · ` : ''}
            {b.finalOnly ? `Final data through ${cat.dataThrough}` : `Final through ${cat.dataThrough}, preliminary to ${cat.prelimThrough}`}
          </p>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- schedules

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SCHED_PERIODS: Array<{ id: string; label: string; period: Record<string, unknown> | null }> = [
  { id: 'own', label: "The report's own period", period: null },
  { id: 'r1m', label: 'Previous month', period: { mode: 'rolling', unit: 'month', count: 1 } },
  { id: 'r3m', label: 'Last 3 months', period: { mode: 'rolling', unit: 'month', count: 3 } },
  { id: 'r12m', label: 'Last 12 months', period: { mode: 'rolling', unit: 'month', count: 12 } },
  { id: 'ytd', label: 'Year to date', period: { mode: 'ytd' } },
  { id: 'r4w', label: 'Last 4 broadcast weeks', period: { mode: 'rolling', unit: 'week', count: 4 } },
]

interface ScheduleDraft {
  cadence: 'once' | 'daily' | 'weekly' | 'monthly'
  startDate: string
  timeOfDay: string
  timezone: string
  dayOfWeek: number
  /** monthly: "1".."28", "-1" (last day) or "first" (the first dayOfWeek). */
  monthDay: string
  periodId: string
  format: 'xlsx' | 'csv'
  recipients: string
}

function draftFrom(s: ScheduleView | null, email: string): ScheduleDraft {
  const today = new Date()
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
  if (!s)
    return {
      cadence: 'weekly',
      startDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
      timeOfDay: '08:00',
      timezone: tz,
      dayOfWeek: 1,
      monthDay: '1',
      periodId: 'own',
      format: 'xlsx',
      recipients: email.includes('@localhost') ? '' : email,
    }
  const pid = SCHED_PERIODS.find((p) => JSON.stringify(p.period) === JSON.stringify(s.period))?.id ?? 'own'
  return {
    cadence: s.cadence,
    startDate: s.startDate,
    timeOfDay: s.timeOfDay,
    timezone: s.timezone,
    dayOfWeek: s.dayOfWeek ?? 1,
    monthDay: s.cadence === 'monthly' ? (s.dayOfMonth == null ? 'first' : String(s.dayOfMonth)) : '1',
    periodId: pid,
    format: s.format,
    recipients: s.recipients.join(', '),
  }
}

function ScheduleDialog({
  report,
  existing,
  email,
  mail,
  needsSave,
  onClose,
  onDone,
}: {
  report: { id: string | null; name: string }
  existing: ScheduleView | null
  email: string
  mail: string | null
  /** The report is not saved, or has changes: save it first, under this name. */
  needsSave: null | ((name: string) => Promise<{ id: string; name: string } | null>)
  onClose: () => void
  onDone: (list: ScheduleView[]) => void
}) {
  const [d, setD] = useState<ScheduleDraft>(() => draftFrom(existing, email))
  const [name, setName] = useState(report.name)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const up = (p: Partial<ScheduleDraft>) => setD((x) => ({ ...x, ...p }))
  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      let target = { id: report.id, name: report.name }
      if (needsSave) {
        const saved = await needsSave(name.trim() || 'My report')
        if (!saved) throw new Error('The report could not be saved, so it cannot be scheduled yet.')
        target = saved
      }
      const input = {
        reportId: target.id,
        reportName: target.name,
        cadence: d.cadence,
        startDate: d.startDate,
        timeOfDay: d.timeOfDay,
        timezone: d.timezone,
        dayOfWeek: d.cadence === 'weekly' || (d.cadence === 'monthly' && d.monthDay === 'first') ? d.dayOfWeek : null,
        dayOfMonth: d.cadence === 'monthly' && d.monthDay !== 'first' ? Number(d.monthDay) : null,
        period: SCHED_PERIODS.find((p) => p.id === d.periodId)?.period ?? null,
        format: d.format,
        recipients: d.recipients,
      }
      const out = await post<{ schedules: ScheduleView[] }>({ schedule: existing ? { op: 'update', id: existing.id, input } : { op: 'create', input } })
      onDone(out.schedules)
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={existing ? `Change schedule: ${existing.reportName}` : 'Schedule this report'} onClose={onClose}>
      <form className="rb2-form" onSubmit={submit}>
        {needsSave ? (
          <label className="rb2-field">
            <span className="rb2-cap">{report.id ? 'Save changes to' : 'Save it as'}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
            <small className="rb2-help">A schedule runs a saved report. It is read again at every run, so later changes apply.</small>
          </label>
        ) : (
          <p className="rb2-question">
            <b>{report.name}</b>: each run uses the newest data and the report as saved at that time.
          </p>
        )}
        <div className="rb2-grid2">
          <label className="rb2-field">
            <span className="rb2-cap">How often</span>
            <select value={d.cadence} onChange={(e) => up({ cadence: e.target.value as ScheduleDraft['cadence'] })}>
              <option value="once">Once</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
          </label>
          {d.cadence === 'weekly' ? (
            <label className="rb2-field">
              <span className="rb2-cap">On</span>
              <select value={d.dayOfWeek} onChange={(e) => up({ dayOfWeek: Number(e.target.value) })}>
                {DAYS.map((x, i) => (
                  <option key={x} value={i}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
          ) : d.cadence === 'monthly' ? (
            <label className="rb2-field">
              <span className="rb2-cap">On</span>
              <span className="rb-row">
                <select value={d.monthDay} onChange={(e) => up({ monthDay: e.target.value })}>
                  <option value="first">The first…</option>
                  {Array.from({ length: 28 }, (_, i) => (
                    <option key={i} value={String(i + 1)}>
                      Day {i + 1}
                    </option>
                  ))}
                  <option value="-1">The last day</option>
                </select>
                {d.monthDay === 'first' ? (
                  <select value={d.dayOfWeek} aria-label="Weekday" onChange={(e) => up({ dayOfWeek: Number(e.target.value) })}>
                    {DAYS.map((x, i) => (
                      <option key={x} value={i}>
                        {x}
                      </option>
                    ))}
                  </select>
                ) : null}
              </span>
            </label>
          ) : (
            <span />
          )}
          <label className="rb2-field">
            <span className="rb2-cap">{d.cadence === 'once' ? 'Date' : 'Starting'}</span>
            <input type="date" value={d.startDate} onChange={(e) => up({ startDate: e.target.value })} required />
          </label>
          <label className="rb2-field">
            <span className="rb2-cap">Time</span>
            <input type="time" value={d.timeOfDay} onChange={(e) => up({ timeOfDay: e.target.value })} required />
            <small className="rb2-help">{d.timezone}</small>
          </label>
          <label className="rb2-field">
            <span className="rb2-cap">Period in each run</span>
            <select value={d.periodId} onChange={(e) => up({ periodId: e.target.value })}>
              {SCHED_PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <small className="rb2-help">Rolling: worked out again at every run.</small>
          </label>
          <label className="rb2-field">
            <span className="rb2-cap">Format</span>
            <select value={d.format} onChange={(e) => up({ format: e.target.value as 'xlsx' | 'csv' })}>
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV</option>
            </select>
          </label>
        </div>
        <label className="rb2-field">
          <span className="rb2-cap">Send to</span>
          <textarea rows={2} value={d.recipients} placeholder="name@company.com, another@company.com" onChange={(e) => up({ recipients: e.target.value })} required />
          <small className="rb2-help">The file is attached to the email, so recipients do not need to sign in.</small>
        </label>
        {mail ? <p className="rb-notes">{mail} The schedule will save, and its runs will show as failed until it is.</p> : null}
        {err ? <p className="rb2-error">{err}</p> : null}
        <div className="rb2-modalfoot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : existing ? 'Save schedule' : 'Schedule'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')

function ScheduleList({ list, mail, busyId, act, onEdit }: { list: ScheduleView[]; mail: string | null; busyId: string | null; act: (op: string, id: string) => void; onEdit: (s: ScheduleView) => void }) {
  const [arming, setArming] = useState<string | null>(null)
  return (
    <div className="rb2-card">
      <h3 className="rb2-h">Scheduled reports</h3>
      <p className="rb-muted">Each run uses the newest data and emails the file. Failures show here and are emailed to you.</p>
      {mail ? <p className="rb-notes">{mail}</p> : null}
      {!list.length ? <p className="rb-muted">Nothing scheduled yet. Open a report and choose Schedule.</p> : null}
      {list.length ? (
        <div className="rb-tablewrap">
          <table className="rb-table rb2-sched">
            <thead>
              <tr>
                <th>Report</th>
                <th>When</th>
                <th>To</th>
                <th>Next run</th>
                <th>Last run</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.reportName}</b>
                    <div className="rb-muted rb-cap">
                      {s.format === 'csv' ? 'CSV' : 'Excel'} · {s.periodText}
                    </div>
                  </td>
                  <td>{s.when}</td>
                  <td className="rb2-to">{s.recipients.join(', ')}</td>
                  <td>{s.active ? when(s.nextRunAt) : <span className="rb-pill">Paused</span>}</td>
                  <td>
                    {s.lastStatus === 'ok' ? <span className="rb-pill rb-live">Sent</span> : s.lastStatus === 'failed' ? <span className="rb-pill rb2-failed">Failed</span> : s.lastStatus === 'running' ? <span className="rb-pill">Running</span> : null} {when(s.lastRunAt)}
                    {s.lastStatus === 'failed' && s.lastError ? <div className="rb2-error rb-cap">{s.lastError}</div> : null}
                  </td>
                  <td className="rb2-actions">
                    <button type="button" className="btn rb-small" disabled={busyId === s.id} onClick={() => act('run', s.id)}>
                      {busyId === s.id ? 'Sending…' : 'Send now'}
                    </button>
                    <button type="button" className="btn rb-small" onClick={() => onEdit(s)}>
                      Change
                    </button>
                    <button type="button" className="btn rb-small" onClick={() => act(s.active ? 'pause' : 'resume', s.id)}>
                      {s.active ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      type="button"
                      className="btn rb-small rb-danger"
                      onClick={() => {
                        if (arming !== s.id) return setArming(s.id)
                        setArming(null)
                        act('delete', s.id)
                      }}
                    >
                      {arming === s.id ? 'Confirm' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- the page

export function ReportBuilderV2({
  email,
  initialSaved,
  initialComp,
  initialBrands,
  initialMode,
  modelReady,
  live,
  dataThrough,
}: {
  email: string
  initialSaved: SavedItem[]
  initialComp: CompSetView | null
  initialBrands: CompSetView | null
  initialMode: IntelMode
  modelReady: boolean
  live: boolean
  dataThrough: string
}) {
  const [mode, setMode] = useState<IntelMode>(initialMode)
  const [tab, setTab] = useState<'build' | 'saved' | 'schedules'>('build')
  const [chatId, setChatId] = useState(newId)
  const [messages, setMessages] = useState<Message[]>([])
  const [builder, setBuilder] = useState<BuilderState | null>(null)
  const [catalog, setCatalog] = useState<BuilderCatalog | null>(null)
  const [saved, setSaved] = useState<SavedItem[]>(initialSaved)
  const [comp, setComp] = useState<CompSetView | null>(initialComp)
  const [brandSet, setBrandSet] = useState<CompSetView | null>(initialBrands)
  const [busy, setBusy] = useState<string | null>(null)
  const [input, setInput] = useState('')
  /** The name typed in the builder; until then the report's own (or suggested) name. */
  const [customName, setCustomName] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [setOpen, setSetOpen] = useState(false)
  const [schedules, setSchedules] = useState<ScheduleView[] | null>(null)
  const [mail, setMail] = useState<string | null>(null)
  const [scheduling, setScheduling] = useState<null | { report: { id: string | null; name: string }; existing: ScheduleView | null; needsSave: boolean }>(null)
  const [schedBusy, setSchedBusy] = useState<string | null>(null)
  const [arming, setArming] = useState<string | null>(null)
  const seq = useRef(0)
  const logRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)
  const closeExport = useCallback(() => setExportOpen(false), [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])
  const name = customName ?? builder?.editing?.name ?? builder?.name ?? ''

  const push = (m: Omit<Message, 'id'>) => setMessages((all) => [...all, { ...m, id: ++seq.current }])

  function take(r: V2Reply, from?: { builderNote?: string; quiet?: boolean }) {
    if (r.builder) setBuilder(r.builder)
    if (r.catalog) setCatalog(r.catalog)
    if (r.saved) setSaved(r.saved)
    if (r.compSet !== undefined) setComp(r.compSet)
    if (r.brandSet !== undefined) setBrandSet(r.brandSet)
    if (from?.quiet) return
    if (from?.builderNote) {
      // A run of builder edits keeps one message, the latest, so the chat is not flooded.
      setMessages((all) => {
        const last = all[all.length - 1]
        const note = last?.builderNote ? `${last.builderNote}; ${from.builderNote}` : from.builderNote
        const m: Message = { id: ++seq.current, role: 'assistant', text: r.text, view: r.view, builderNote: note }
        return last?.builderNote ? [...all.slice(0, -1), m] : [...all, m]
      })
      return
    }
    push({ role: 'assistant', text: r.text, view: r.view })
  }

  async function send(body: Record<string, unknown>, id = chatId): Promise<V2Reply> {
    return post<V2Reply>({ chatId: id, ...body })
  }

  /** A click: applied directly, no model. said: shown as the person's words in the chat. */
  async function act(action: Action, said: string | null, opts: { builderNote?: string; quiet?: boolean; id?: string } = {}): Promise<V2Reply | null> {
    if (busy) return null
    if (said) push({ role: 'user', text: said })
    setBusy('Updating')
    try {
      const r = await send({ action }, opts.id)
      take(r, opts)
      return r
    } catch (err) {
      push({ role: 'assistant', text: (err as Error).message })
      return null
    } finally {
      setBusy(null)
    }
  }

  const edit = (patch: Patch, said: string) => void act({ type: 'edit', patch }, null, { builderNote: said })
  const pickTemplate = (id: string, label: string) => void act({ type: 'template', id }, null, { builderNote: `Report type: ${label}` })

  /** A typed message: the model reads the conversation, builder edits included. */
  async function ask(text: string) {
    if (busy || !text.trim()) return
    const turns = messages.flatMap((m) =>
      m.builderNote
        ? [
            { role: 'user', content: `[Changed in the builder: ${m.builderNote}]` },
            { role: 'assistant', content: m.text },
          ]
        : [{ role: m.role, content: m.text }],
    )
    turns.push({ role: 'user', content: text })
    push({ role: 'user', text })
    setInput('')
    setBusy('Working on it')
    try {
      take(await send({ turns }))
    } catch (err) {
      push({ role: 'assistant', text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  function startOver(next: IntelMode = mode) {
    const id = newId()
    setChatId(id)
    setMessages([])
    setBuilder(null)
    setCustomName(null)
    setTab('build')
    void act({ type: 'start', mode: next }, null, { id })
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    void act({ type: 'start', mode }, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadSchedules = useCallback(async () => {
    try {
      const out = await post<{ schedules: ScheduleView[]; mail: string | null }>({ schedule: { op: 'list' } })
      setSchedules(out.schedules)
      setMail(out.mail)
    } catch (err) {
      setToast((err as Error).message)
    }
  }, [])
  useEffect(() => {
    post<{ schedules: ScheduleView[]; mail: string | null }>({ schedule: { op: 'list' } })
      .then((out) => {
        setSchedules(out.schedules)
        setMail(out.mail)
      })
      .catch(() => {})
  }, [])

  async function scheduleOp(op: string, id: string) {
    setSchedBusy(id)
    try {
      const out = await post<{ schedules: ScheduleView[]; mail: string | null }>({ schedule: { op, id } })
      setSchedules(out.schedules)
      setMail(out.mail)
      const s = out.schedules.find((x) => x.id === id)
      if (op === 'run') setToast(s?.lastStatus === 'ok' ? `Sent to ${s.recipients.join(', ')}` : `Not sent: ${s?.lastError ?? 'see the list'}`)
    } catch (err) {
      setToast((err as Error).message)
    } finally {
      setSchedBusy(null)
    }
  }

  const ready = builder?.status === 'ready'
  /** Run, Export and Schedule need a finished report: say what is missing instead. */
  function needReady(): boolean {
    if (ready) return true
    setTab('build')
    setToast(!builder || builder.status === 'empty' ? 'Pick a report type first.' : builder.errors[0]?.message ?? (builder.question ? `First: ${builder.question}` : 'The report is not finished yet.'))
    return false
  }

  async function save(replace: boolean, as = name): Promise<{ id: string; name: string } | null> {
    const n = as.trim() || 'My report'
    const r = await act({ type: 'save', name: n, replace }, null, { quiet: true })
    if (r?.builder.editing) {
      setToast(`Saved as "${r.builder.editing.name}"`)
      setCustomName(null)
      return r.builder.editing
    }
    if (r) setToast(r.text)
    return null
  }

  async function doExport(format: 'xlsx' | 'csv' | 'pdf') {
    setExportOpen(false)
    if (!needReady() || busy) return
    setBusy('Preparing the file')
    try {
      const r = await send({ action: { type: 'export' } })
      take(r, { quiet: true })
      if (!r.exportUrl) return setToast(r.text)
      // The name in the box, not the suggested one.
      const url = new URL(r.exportUrl, window.location.origin)
      url.searchParams.set('name', (name.trim() || builder?.name || 'Report').slice(0, 80))
      url.searchParams.set('format', format)
      window.location.href = url.toString()
      setToast(`Downloading ${format === 'xlsx' ? 'Excel' : format.toUpperCase()}…`)
    } catch (err) {
      setToast((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function openSchedule() {
    if (!needReady()) return
    const editing = builder?.editing ?? null
    setScheduling({ report: { id: editing?.id ?? null, name: name.trim() || editing?.name || builder?.name || 'My report' }, existing: null, needsSave: true })
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const editingName = builder?.editing?.name

  return (
    <>
      <div className="titlerow rb-titlerow rb2-titlerow">
        <div>
          <Kicker>Prototypes</Kicker>
          <div className="rb-titleline">
            <h1>Report Builder V2</h1>
            <div className="rb-modes" role="group" aria-label="Kind of client">
              {(Object.keys(MODES) as IntelMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  disabled={!!busy && mode !== m}
                  onClick={() => {
                    if (m === mode || busy) return
                    setMode(m)
                    startOver(m)
                  }}
                >
                  {MODES[m].label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="rb2-top">
          <button type="button" className="btn rb2-ghost" disabled={!!busy} onClick={() => (needReady() ? setSaving(true) : null)}>
            Save report
          </button>
          <button type="button" className="btn" disabled={!!busy} onClick={openSchedule}>
            Schedule
          </button>
          <span className="rb2-anchor">
            <button type="button" className="btn" disabled={!!busy} aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => (needReady() ? setExportOpen((o) => !o) : null)}>
              Export ▾
            </button>
            <Popover open={exportOpen} onClose={closeExport}>
              <div className="rb2-list" role="menu">
                <button type="button" role="menuitem" className="rb2-item" onClick={() => void doExport('xlsx')}>
                  Excel (.xlsx)
                </button>
                <button type="button" role="menuitem" className="rb2-item" onClick={() => void doExport('csv')}>
                  CSV
                </button>
                <button type="button" role="menuitem" className="rb2-item" onClick={() => void doExport('pdf')}>
                  PDF
                </button>
              </div>
            </Popover>
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!!busy}
            onClick={() => {
              if (!needReady()) return
              setTab('build')
              void act({ type: 'run', name: name.trim() || undefined }, 'Run the full report')
            }}
          >
            Run
          </button>
        </div>
      </div>

      <div className="rb-tabs rb2-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'build'} onClick={() => setTab('build')}>
          Builder
        </button>
        <button type="button" role="tab" aria-selected={tab === 'saved'} onClick={() => setTab('saved')}>
          Saved reports{saved.length ? ` (${saved.length})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'schedules'}
          onClick={() => {
            setTab('schedules')
            void loadSchedules()
          }}
        >
          Schedules{schedules?.length ? ` (${schedules.length})` : ''}
        </button>
      </div>

      {tab === 'saved' ? (
        <div className="rb2-card">
          <h3 className="rb2-h">Saved reports</h3>
          <p className="rb-muted">A saved report is its setup. Open it to change it, or run, export or schedule it as it is: no chat needed.</p>
          {!saved.length ? <p className="rb-muted">None yet. Build a report and choose Save report.</p> : null}
          <div className="rb2-savedlist">
            {saved.map((s) => (
              <div key={s.id} className="rb2-saved">
                <div>
                  <div className="rb-row">
                    <b>{s.name}</b>
                    <span className={`rb-pill${s.picksUpNewData ? ' rb-live' : ''}`}>{s.picksUpNewData ? 'updates with new data' : 'fixed period'}</span>
                    {s.imported ? <span className="rb-pill rb-from360">From 360</span> : null}
                  </div>
                  <p className="rb-muted">{s.summary}</p>
                  <p className="rb-muted rb-cap">{s.lastRun ? `Last run: ${s.lastRun}` : 'Not run yet'}</p>
                </div>
                <div className="rb2-actions">
                  <button
                    type="button"
                    className="btn btn-primary rb-small"
                    disabled={!!busy}
                    onClick={() => {
                      setTab('build')
                      setCustomName(null)
                      void act({ type: 'run_saved', report: s.id }, `Run ${s.name}`)
                    }}
                  >
                    Run
                  </button>
                  <button
                    type="button"
                    className="btn rb-small"
                    disabled={!!busy}
                    onClick={() => {
                      setTab('build')
                      setCustomName(null)
                      void act({ type: 'open_saved', report: s.id }, `Open ${s.name}`)
                    }}
                  >
                    Open
                  </button>
                  <button type="button" className="btn rb-small" onClick={() => setScheduling({ report: { id: s.id, name: s.name }, existing: null, needsSave: false })}>
                    Schedule
                  </button>
                  <button
                    type="button"
                    className="btn rb-small rb-danger"
                    disabled={!!busy}
                    onClick={() => {
                      if (arming !== s.id) return setArming(s.id)
                      setArming(null)
                      void act({ type: 'delete_saved', report: s.id }, null, { quiet: true }).then((r) => r && setToast(`Deleted "${s.name}"`))
                    }}
                  >
                    {arming === s.id ? 'Confirm delete' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : tab === 'schedules' ? (
        <ScheduleList list={schedules ?? []} mail={mail} busyId={schedBusy} act={(op, id) => void scheduleOp(op, id)} onEdit={(s) => setScheduling({ report: { id: s.reportId, name: s.reportName }, existing: s, needsSave: false })} />
      ) : (
        <div className="rb2-frame">
          <section className="rb-chatcard rb2-chat" aria-label="Conversation">
            <div className="rb-chathead">
              <span className="rb-muted">{editingName ? `Editing ${editingName}` : 'Set up a report by conversation'}</span>
              <button type="button" className="btn rb-small" disabled={!!busy} onClick={() => startOver()}>
                + New report
              </button>
            </div>
            <div className="rb-log" ref={logRef} aria-live="polite">
              <div className="rb-msg rb-bot">
                <p>{MODES[mode].hello}</p>
              </div>
              {messages.map((m) => (
                <div key={m.id} className="rb2-msgwrap">
                  {m.builderNote ? <p className="rb2-note">Changed in the builder: {m.builderNote}</p> : null}
                  <MessageView
                    m={{ id: m.id, role: m.role, text: m.text, view: m.view }}
                    live={m === lastAssistant && !busy}
                    panel={builder && builder.status !== 'empty' ? { name, editing: builder.editing?.name ?? null, status: builder.status, statusText: builder.statusText, rows: [], period: builder.periodText, picksUpNewData: builder.time?.mode !== 'static' } : null}
                    onChoose={(label) => void act({ type: 'choose', choice: label }, label)}
                    onRun={() => void act({ type: 'run', name: name.trim() || undefined }, 'Run the full report')}
                    onSave={() => setSaving(true)}
                    onNew={() => startOver()}
                    onSaveComp={(label) => void act({ type: 'save_comp_set' }, label)}
                  />
                </div>
              ))}
              {messages.length <= 1 && !busy && modelReady ? (
                <div className="rb-msg rb-bot">
                  <span className="rb-label">Or try asking:</span>
                  <div className="rb-grid">
                    {MODES[mode].examples.map((e) => (
                      <button key={e} type="button" className="rb-choice rb-quiet" onClick={() => void ask(e)}>
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {busy ? <div className="rb-msg rb-bot rb-thinking">{busy}…</div> : null}
            </div>
            <form
              className="rb-compose"
              onSubmit={(e) => {
                e.preventDefault()
                void ask(input)
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={modelReady ? hintFor(lastAssistant?.view, Boolean(editingName)) : 'Typing needs a model to be configured; the buttons and the builder work without one'}
                aria-label="Message"
                disabled={!modelReady}
              />
              <button type="submit" className="btn btn-primary" disabled={!modelReady || !!busy || !input.trim()}>
                Send
              </button>
            </form>
          </section>

          <aside className="rb2-side">
            {builder ? (
              <BuilderPanel
                b={builder}
                cat={catalog}
                mode={mode}
                comp={comp}
                brandSet={brandSet}
                busy={!!busy}
                name={name}
                setName={setCustomName}
                edit={edit}
                pickTemplate={pickTemplate}
                editSet={() => setSetOpen(true)}
              />
            ) : (
              <div className="rb2-card rb-muted">Loading…</div>
            )}
            <p className="rb-muted rb-cap rb2-foot2">{live ? `Live data, complete through ${dataThrough}` : `Sample data, final through ${dataThrough}`}</p>
          </aside>
        </div>
      )}

      {saving && builder ? (
        <Modal title={builder.editing ? 'Save report' : 'Save this report'} onClose={() => setSaving(false)}>
          <form
            className="rb2-form"
            onSubmit={(e) => {
              e.preventDefault()
              setSaving(false)
              void save(Boolean(builder.editing) && name.trim() === builder.editing!.name)
            }}
          >
            <label className="rb2-field">
              <span className="rb2-cap">Name</span>
              <input value={name} autoFocus onChange={(e) => setCustomName(e.target.value)} required />
              {builder.editing ? <small className="rb2-help">Keep the name to save your changes to &ldquo;{builder.editing.name}&rdquo;; change it to save a copy.</small> : <small className="rb2-help">{builder.time?.mode === 'static' ? 'Its period is fixed, so runs will not pick up newer months.' : 'Its period is rolling, so every run picks up the newest data.'}</small>}
            </label>
            <div className="rb2-modalfoot">
              <button type="button" className="btn" onClick={() => setSaving(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {builder.editing && name.trim() === builder.editing.name ? 'Save changes' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {scheduling ? (
        <ScheduleDialog
          report={scheduling.report}
          existing={scheduling.existing}
          email={email}
          mail={mail}
          needsSave={scheduling.needsSave ? (n) => save(Boolean(builder?.editing) && n === builder?.editing?.name, n) : null}
          onClose={() => setScheduling(null)}
          onDone={(list) => {
            setSchedules(list)
            setScheduling(null)
            setTab('schedules')
            setToast('Scheduled')
          }}
        />
      ) : null}

      {setOpen ? (
        <Modal title={mode === 'buyer' ? 'My brands and competitors' : 'My competitive set'} onClose={() => setSetOpen(false)} wide>
          {mode === 'buyer' ? <CompPanel key="brands" set="brands" comp={brandSet} setComp={setBrandSet} /> : <CompPanel key="properties" set="properties" comp={comp} setComp={setComp} />}
        </Modal>
      ) : null}

      {toast ? (
        <div className="rb2-toast" role="status">
          {toast}
        </div>
      ) : null}
    </>
  )
}
