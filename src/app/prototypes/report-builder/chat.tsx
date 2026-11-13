'use client'

/**
 * The Report Builder conversation, on its own page (11 November 2026).
 *
 * Built here rather than in Open WebUI because Open WebUI shows a model's
 * answer as text: no buttons, no charts. Here the model only writes a sentence
 * or two; the page draws the rest from what the tools returned (view): the
 * question's choices as two columns of buttons, the table, a chart above it,
 * the download, and the report's details beside the chat.
 *
 * A click is applied directly by the server, with no model round, so it is
 * instant. A typed message goes to the model. Either way it is added to the
 * conversation the model sees next time.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { MarkdownView } from '@/components/markdown-view'
import { Kicker } from '@/components/ui'
import { Import360 } from './import360'
import type { CompSetView, PageReply } from '@/lib/report-builder/agent'
import type { SavedItem } from '@/lib/report-builder/page-view'
import type { IntelMode, SetKind, View, ViewTable, ViewTree } from '@/lib/report-builder/tools'

interface Message {
  id: number
  role: 'user' | 'assistant' | 'note'
  text: string
  view?: View | null
}

type Action =
  | { type: 'start'; mode?: IntelMode }
  | { type: 'choose'; choice: string }
  | { type: 'run'; name?: string }
  | { type: 'save'; name: string; replace?: boolean }
  | { type: 'open_saved'; report: string }
  | { type: 'run_saved'; report: string }
  | { type: 'delete_saved'; report: string }
  | { type: 'demo_month' }
  | { type: 'save_comp_set' }

/** The two kinds of client the prototype shows: a media owner selling, and a brand or buyer watching competitors. */
const MODES: Record<IntelMode, { label: string; hello: string; examples: string[] }> = {
  publisher: {
    label: 'Publisher Intel',
    hello: 'Hi! I can find advertisers for your properties: who buys your competitors but not you, your share of their spend, and who is buying you now. Pick a starting point, or tell me what you need.',
    examples: ["Who's buying Network TV but not Fox, last 4 weeks?", 'Share of wallet for CBS against NBC and ABC', 'Top advertisers on ESPN by broadcast week', 'Which categories spend on Cable TV but not with us?'],
  },
  buyer: {
    label: 'Competitive Intel',
    hello: 'Hi! I can show what your competitors are doing: their media mix, share of voice, weekly spend and where they run. Pick a starting point, or tell me what you need.',
    examples: ['Media mix for Toyota vs Honda and Ford, last 3 months', 'Share of voice for Progressive in vehicle insurance', 'Weekly spend for Verizon vs AT&T and T-Mobile', "Where are Nike's competitors advertising?"],
  },
}

/** A small line icon for each kind of report. */
const ICON_PATHS: Record<string, string[]> = {
  advertiser_trend: ['M3 17l6-6 4 4 8-8', 'M15 7h6v6'],
  competitive_trend: ['M3 16l5-5 5 2 8-7', 'M3 20l6-3 5 1 7-4'],
  media_mix: ['M12 3a9 9 0 1 0 9 9h-9z', 'M15 3.5A9 9 0 0 1 20.5 9H15z'],
  competitive_mix: ['M12 3a9 9 0 1 0 9 9h-9z', 'M15 3.5A9 9 0 0 1 20.5 9H15z'],
  category_share: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  share_of_voice: ['M3 10v4h4l6 4V6l-6 4z', 'M17 9a4 4 0 0 1 0 6', 'M19.5 6.5a8 8 0 0 1 0 11'],
  zero_share: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M5.6 18.4L18.4 5.6'],
  share_of_wallet: ['M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 7l12-4v4', 'M16 13.5h2'],
  my_advertisers: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M2.5 20a6.5 6.5 0 0 1 13 0', 'M16 4.5a3.5 3.5 0 0 1 0 6.5', 'M18 14a6.5 6.5 0 0 1 3.5 6'],
  competitor_categories: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  competitor_placements: ['M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z', 'M12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'],
  detail_extract: ['M3 5h18v14H3z', 'M3 10h18', 'M3 14.5h18', 'M9 5v14'],
}
function ReportIcon({ id }: { id: string }) {
  const paths = ICON_PATHS[id]
  if (!paths) return null
  return (
    <svg className="rb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

// ---------------------------------------------------------------- formatting

function cell(type: string, v: unknown): string {
  if (v == null || v === '') return type === 'text' ? '' : '–'
  const n = Number(v)
  if (type === 'money') return '$' + Math.round(n).toLocaleString('en-US')
  if (type === 'int') return Math.round(n).toLocaleString('en-US')
  if (type === 'pct') return `${n.toFixed(1)}%`
  if (type === 'change') return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
  return String(v)
}

function short(n: number): string {
  const a = Math.abs(n)
  return '$' + (a >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 1e3 ? `${Math.round(n / 1e3)}K` : Math.round(n))
}

const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c5)', 'var(--c4)']

type Col = ViewTable['columns'][number]

/**
 * The columns as the page shows them: a column value's measures (spend,
 * occurrences, impressions for one month) share one cell, a line each. The
 * spreadsheet keeps them as separate columns.
 */
interface DCol {
  label: string
  idx: number[]
  text: boolean
}
function displayCols(cols: Col[], from = 0): DCol[] {
  const out: DCol[] = []
  for (let i = from; i < cols.length; i++) {
    const c = cols[i]!
    const last = out[out.length - 1]
    const prev = i > from ? cols[i - 1] : undefined
    if (c.group && c.measure && last && prev?.group === c.group && prev.measure) {
      last.idx.push(i)
      last.label = c.group
    } else out.push({ label: c.label, idx: [i], text: c.type === 'text' })
  }
  return out
}

/** The measures stacked in each cell, in order, when there are several. */
function stackedMeasures(cols: Col[], dcols: DCol[]): string[] {
  const d = dcols.find((x) => x.idx.length > 1)
  return d ? d.idx.map((i) => cols[i]!.measure ?? cols[i]!.label) : []
}

const numCls = (type: string, v: unknown) => 'rb-n' + (type === 'change' && v != null ? (Number(v) >= 0 ? ' rb-up' : ' rb-down') : '')

function Cell({ cols, d, row }: { cols: Col[]; d: DCol; row: unknown[] }) {
  if (d.idx.length === 1) {
    const i = d.idx[0]!
    const t = cols[i]!.type
    return <td className={t === 'text' ? '' : numCls(t, row[i])}>{cell(t, row[i])}</td>
  }
  return (
    <td className="rb-n">
      <span className="rb-stack">
        {d.idx.map((i, k) => (
          <span key={i} className={`rb-m${k}`}>
            {cell(cols[i]!.type, row[i])}
          </span>
        ))}
      </span>
    </td>
  )
}

function StackLegend({ measures }: { measures: string[] }) {
  if (measures.length < 2) return null
  return (
    <p className="rb-stacklegend">
      Each cell:{' '}
      {measures.map((m, k) => (
        <span key={m} className={`rb-m${k}`}>
          {m}
        </span>
      ))}
    </p>
  )
}

/** A trend line when the columns are periods; bars of each row's total otherwise. */
function Chart({ table }: { table: ViewTable }) {
  const text = table.columns.filter((c) => c.type === 'text').length
  const label = (r: unknown[]) =>
    r
      .slice(0, text)
      .filter(Boolean)
      .map(String)
      .join(' · ')
  // The period columns of the first measure (with several, each period has one per measure).
  const firstMeasure = table.columns.find((c) => c.colId && c.measure)?.measure
  const timeIdx = table.columns
    .map((c, i) => (c.colId && /^\d{4}(-?\d{2}(-\d{2})?|-Q\d)?$/.test(c.colId) && c.type === 'money' && (!firstMeasure || c.measure === firstMeasure) ? i : -1))
    .filter((i) => i >= 0)
  if (!table.rows.length || !table.columns.some((c) => c.type === 'money')) return null
  const W = 640
  const H = 190
  const L = 58
  const R = 14
  const T = 10
  const B = 24

  if (timeIdx.length >= 3) {
    const series = table.rows.slice(0, 5)
    const max = Math.max(1, ...series.flatMap((r) => timeIdx.map((i) => Number(r[i]) || 0)))
    const x = (j: number) => L + (j * (W - L - R)) / (timeIdx.length - 1)
    const y = (v: number) => T + (H - T - B) * (1 - v / max)
    return (
      <figure className="rb-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Trend by period">
          {[0, 1, 2, 3, 4].map((g) => (
            <g key={g}>
              <line x1={L} x2={W - R} y1={y((max * g) / 4)} y2={y((max * g) / 4)} stroke="var(--line)" strokeDasharray={g ? '3 3' : undefined} />
              <text x={L - 6} y={y((max * g) / 4) + 4} textAnchor="end">
                {short((max * g) / 4)}
              </text>
            </g>
          ))}
          <text x={x(0)} y={H - 6}>
            {table.columns[timeIdx[0]!]!.label}
          </text>
          <text x={x(timeIdx.length - 1)} y={H - 6} textAnchor="end">
            {table.columns[timeIdx[timeIdx.length - 1]!]!.label}
          </text>
          {series.map((r, k) => (
            <g key={k}>
              <polyline points={timeIdx.map((i, j) => `${x(j)},${y(Number(r[i]) || 0)}`).join(' ')} fill="none" stroke={SERIES[k % SERIES.length]} strokeWidth={2} strokeLinejoin="round" />
              <circle cx={x(timeIdx.length - 1)} cy={y(Number(r[timeIdx[timeIdx.length - 1]!]) || 0)} r={3.5} fill={SERIES[k % SERIES.length]} />
            </g>
          ))}
        </svg>
        <figcaption className="rb-legend">
          {series.map((r, k) => (
            <span key={k}>
              <i style={{ background: SERIES[k % SERIES.length] }} />
              {label(r)}
            </span>
          ))}
          {table.rows.length > 5 ? <span className="rb-muted">Top 5 shown</span> : null}
        </figcaption>
      </figure>
    )
  }

  const vi = table.columns.findIndex((c) => c.type === 'money' && (c.key === 'spend' || c.key === 'total' || c.key === 'total:spend'))
  const rows = table.rows.slice(0, 8)
  if (vi < 0 || rows.length < 2) return null
  const max = Math.max(1, ...rows.map((r) => Number(r[vi]) || 0))
  const bh = 20
  const gap = 6
  const LW = 190
  const h = T + rows.length * (bh + gap)
  return (
    <figure className="rb-chart">
      <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label={table.columns[vi]!.label}>
        {rows.map((r, k) => {
          const yy = T + k * (bh + gap)
          const w = Math.max(2, ((W - LW - 74) * (Number(r[vi]) || 0)) / max)
          return (
            <g key={k}>
              <text x={LW - 8} y={yy + 14} textAnchor="end">
                {label(r).slice(0, 30)}
              </text>
              <rect x={LW} y={yy} width={w} height={bh} rx={3} fill={k === 0 ? 'var(--c1)' : 'var(--brand-2)'} opacity={k === 0 ? 1 : 0.55} />
              <text x={LW + w + 6} y={yy + 14}>
                {short(Number(r[vi]) || 0)}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="rb-legend">
        <span className="rb-muted">
          {table.columns[vi]!.label}
          {table.rows.length > 8 ? ' · top 8 shown' : ''}
        </span>
      </figcaption>
    </figure>
  )
}

function Table({ table, max }: { table: ViewTable; max: number }) {
  const rows = table.rows.slice(0, max)
  const dcols = displayCols(table.columns)
  return (
    <div>
      <StackLegend measures={stackedMeasures(table.columns, dcols)} />
      <div className="rb-tablewrap">
        <table className="rb-table">
          <thead>
            <tr>
              {dcols.map((d) => (
                <th key={d.idx[0]} className={d.text ? '' : 'rb-n'}>
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {dcols.map((d) => (
                  <Cell key={d.idx[0]} cols={table.columns} d={d} row={r} />
                ))}
              </tr>
            ))}
            {table.totals ? (
              <tr className="rb-total">
                {dcols.map((d) => (
                  <Cell key={d.idx[0]} cols={table.columns} d={d} row={table.totals!} />
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {table.rowCount > rows.length ? (
        <p className="rb-muted rb-cap">
          Showing {rows.length} of {table.rowCount.toLocaleString('en-US')} rows. Totals cover every row; the download has them all.
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- the competitive set

type Hit = { id: string; label: string; kind: string; context: string }

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch('/prototypes/report-builder/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `The server said ${res.status}.`)
  return json
}

/** Adds a name to one side of the set: type, pick from what matches. */
function CompAdd({ side, set, onAdd }: { side: 'mine' | 'versus'; set: SetKind; onAdd: (h: Hit) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)
  async function look(e: FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true)
    try {
      setHits(await post<Hit[]>({ compSearch: { q, side, set } }))
    } catch {
      setHits([])
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="rb-compadd">
      <form className="rb-row" onSubmit={look}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={set === 'brands' ? (side === 'mine' ? 'Add a brand or advertiser' : 'Add an advertiser or category') : side === 'mine' ? 'Add a property or owner' : 'Add a property, media, owner or market'}
          aria-label={side === 'mine' ? 'Add one of yours' : 'Add a competitor'}
        />
        <button type="submit" className="btn rb-small" disabled={busy || !q.trim()}>
          {busy ? '…' : 'Find'}
        </button>
      </form>
      {hits ? (
        <div className="rb-hits">
          {!hits.length ? <span className="rb-muted">Nothing matches.</span> : null}
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              className="rb-hit"
              onClick={() => {
                onAdd(h)
                setHits(null)
                setQ('')
              }}
            >
              <b>{h.label}</b>
              <small>
                {h.kind}
                {h.context && h.context !== h.kind ? ` · ${h.context}` : ''}
              </small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The person's competitive set, edited here. Publisher Intel: their properties
 * and the competing ones. Competitive Intel: their brands and competitors.
 */
function CompPanel({ comp, setComp, set }: { comp: CompSetView | null; setComp: (c: CompSetView | null) => void; set: SetKind }) {
  const [err, setErr] = useState<string | null>(null)
  const brands = set === 'brands'
  async function change(edit: Record<string, unknown>) {
    setErr(null)
    try {
      setComp((await post<{ compSet: CompSetView | null }>({ compEdit: { ...edit, set } })).compSet)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const chip = (x: { id: string; label: string; kind: string }) => (
    <span key={x.id} className="rb-compchip" title={x.kind}>
      {x.kind === 'Property' || x.kind === 'Advertiser' ? '' : <small>{x.kind}</small>}
      {x.label}
      <button type="button" aria-label={`Remove ${x.label}`} onClick={() => void change({ op: 'remove', id: x.id })}>
        ×
      </button>
    </span>
  )
  return (
    <div className="rb-panel">
      <p className="rb-muted">{brands ? 'Used by every competitive report.' : 'Used by every publisher report.'} You&apos;ll be asked to confirm it each time.</p>
      <div className="rb-eyebrow">{brands ? 'Your brands' : 'Your properties'}</div>
      <div className="rb-compchips">{comp?.mine.length ? comp.mine.map(chip) : <span className="rb-muted">None yet</span>}</div>
      <CompAdd side="mine" set={set} onAdd={(h) => void change({ op: 'add', side: 'mine', id: h.id, label: h.label })} />
      <div className="rb-eyebrow">Competitors</div>
      {brands ? null : (
        <label className="rb-check">
          <input type="checkbox" checked={comp ? comp.all : true} onChange={(e) => void change({ op: 'all', value: e.target.checked })} /> Every other property
        </label>
      )}
      <div className="rb-compchips">{comp?.versus.length ? comp.versus.map(chip) : brands ? <span className="rb-muted">None yet</span> : null}</div>
      <CompAdd side="versus" set={set} onAdd={(h) => void change({ op: 'add', side: 'versus', id: h.id, label: h.label })} />
      {err ? <p className="rb-notes">{err}</p> : null}
      {comp ? (
        <button type="button" className="btn rb-small rb-danger" onClick={() => void change({ op: 'clear' })}>
          Clear the set
        </button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- the tree

type Branch = { state: 'loading' } | { state: 'error'; message: string } | { state: 'done'; table: ViewTable }

/**
 * A report broken out by more than one thing (advertiser, then property), as
 * a tree: the top level first, with each row's next level fetched when it is
 * opened. Every level uses the same columns as the top, so they line up.
 */
function TreeTable({ tree, max }: { tree: ViewTree; max: number }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [branches, setBranches] = useState<Map<string, Branch>>(new Map())
  const top = tree.top
  const depth = tree.dims.length
  // Number columns, as the top level has them (its one name column dropped).
  const dcols = displayCols(top.columns, 1)
  const measures = stackedMeasures(top.columns, dcols)
  const numCols = (level: number) => displayCols(top.columns, 1).map((d) => ({ ...d, idx: d.idx.map((i) => i + level) }))

  async function toggle(path: string[]) {
    const k = path.join('|')
    const next = new Set(open)
    if (next.has(k)) {
      next.delete(k)
      setOpen(next)
      return
    }
    next.add(k)
    setOpen(next)
    if (branches.has(k) && branches.get(k)!.state !== 'error') return
    setBranches((m) => new Map(m).set(k, { state: 'loading' }))
    try {
      const res = await fetch('/prototypes/report-builder/api', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expand: { spec: tree.spec, path, colIds: tree.colIds } }),
      })
      const json = (await res.json().catch(() => ({}))) as ViewTable & { error?: string }
      if (!res.ok) throw new Error(json.error ?? `The server said ${res.status}.`)
      setBranches((m) => new Map(m).set(k, { state: 'done', table: json }))
    } catch (err) {
      setBranches((m) => new Map(m).set(k, { state: 'error', message: (err as Error).message }))
    }
  }

  const span = dcols.length + 1
  function rowsOf(table: ViewTable, level: number, parent: string[], limit: number): ReactNode[] {
    const out: ReactNode[] = []
    const cols = numCols(level)
    table.rows.slice(0, limit).forEach((r, i) => {
      const key = table.keys?.[i]?.[level]
      const path = key ? [...parent, key] : null
      const k = path?.join('|') ?? `${parent.join('|')}#${i}`
      const leaf = level >= depth - 1 || !path
      const isOpen = !leaf && open.has(k)
      out.push(
        <tr key={k} className={level ? 'rb-sub' : undefined}>
          <td className="rb-treecell" style={{ paddingLeft: 12 + level * 20 }}>
            {leaf ? (
              <span className="rb-twig" />
            ) : (
              <button type="button" className="rb-twist" aria-expanded={isOpen} aria-label={isOpen ? 'Collapse' : 'Expand'} onClick={() => void toggle(path!)}>
                {isOpen ? '▾' : '▸'}
              </button>
            )}
            {String(r[level] ?? '').trim() || <span className="rb-muted">Not named</span>}
          </td>
          {cols.map((d) => (
            <Cell key={d.idx[0]} cols={table.columns} d={d} row={r} />
          ))}
        </tr>,
      )
      if (isOpen) {
        const b = branches.get(k)
        if (!b || b.state === 'loading')
          out.push(
            <tr key={`${k}:wait`} className="rb-sub">
              <td colSpan={span} className="rb-muted" style={{ paddingLeft: 32 + level * 20 }}>
                Loading…
              </td>
            </tr>,
          )
        else if (b.state === 'error')
          out.push(
            <tr key={`${k}:err`} className="rb-sub">
              <td colSpan={span} className="rb-muted" style={{ paddingLeft: 32 + level * 20 }}>
                {b.message}
              </td>
            </tr>,
          )
        else {
          out.push(...rowsOf(b.table, level + 1, path!, 100))
          if (b.table.rowCount > Math.min(100, b.table.rows.length))
            out.push(
              <tr key={`${k}:more`} className="rb-sub">
                <td colSpan={span} className="rb-muted" style={{ paddingLeft: 32 + level * 20 }}>
                  Top {Math.min(100, b.table.rows.length)} of {b.table.rowCount.toLocaleString('en-US')} shown; the download has them all.
                </td>
              </tr>,
            )
        }
      }
    })
    return out
  }

  return (
    <div>
      <StackLegend measures={measures} />
      <div className="rb-tablewrap">
        <table className="rb-table rb-tree">
          <thead>
            <tr>
              <th>{tree.dims.map((d) => d.label).join(' › ')}</th>
              {dcols.map((d) => (
                <th key={d.idx[0]} className="rb-n">
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsOf(top, 0, [], max)}
            {top.totals ? (
              <tr className="rb-total">
                <td>Total</td>
                {dcols.map((d) => (
                  <Cell key={d.idx[0]} cols={top.columns} d={d} row={top.totals!} />
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {top.rowCount > Math.min(max, top.rows.length) ? (
        <p className="rb-muted rb-cap">
          Showing {Math.min(max, top.rows.length)} of {top.rowCount.toLocaleString('en-US')} {tree.dims[0]!.label.toLowerCase()} rows. Open a row to see what is under it; the download lists every combination.
        </p>
      ) : (
        <p className="rb-muted rb-cap">Open a row to see what is under it; the download lists every combination.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- the text box hint

/**
 * What the text box suggests, from where the conversation is: the buttons
 * cover the usual answers, so the hint shows what else can be typed.
 */
function hintFor(view: View | null | undefined, editing: boolean): string {
  if (!view) return 'Describe a report, for example "media mix for Toyota, last 3 months"'
  if (view.kind === 'question') {
    const q = (view.question ?? '').toLowerCase()
    if (q.includes('kind of report')) return 'Or describe it: "spend trend for fast food" or "who isn\'t buying on ESPN?"'
    if (q.includes('who do you compete with')) return 'Or type them: "Honda and Ford", "all of vehicle insurance" or "the cars category"'
    if (q.includes('brands are yours')) return 'Or type yours: "Toyota", "Progressive" or "Big Mac"'
    if (q.includes('compete with')) return 'Or type them: "CBS and Fox", "all Cable TV", "everything in the New York market"'
    if (q.includes('usual competitive set')) return 'Or say what to change: "add Hulu to my competitors", "compare with everything"'
    if (q.includes('properties are yours')) return 'Or type your networks: "NBC", "Hulu" or "ESPN and ESPN2"'
    if (q.includes('time period')) return 'Or type a period: "last 4 weeks", "August to October" or "year to date"'
    if (q.includes('category')) return 'Or type a category: "fast food", "car insurance" or "pizza restaurants"'
    if (view.acceptsName) return 'Or type a name: an advertiser ("Toyota"), a brand ("Big Mac") or a category ("fast food")'
    return 'Pick one above, or say what you want instead'
  }
  if (view.kind === 'problem') return 'Pick a fix above, or say what you want instead: "drop the columns"'
  if (view.kind === 'ready') return 'Change it in your own words: "by daypart", "only Prime Time", "by market", "30-second spots only" or "run it"'
  if (view.kind === 'run') return editing ? 'Say "save changes", or keep adjusting: "by product", "latest month only"' : 'Say "save it as Toyota mix", or keep adjusting: "by network", "add impressions"'
  if (view.kind === 'saved') return 'Start another: "category share for pizza restaurants", or "run my saved reports"'
  return 'Describe a report, or ask to run a saved one'
}

// ---------------------------------------------------------------- the page

export function ReportBuilderChat({
  initialSaved,
  initialThrough,
  initialComp,
  initialBrands,
  initialMode,
  chatLink,
  modelReady,
  live,
}: {
  initialSaved: SavedItem[]
  initialThrough: string
  initialComp: CompSetView | null
  initialBrands: CompSetView | null
  initialMode: IntelMode
  chatLink: string | null
  modelReady: boolean
  live: boolean
}) {
  const [mode, setMode] = useState<IntelMode>(initialMode)
  const [importing, setImporting] = useState(false)
  const [comp, setComp] = useState<CompSetView | null>(initialComp)
  const [brandSet, setBrandSet] = useState<CompSetView | null>(initialBrands)
  const [chatId, setChatId] = useState(newId)
  const [messages, setMessages] = useState<Message[]>([])
  const [panel, setPanel] = useState<PageReply['panel'] | null>(null)
  const [saved, setSaved] = useState<SavedItem[]>(initialSaved)
  const [through, setThrough] = useState(initialThrough)
  const [busy, setBusy] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [tab, setTab] = useState<'report' | 'saved' | 'comp'>('report')
  const [naming, setNaming] = useState<string | null>(null)
  const [arming, setArming] = useState<string | null>(null)
  const seq = useRef(0)
  const logRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  const push = (m: Omit<Message, 'id'>) => setMessages((all) => [...all, { ...m, id: ++seq.current }])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  function take(r: PageReply) {
    push({ role: 'assistant', text: r.text, view: r.view })
    if (r.panel) setPanel(r.panel)
    if (r.saved) setSaved(r.saved)
    if (r.dataThrough) setThrough(r.dataThrough)
    if (r.compSet !== undefined) setComp(r.compSet)
    if (r.brandSet !== undefined) setBrandSet(r.brandSet)
  }

  async function send(body: { action?: Action; turns?: Array<{ role: string; content: string }> }, id = chatId) {
    const res = await fetch('/prototypes/report-builder/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: id, ...body }),
    })
    const json = (await res.json().catch(() => ({}))) as PageReply & { error?: string }
    if (!res.ok) throw new Error(json.error ?? `The server said ${res.status}.`)
    return json
  }

  /** A click: shown as the person's words, applied directly. */
  async function act(action: Action, said: string | null, id = chatId) {
    if (busy) return
    if (said) push({ role: 'user', text: said })
    setBusy('Updating')
    try {
      take(await send({ action }, id))
    } catch (err) {
      push({ role: 'assistant', text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  /** A typed message: the model reads the conversation so far. */
  async function ask(text: string) {
    if (busy || !text.trim()) return
    const turns = [...messages.filter((m) => m.role !== 'note').map((m) => ({ role: m.role, content: m.text })), { role: 'user', content: text }]
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
    setPanel(null)
    setNaming(null)
    void act({ type: 'start', mode: next }, null, id)
  }

  /** Switching between Publisher and Competitive Intel starts a new report in that mode. */
  function switchMode(next: IntelMode) {
    if (next === mode || busy) return
    setMode(next)
    startOver(next)
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    void act({ type: 'start', mode }, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void ask(input)
  }

  return (
    <>
      <div className="titlerow rb-titlerow">
        <div>
          <Kicker>Prototypes</Kicker>
          <div className="rb-titleline">
            <h1>Report Builder</h1>
            <div className="rb-modes" role="group" aria-label="Kind of client">
              {(Object.keys(MODES) as IntelMode[]).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} disabled={!!busy && mode !== m} onClick={() => switchMode(m)}>
                  {MODES[m].label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {chatLink ? (
          <a className="rb-muted rb-cap" href={chatLink} target="report-builder" rel="noopener">
            Also in the chat window, as text
          </a>
        ) : null}
      </div>
      <div className="rb-frame">
        <section className="rb-chatcard" aria-label="Conversation">
          <div className="rb-chathead">
            <span className="rb-muted">{panel?.editing ? `Editing ${panel.editing}` : panel && panel.status !== 'empty' ? panel.name : 'New report'}</span>
            <span className="rb-row">
              {live ? (
                <button type="button" className="btn rb-small" disabled={!!busy} onClick={() => setImporting(true)}>
                  Import from 360
                </button>
              ) : null}
              <button type="button" className="btn rb-small" disabled={!!busy} onClick={() => startOver()}>
                + New report
              </button>
            </span>
          </div>
          {importing ? (
            <Import360
              onClose={() => setImporting(false)}
              onImported={(out) => {
                setImporting(false)
                setSaved(out.saved)
                void act({ type: 'run_saved', report: out.id }, `Import and run "${out.name}"`)
              }}
            />
          ) : null}
          <div className="rb-log" ref={logRef} aria-live="polite">
            <div className="rb-msg rb-bot">
              <p>{MODES[mode].hello}</p>
            </div>
            {messages.map((m) => (
              <MessageView
                key={m.id}
                m={m}
                live={m === lastAssistant && !busy}
                panel={panel}
                onChoose={(label) => act({ type: 'choose', choice: label }, label)}
                onRun={() => act({ type: 'run', name: panel?.name }, 'Run the full report')}
                onSave={() => setNaming(panel?.name || 'My report')}
                onNew={() => startOver()}
                onSaveComp={(label) => act({ type: 'save_comp_set' }, label)}
              />
            ))}
            {messages.length <= 1 && !busy ? (
              <div className="rb-msg rb-bot">
                <span className="rb-label">Or try asking:</span>
                <div className="rb-grid">
                  {MODES[mode].examples.map((e) => (
                    <button key={e} type="button" className="rb-choice rb-quiet" disabled={!modelReady} title={modelReady ? undefined : 'Needs a model to be configured'} onClick={() => ask(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {naming !== null ? (
              <form
                className="rb-msg rb-bot rb-naming"
                onSubmit={(e) => {
                  e.preventDefault()
                  const name = naming.trim() || 'My report'
                  setNaming(null)
                  void act({ type: 'save', name, replace: Boolean(panel?.editing) }, `Save it as "${name}"`)
                }}
              >
                <label htmlFor="rb-name">{panel?.editing ? `Save changes to "${panel.editing}", or rename to save a copy:` : 'Name this report:'}</label>
                <div className="rb-row">
                  <input id="rb-name" value={naming} onChange={(e) => setNaming(e.target.value)} autoFocus />
                  <button type="submit" className="btn btn-primary">
                    Save
                  </button>
                  <button type="button" className="btn" onClick={() => setNaming(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
            {busy ? <div className="rb-msg rb-bot rb-thinking">{busy}…</div> : null}
          </div>
          <form className="rb-compose" onSubmit={submit}>
            <input
              id="rb-ask"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={modelReady ? hintFor(lastAssistant?.view, Boolean(panel?.editing)) : 'Typing needs a model to be configured; the buttons work without one'}
              aria-label="Message"
              disabled={!modelReady}
            />
            <button type="submit" className="btn btn-primary" disabled={!modelReady || !!busy || !input.trim()}>
              Send
            </button>
          </form>
        </section>

        <aside className="rb-rail" aria-label="Report details">
          <div className="rb-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'report'} onClick={() => setTab('report')}>
              Your report
            </button>
            <button type="button" role="tab" aria-selected={tab === 'saved'} onClick={() => setTab('saved')}>
              Saved reports{saved.length ? ` (${saved.length})` : ''}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'comp'} onClick={() => setTab('comp')}>
              Competitive set
            </button>
          </div>
          {tab === 'comp' ? (
            mode === 'buyer' ? <CompPanel key="brands" set="brands" comp={brandSet} setComp={setBrandSet} /> : <CompPanel key="properties" set="properties" comp={comp} setComp={setComp} />
          ) : tab === 'report' ? (
            <div className="rb-panel">
              {!panel || panel.status === 'empty' ? (
                <p className="rb-muted">Your report takes shape here as you answer. When it looks right, run it, download it, or save it to run again whenever new data arrives.</p>
              ) : (
                <>
                  <div className="rb-eyebrow">{panel.editing ? 'Editing saved report' : 'Report being built'}</div>
                  <div className="rb-name">{panel.editing ?? panel.name}</div>
                  <dl className="rb-dl">
                    <dt>Status</dt>
                    <dd>
                      <span className={`rb-status rb-${panel.status}`}>{panel.statusText}</span>
                    </dd>
                    {panel.rows.map((r) => (
                      <div key={r.label} className="rb-dlrow">
                        <dt>{r.label}</dt>
                        <dd>
                          {r.groups
                            ? r.groups.map((g) => (
                                <div key={g.label} className="rb-group">
                                  <b>{g.label}:</b> {g.items}
                                </div>
                              ))
                            : r.value}
                        </dd>
                      </div>
                    ))}
                    <dt>Period</dt>
                    <dd>
                      {panel.period ?? 'Not chosen yet'}{' '}
                      {panel.period ? <span className={`rb-pill${panel.picksUpNewData ? ' rb-live' : ''}`}>{panel.picksUpNewData ? 'updates with new data' : 'fixed'}</span> : null}
                    </dd>
                  </dl>
                </>
              )}
            </div>
          ) : (
            <div className="rb-panel">
              <p className="rb-muted">Run a saved report any time to get it on the newest data.</p>
              {!saved.length ? <p className="rb-muted">None yet. Build a report and choose Save report.</p> : null}
              {saved.map((s) => (
                <div key={s.id} className="rb-saved">
                  <div className="rb-row">
                    <b>{s.name}</b>
                    <span className={`rb-pill${s.picksUpNewData ? ' rb-live' : ''}`}>{s.picksUpNewData ? 'updates with new data' : 'fixed period'}</span>
                    {s.imported ? <span className="rb-pill rb-from360">From 360</span> : null}
                  </div>
                  <p className="rb-muted">{s.summary}</p>
                  {s.imported ? (
                    <details className="rb-imp-saved">
                      <summary>
                        From {s.imported.type.toLowerCase()} &ldquo;{s.imported.report}&rdquo; ({s.imported.client}, {s.imported.user}): {s.imported.notes.length} changes
                      </summary>
                      <ul className="rb-imp-notes">
                        {s.imported.notes.map((n, i) => (
                          <li key={i}>
                            <span className={`rb-imp-tag rb-imp-${n.impact}`}>{n.impact}</span>
                            <span>
                              <b>{n.what}.</b> {n.why} {n.did}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  <p className="rb-muted rb-cap">{s.lastRun ? `Last run: ${s.lastRun}` : 'Not run yet'}</p>
                  <div className="rb-row">
                    <button type="button" className="btn" disabled={!!busy} onClick={() => act({ type: 'run_saved', report: s.id }, `Run ${s.name}`)}>
                      Run
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={!!busy}
                      onClick={() => {
                        setTab('report')
                        void act({ type: 'open_saved', report: s.id }, `Change ${s.name}`)
                      }}
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      className="btn rb-danger"
                      disabled={!!busy}
                      onClick={() => {
                        if (arming !== s.id) return setArming(s.id)
                        setArming(null)
                        void act({ type: 'delete_saved', report: s.id }, `Delete ${s.name}`)
                      }}
                    >
                      {arming === s.id ? 'Confirm delete' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="rb-railfoot">
            <span className="rb-muted">{live ? `Live data, complete through ${through}` : `Final data through ${through}`}</span>
            {live ? null : (
              <button type="button" className="btn rb-small" disabled={!!busy} title="For demonstrations: pretend next month's data has arrived" onClick={() => act({ type: 'demo_month' }, 'Demo: load next month of data')}>
                Demo: load next month
              </button>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}

function MessageView({
  m,
  live,
  panel,
  onChoose,
  onRun,
  onSave,
  onNew,
  onSaveComp,
}: {
  m: Message
  live: boolean
  panel: PageReply['panel'] | null
  onChoose: (label: string) => void
  onRun: () => void
  onSave: () => void
  onNew: () => void
  onSaveComp: (label: string) => void
}) {
  if (m.role === 'user') {
    return (
      <div className="rb-msg rb-me">
        <div className="rb-bubble">{m.text}</div>
      </div>
    )
  }
  const v = m.view
  const choices = v?.choices ?? []
  return (
    <div className="rb-msg rb-bot">
      {v?.title && (v.kind === 'ready' || v.kind === 'run') ? <p className="rb-summary">{v.savedName ? `${v.savedName}: ` : ''}{v.title}</p> : null}
      {v?.kind === 'run' && v.sinceLastRun ? <p className="rb-since">{v.sinceLastRun}</p> : null}
      <MarkdownView text={m.text} />
      {v?.table && (v.kind === 'ready' || v.kind === 'run') ? (
        <div className="rb-result">
          <Chart table={v.tree ? v.tree.top : v.table} />
          {v.tree ? <TreeTable tree={v.tree} max={v.kind === 'run' ? 25 : 10} /> : <Table table={v.table} max={v.kind === 'run' ? 25 : 10} />}
          {v.downloadUrl ? (
            <div className="rb-row">
              <span className="rb-muted">Download</span>
              <a className="btn" href={`${v.downloadUrl}&format=xlsx`}>
                Excel
              </a>
              <a className="btn" href={`${v.downloadUrl}&format=pdf`}>
                PDF
              </a>
              <a className="btn" href={`${v.downloadUrl}&format=csv`}>
                CSV
              </a>
              <span className="rb-muted">
                {v.table.rowCount.toLocaleString('en-US')} rows · {v.period}
              </span>
            </div>
          ) : null}
          {v.notes?.length ? <p className="rb-notes">{Array.from(new Set(v.notes)).join(' ')}</p> : null}
        </div>
      ) : null}
      {live && (v?.kind === 'question' || v?.kind === 'problem') && choices.length ? (
        <div className="rb-grid">
          {choices.map((c) => (
            <button key={c.number} type="button" className={`rb-choice${c.icon ? ' rb-withicon' : ''}`} onClick={() => onChoose(c.label)}>
              {c.icon ? <ReportIcon id={c.icon} /> : null}
              <span className="rb-choicetext">
                <b>{c.label}</b>
                {c.description ? <small>{c.description}</small> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {live && v?.kind === 'question' && v.acceptsName ? <span className="rb-label">Or type a name below.</span> : null}
      {live && (v?.kind === 'ready' || v?.kind === 'run' || v?.kind === 'saved') ? (
        <>
          <div className="rb-row">
            {v.kind === 'ready' ? (
              <button type="button" className="btn btn-primary" onClick={onRun}>
                Run full report
              </button>
            ) : null}
            {v.kind !== 'saved' && panel && panel.status === 'ready' ? (
              <button type="button" className={`btn${v.kind === 'run' ? ' btn-primary' : ''}`} onClick={onSave}>
                {panel.editing ? 'Save changes' : 'Save report'}
              </button>
            ) : null}
            <button type="button" className="btn" onClick={onNew}>
              Start a new report
            </button>
          </div>
          {v.compSetOffer ? (
            <div className="rb-row rb-compoffer">
              <span className="rb-muted">{v.compSetOffer.text}</span>
              <button type="button" className="btn rb-small" onClick={() => onSaveComp(v.compSetOffer!.kind === 'save' ? 'Save as my competitive set' : 'Make this my usual competitive set')}>
                {v.compSetOffer.kind === 'save' ? 'Save as my competitive set' : 'Make this my usual set'}
              </button>
            </div>
          ) : null}
          {v.kind === 'ready' && choices.length ? (
            <>
              <span className="rb-label">Or adjust it:</span>
              <div className="rb-chips">
                {choices.map((c) => (
                  <button key={c.number} type="button" className="rb-chip" onClick={() => onChoose(c.label)}>
                    {c.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
