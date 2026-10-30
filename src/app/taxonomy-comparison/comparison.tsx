'use client'

/**
 * The FROM picker and paste box, the progress while a run works, and a
 * Sankey per advertiser: FROM entity → GPC advertisers → GPC taxonomy nodes.
 *
 * Progress is polled from the run's row every two seconds (actions.ts
 * pollRun): the work happens in the server process, not in this request.
 */
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  filterFlows,
  flowTotal,
  FROM_TAXONOMIES,
  GPC_BY_LABEL,
  MAX_ADVERTISERS,
  MEDIA_TYPES,
  money,
  MONTH_LABEL,
  MONTHS,
  NO_GPC,
  NODE_LEVEL_LABEL,
  NODE_LEVELS,
  OTHER,
  pct,
  rankAdvertisers,
  rankNodes,
  sankeyData,
  TAXONOMY_LABEL,
  UNCLASSIFIED,
  type AdvertiserResult,
  type Candidate,
  type Flag,
  type FromTaxonomy,
  type GpcBy,
  type MediaType,
  type Month,
  type NodeLevel,
  type Ranked,
  type SankeyData,
  type Step,
} from '@/lib/taxonomy-rules'
import type { RunView } from '@/lib/taxonomy-run'
import { pickEntity, pollRun, startComparison, type StartState } from './actions'

export function Comparison({ initial }: { initial: RunView | null }) {
  const router = useRouter()
  const [state, submit, pending] = useActionState<StartState, FormData>(startComparison, {})
  const [run, setRun] = useState<RunView | null>(initial)

  useEffect(() => {
    if (state.runId) router.replace(`/taxonomy-comparison?run=${state.runId}`)
  }, [state.runId, router])

  useEffect(() => {
    if (!run || run.status !== 'running') return
    const t = setTimeout(async () => {
      const next = await pollRun(run.id)
      if (next) setRun(next)
    }, 2000)
    return () => clearTimeout(t)
  }, [run])

  return (
    <>
      <form action={submit} className="tile tx-form">
        <div className="tx-from">
          <label className="tx-from-pick">
            <span className="tx-muted">From</span>
            <select name="from" className="tx-select" defaultValue={initial?.input.from ?? 'VX1'}>
              {FROM_TAXONOMIES.map((t) => (
                <option key={t} value={t}>
                  {TAXONOMY_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <span className="tx-arrow" aria-hidden>
            →
          </span>
          <span className="tx-to">GPC</span>
        </div>
        <textarea
          name="advertisers"
          className="tx-input"
          rows={5}
          placeholder={'One advertiser per line, e.g.\nProgressive\nProcter & Gamble\nToyota'}
          defaultValue={initial?.input.names.join('\n') ?? ''}
          title={`Up to ${MAX_ADVERTISERS} advertisers. Aug–Sep 2026, advertiser level.`}
        />
        <div className="tx-form-foot">
          <span className="tx-muted">Aug–Sep 2026 · Digital, Social, Linear TV, CTV</span>
          {state.error ? <span className="status crit">{state.error}</span> : null}
          <button type="submit" className="btn btn-primary" disabled={pending || run?.status === 'running'}>
            {pending ? 'Starting…' : 'Compare'}
          </button>
        </div>
      </form>

      {run ? (
        run.outdated ? (
          <div className="blank">
            <h2>Made with the earlier version</h2>
            <p>Pick a FROM taxonomy and compare again.</p>
          </div>
        ) : run.status === 'done' && run.result ? (
          <Results run={run} onChange={setRun} />
        ) : (
          <Progress steps={run.steps} failed={run.status === 'failed' ? (run.error ?? 'The comparison failed.') : null} />
        )
      ) : null}
    </>
  )
}

function Progress({ steps, failed }: { steps: Step[]; failed: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const done = steps.filter((s) => s.state === 'done').length
  return (
    <div className="tile">
      <div className="tile-head">
        <h2>{failed ? 'Comparison failed' : `Working… ${done} of ${steps.length}`}</h2>
      </div>
      <ol className="tx-steps">
        {steps.map((s) => {
          const secs = s.startedAt ? Math.round(((s.endedAt ? Date.parse(s.endedAt) : now) - Date.parse(s.startedAt)) / 1000) : null
          return (
            <li key={s.key} className={`tx-step ${s.state}`}>
              <span className="tx-dot" aria-hidden />
              <span>{s.label}</span>
              {s.detail ? <span className="tx-muted">{s.detail}</span> : null}
              {secs != null ? <span className="tx-muted tx-secs">{secs}s</span> : null}
            </li>
          )
        })}
      </ol>
      {failed ? <p className="status crit">{failed}</p> : null}
    </div>
  )
}

const FLAG_TONE: Record<Flag['kind'], string> = { name: 'warn', missing: 'crit', unmapped: 'crit', split: 'warn', coverage: 'quiet' }
const FLAG_LABEL: Record<Flag['kind'], string> = {
  name: 'Name differs',
  missing: 'Not found',
  unmapped: 'No GPC advertiser',
  split: 'Split in GPC',
  coverage: 'Classic',
}

function Results({ run, onChange }: { run: RunView; onChange: (run: RunView) => void }) {
  const result = run.result!
  const flagged = result.advertisers.filter((a) => a.flags.some((f) => f.kind !== 'coverage')).length
  return (
    <>
      <div className="tx-summary">
        <div>
          <span className="tx-big">{result.advertisers.length}</span> advertisers · {TAXONOMY_LABEL[result.from]} → GPC ·{' '}
          <span className={flagged ? 'tx-warn' : ''}>{flagged} with flags</span>
        </div>
        <a className="btn" href={`/taxonomy-comparison/csv?run=${run.id}`}>
          Download CSV
        </a>
      </div>
      <p className="tx-muted tx-meta">
        Matching {result.model ? `by ${result.model}` : 'by name only'}
        {result.from === 'Classic' && result.classicLoadedAt ? ` · Classic snapshot ${result.classicLoadedAt.slice(0, 10)}, linked to creatives through Vivvix` : ''}
      </p>
      {result.advertisers.map((a) => (
        <AdvertiserCard key={a.input} a={a} from={result.from} runId={run.id} onChange={onChange} />
      ))}
    </>
  )
}

function AdvertiserCard({ a, from, runId, onChange }: { a: AdvertiserResult; from: FromTaxonomy; runId: string; onChange: (run: RunView) => void }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [media, setMedia] = useState<MediaType | ''>('')
  const [month, setMonth] = useState<Month | ''>('')
  const [level, setLevel] = useState<NodeLevel>('category')
  const [gpcBy, setGpcBy] = useState<GpcBy>('advertiser')

  const pick = (id: string) =>
    start(async () => {
      setError(null)
      const out = await pickEntity(runId, a.input, id)
      if (out.error) setError(out.error)
      else if (out.run) onChange(out.run)
    })

  const flows = useMemo(() => filterFlows(a.flows, { media: media || null, month: month || null }), [a.flows, media, month])
  const data = useMemo(() => sankeyData(flows, level, 7, gpcBy), [flows, level, gpcBy])
  const e = a.entity
  const tone = !e ? 'crit' : e.kind === 'exact' ? 'good' : 'warn'

  return (
    <div className={`tile tx-card ${pending ? 'tx-busy' : ''}`}>
      <div className="tile-head">
        <h2 className="tx-title">{a.input}</h2>
        <div className="tile-right">
          {pending ? <span className="status quiet">Updating…</span> : null}
          {a.flags.some((f) => f.kind !== 'coverage') ? (
            <span className="status warn">
              {a.flags.filter((f) => f.kind !== 'coverage').length} flag{a.flags.filter((f) => f.kind !== 'coverage').length === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="status good">Clean mapping</span>
          )}
        </div>
      </div>

      <div className="tx-entity-row">
        <label className="tx-entity" title={e?.reason ?? (e ? `Exact name match (id ${e.id})` : a.missing)}>
          <span className="tx-muted">
            {TAXONOMY_LABEL[from]}
            {e?.level ? <strong className="tx-level"> · {e.level}</strong> : null}
          </span>
          {a.candidates.length ? (
            <select className={`tx-pick status ${tone}`} value={e?.id ?? ''} disabled={pending} onChange={(ev) => pick(ev.target.value)}>
              {a.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {optionLabel(c)}
                </option>
              ))}
              <option value="">None of these</option>
            </select>
          ) : (
            <span className={`status ${tone}`}>{e ? e.name : 'Not found'}</span>
          )}
        </label>
        <div className="tx-stat">
          <span className="tx-muted">Spend followed</span>
          <strong>{money(flowTotal(a.flows))}</strong>
        </div>
        {a.classicReported != null ? (
          <div className="tx-stat" title="Classic's own estimate for the same advertiser and media">
            <span className="tx-muted">Classic reports</span>
            <strong>{money(a.classicReported)}</strong>
          </div>
        ) : null}
      </div>
      {error ? <p className="status crit">{error}</p> : null}

      <p className="tx-commentary">{a.commentary}</p>

      {a.flows.length ? (
        <>
          <div className="tx-filters">
            <Seg label="Media" value={media} onChange={(v) => setMedia(v as MediaType | '')} options={[['', 'All'], ...MEDIA_TYPES.map((m) => [m, m] as [string, string])]} />
            <Seg label="Month" value={month} onChange={(v) => setMonth(v as Month | '')} options={[['', 'Both'], ...MONTHS.map((m) => [m, MONTH_LABEL[m].slice(0, 3)] as [string, string])]} />
            <Seg label="GPC advertiser" value={gpcBy} onChange={(v) => setGpcBy(v as GpcBy)} options={(['advertiser', 'parent'] as GpcBy[]).map((b) => [b, GPC_BY_LABEL[b]] as [string, string])} />
            <Seg label="GPC node" value={level} onChange={(v) => setLevel(v as NodeLevel)} options={NODE_LEVELS.map((l) => [l, NODE_LEVEL_LABEL[l]] as [string, string])} />
          </div>
          {data.total > 0 ? (
            <>
              <Sankey data={data} fromLabel={e?.name ?? a.input} gpcBy={gpcBy} />
              <div className="tx-lists">
                <RankList title={gpcBy === 'parent' ? 'GPC top parents' : 'GPC advertisers'} rows={rankAdvertisers(flows, gpcBy)} total={data.total} />
                <RankList title={`GPC ${NODE_LEVEL_LABEL[level].toLowerCase()}`} rows={rankNodes(flows, level)} total={data.total} />
              </div>
            </>
          ) : (
            <p className="tx-muted">No spend for this media and month.</p>
          )}
        </>
      ) : null}

      {a.flags.length ? (
        <ul className="tx-flags">
          {a.flags.map((f, i) => (
            <li key={i}>
              <span className={`status ${FLAG_TONE[f.kind]}`}>{FLAG_LABEL[f.kind]}</span> {f.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function Seg({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="tx-seg" role="group" aria-label={label}>
      <span className="tx-muted">{label}</span>
      {options.map(([v, l]) => (
        <button key={v} type="button" className={`tx-seg-btn ${value === v ? 'on' : ''}`} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  )
}

function RankList({ title, rows, total }: { title: string; rows: Ranked[]; total: number }) {
  return (
    <div className="tx-rank">
      <div className="tx-rank-head">{title}</div>
      <table className="tx-table">
        <tbody>
          {rows.slice(0, 12).map((r) => (
            <tr key={r.key} className={r.key === NO_GPC || r.key === UNCLASSIFIED ? 'flagged' : ''}>
              <td>{r.label}</td>
              <td className="num">{money(r.spend)}</td>
              <td className="num tx-muted">{pct(total ? r.spend / total : 0)}</td>
            </tr>
          ))}
          {rows.length > 12 ? (
            <tr>
              <td className="tx-muted" colSpan={3}>
                +{rows.length - 12} more in the CSV
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

// --- the Sankey -------------------------------------------------------------

/** Categorical slots in fixed order (validated light and dark, 30 October 2026); the tail and "none" are neutral. */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6']
const NEUTRAL = '#a3a29b'
const NONE = '#d4d3cc'

function colorFor(key: string, index: number): string {
  if (key === NO_GPC) return NONE
  if (key === OTHER) return NEUTRAL
  return SERIES[index % SERIES.length]
}

const W = 900
const NODE_W = 12
const GAP = 6
/** Every node gets at least this much height for its label, however small its spend. */
const SLOT = 18
const X = [180, 430, 660]
/** The FROM node's height; the other columns use the same dollars-per-pixel. */
const FROM_H = 300

function Sankey({ data, fromLabel, gpcBy }: { data: SankeyData; fromLabel: string; gpcBy: GpcBy }) {
  const scale = FROM_H / data.total

  const stack = (rows: Ranked[]) => {
    let y = 0
    const placed = rows.map((r) => {
      const h = Math.max(1, r.spend * scale)
      const out = { y, h, r }
      y += Math.max(h, SLOT) + GAP
      return out
    })
    return { placed, used: y - GAP }
  }
  const advStack = stack(data.advertisers)
  const nodeStack = stack(data.nodes)
  const H = Math.max(FROM_H, advStack.used, nodeStack.used)
  const centre = (st: { placed: { y: number; h: number; r: Ranked }[]; used: number }) =>
    new Map(st.placed.map((p) => [p.r.key, { ...p, y: p.y + (H - st.used) / 2 }]))
  const adv = centre(advStack)
  const nodes = centre(nodeStack)
  const leftH = FROM_H
  const leftY = (H - leftH) / 2
  const color = new Map(data.advertisers.map((r, i) => [r.key, colorFor(r.key, i)]))

  const band = (x0: number, y0: number, x1: number, y1: number, h: number) => {
    const xm = (x0 + x1) / 2
    return `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + h} C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h} Z`
  }

  // Left → advertisers, stacked down the left node in advertiser order.
  const left = data.advertisers.map((r, i) => {
    const a = adv.get(r.key)!
    const above = data.advertisers.slice(0, i).reduce((sum, p) => sum + p.spend * scale, 0)
    return { key: r.key, d: band(X[0] + NODE_W, leftY + above, X[1], a.y, r.spend * scale), r }
  })

  // Advertisers → nodes, each advertiser's links in node order, each node filled in advertiser order.
  const advCursor = new Map([...adv].map(([k, v]) => [k, v.y]))
  const nodeCursor = new Map([...nodes].map(([k, v]) => [k, v.y]))
  const order = new Map(data.nodes.map((r, i) => [r.key, i]))
  const right = data.advertisers.flatMap((ar) =>
    data.links
      .filter((l) => l.from === ar.key)
      .sort((p, q) => (order.get(p.to) ?? 0) - (order.get(q.to) ?? 0))
      .map((l) => {
        const h = l.spend * scale
        const y0 = advCursor.get(l.from)!
        advCursor.set(l.from, y0 + h)
        return { l, h, y0, from: ar.key }
      }),
  )
  const rightPaths = data.nodes.flatMap((nr) =>
    right
      .filter((x) => x.l.to === nr.key)
      .map((x) => {
        const y1 = nodeCursor.get(nr.key)!
        nodeCursor.set(nr.key, y1 + x.h)
        return { ...x, d: band(X[1] + NODE_W, x.y0, X[2], y1, x.h) }
      }),
  )

  const short = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
  const advLabel = (r: Ranked) => `${short(r.label, 26)} · ${money(r.spend)}`

  return (
    <div className="tx-sankey-wrap">
      <svg className="tx-sankey" viewBox={`0 0 ${W} ${H + 28}`} role="img" aria-label={`Where ${fromLabel}'s spend lands in GPC`}>
        <g transform="translate(0, 28)">
        {left.map((p) => (
          <path key={`l-${p.key}`} d={p.d} fill={color.get(p.key)} className="tx-link">
            <title>{`${fromLabel} → ${p.r.label}: ${money(p.r.spend)} (${pct(p.r.spend / data.total)})`}</title>
          </path>
        ))}
        {rightPaths.map((p, i) => (
          <path key={`r-${i}`} d={p.d} fill={color.get(p.from)} className="tx-link">
            <title>{`${data.advertisers.find((r) => r.key === p.from)?.label} → ${data.nodes.find((r) => r.key === p.l.to)?.label}: ${money(p.l.spend)} (${pct(p.l.spend / data.total)})`}</title>
          </path>
        ))}

        <rect x={X[0]} y={leftY} width={NODE_W} height={leftH} rx={3} className="tx-node-from" />
        <text x={X[0] - 8} y={leftY + leftH / 2} textAnchor="end" dominantBaseline="middle" className="tx-node-label strong">
          {short(fromLabel, 22)}
        </text>
        <text x={X[0] - 8} y={leftY + leftH / 2 + 16} textAnchor="end" dominantBaseline="middle" className="tx-node-label">
          {money(data.total)}
        </text>

        {data.advertisers.map((r) => {
          const a = adv.get(r.key)!
          return (
            <g key={`a-${r.key}`}>
              <rect x={X[1]} y={a.y} width={NODE_W} height={a.h} rx={3} fill={color.get(r.key)} className={r.key === NO_GPC ? 'tx-node-none' : ''}>
                <title>{`${r.label}: ${money(r.spend)} (${pct(r.spend / data.total)})`}</title>
              </rect>
              <text x={X[1] + NODE_W + 6} y={a.y + a.h / 2} dominantBaseline="middle" className="tx-node-label halo">
                {advLabel(r)}
              </text>
            </g>
          )
        })}

        {data.nodes.map((r) => {
          const nd = nodes.get(r.key)!
          return (
            <g key={`n-${r.key}`}>
              <rect x={X[2]} y={nd.y} width={NODE_W} height={nd.h} rx={3} className={r.key === UNCLASSIFIED ? 'tx-node-none' : 'tx-node-gpc'}>
                <title>{`${r.label}: ${money(r.spend)} (${pct(r.spend / data.total)})`}</title>
              </rect>
              <text x={X[2] + NODE_W + 6} y={nd.y + nd.h / 2} dominantBaseline="middle" className="tx-node-label">
                {`${short(r.label, 28)} · ${money(r.spend)}`}
              </text>
            </g>
          )
        })}

        </g>
        <text x={X[0] + NODE_W / 2} y={12} textAnchor="middle" className="tx-col-head">FROM</text>
        <text x={X[1] + NODE_W / 2} y={12} textAnchor="middle" className="tx-col-head">{gpcBy === 'parent' ? 'GPC TOP PARENT' : 'GPC ADVERTISER'}</text>
        <text x={X[2] + NODE_W / 2} y={12} textAnchor="middle" className="tx-col-head">GPC NODE</text>
      </svg>
    </div>
  )
}

function optionLabel(c: Candidate): string {
  const size = c.spend != null ? money(c.spend) : c.size
  return `${c.name}${c.level ? ` (${c.level.toLowerCase()})` : ''}${size ? ` · ${size}` : ''}${c.via ? ` · ${c.via}` : ''}`
}
