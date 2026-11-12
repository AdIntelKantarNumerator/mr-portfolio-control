'use client'

/**
 * The FROM picker and paste box, the progress while a run works, and a
 * Sankey per advertiser: FROM entity → GPC advertisers → GPC taxonomy nodes.
 *
 * Progress is polled from the run's row every two seconds (actions.ts
 * pollRun): the work happens in the server process, not in this request.
 */
import { useActionState, useEffect, useId, useMemo, useState, useTransition } from 'react'
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
  UNKNOWN_PRODUCT_ID,
  NODE_LEVEL_LABEL,
  NODE_LEVELS,
  OTHER,
  gpcTotalKey,
  gpcTotalView,
  hasMoreElsewhere,
  pct,
  summarise,
  rankAdvertisers,
  rankNodes,
  rankProducts,
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
  type GpcTotalRow,
  type GpcTotalView,
  type AdvertiserSummary,
  type Step,
} from '@/lib/taxonomy-rules'
import type { RunView, SampleCreative } from '@/lib/taxonomy-run'
import { pickEntity, pollRun, startComparison, type StartState } from './actions'
import { TreeButton } from './rollup'

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

export function Progress({ steps, failed, what = 'Comparison' }: { steps: Step[]; failed: string | null; what?: string }) {
  // The clock starts in the browser: read during the server render it would
  // differ from the first client render, and React discards the whole tree.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])
  const done = steps.filter((s) => s.state === 'done').length
  return (
    <div className="tile">
      <div className="tile-head">
        <h2>{failed ? `${what} failed` : `Working… ${done} of ${steps.length}`}</h2>
      </div>
      <ol className="tx-steps">
        {steps.map((s) => {
          const end = s.endedAt ? Date.parse(s.endedAt) : now
          const secs = s.startedAt && end != null ? Math.round((end - Date.parse(s.startedAt)) / 1000) : null
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
  return (
    <>
      <div className="tx-summary">
        <div>
          <span className="tx-big">{result.advertisers.length}</span> advertisers · {TAXONOMY_LABEL[result.from]} → GPC
        </div>
        <div className="tx-downloads">
          <a className="btn" href={`/taxonomy-comparison/csv?run=${run.id}`} title="Spend by GPC advertiser and node, one row per slice">
            Download CSV
          </a>
          <a className="btn" href={`/taxonomy-comparison/creatives?run=${run.id}`} title="Every creative behind every advertiser, with its metadata. Read live from Databricks: allow up to a minute.">
            Creatives CSV
          </a>
        </div>
      </div>
      <p className="tx-muted tx-meta">
        Matching {result.model ? `by ${result.model}` : 'by name only'}
        {result.from === 'Classic' && result.classicLoadedAt ? ` · Classic snapshot ${result.classicLoadedAt.slice(0, 10)}, linked to creatives through Vivvix` : ''}
      </p>
      {result.advertisers.map((a) => (
        <AdvertiserCard key={a.input} a={a} from={result.from} runId={run.id} totals={result.gpcTotals ?? {}} onChange={onChange} />
      ))}
    </>
  )
}

function AdvertiserCard({
  a,
  from,
  runId,
  totals,
  onChange,
}: {
  a: AdvertiserResult
  from: FromTaxonomy
  runId: string
  totals: Record<string, GpcTotalRow[]>
  onChange: (run: RunView) => void
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [media, setMedia] = useState<MediaType | ''>('')
  const [month, setMonth] = useState<Month | ''>('')
  const [level, setLevel] = useState<NodeLevel>('category')
  const [gpcBy, setGpcBy] = useState<GpcBy>('advertiser')
  const [open, setOpen] = useState<string | null>(null)
  const [sample, setSample] = useState<SamplePick | null>(null)
  const [expanded, setExpanded] = useState(false)
  const summary = useMemo(() => summarise(a, from, totals), [a, from, totals])

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

  // GPC entities on the chart that have spend from OTHER FROM entities too: they get the "total" button.
  const filter = { media: media || null, month: month || null }
  const totalFor = (key: string): GpcTotalView | null => {
    const rows = totals[gpcTotalKey(gpcBy, key)]
    return rows ? gpcTotalView(rows, filter, e, from) : null
  }
  const more = new Set(rankAdvertisers(flows, gpcBy).flatMap((r) => {
    const v = totalFor(r.key)
    return v && hasMoreElsewhere(v) ? [r.key] : []
  }))
  const openView = open ? totalFor(open) : null
  const openLabel = open ? (rankAdvertisers(flows, gpcBy).find((r) => r.key === open)?.label ?? open) : ''

  return (
    <div className={`tile tx-card ${pending ? 'tx-busy' : ''}`} style={{ ['--edge' as string]: `var(--${edgeTone(summary)})` }}>
      <div className="tile-head">
        <h2 className="tx-title">{a.input}</h2>
        <div className="tile-right">
          {pending ? <span className="status quiet">Updating…</span> : null}
          <button type="button" className="btn" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
            {expanded ? 'Hide details ▴' : 'Details ▾'}
          </button>
        </div>
      </div>

      <SummaryView s={summary} from={from} />

      {expanded ? (
        <>
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
            {(() => {
              const total = flowTotal(a.flows)
              const none = a.flows.filter((f) => !f.gpcId).reduce((sum, f) => sum + f.spend, 0)
              return total > 0 ? (
                <div className={`tx-stat ${none ? 'tx-stat-nogpc' : ''}`} title="Spend on creatives that have no GPC advertiser">
                  <span className="tx-muted">No GPC advertiser</span>
                  <strong>
                    {none ? '⚠ ' : ''}
                    {money(none)} <span className="tx-muted">{pct(none / total)}</span>
                  </strong>
                </div>
              ) : null
            })()}
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
                <Seg label="GPC advertiser" value={gpcBy} onChange={(v) => (setGpcBy(v as GpcBy), setSample(null))} options={(['advertiser', 'parent'] as GpcBy[]).map((b) => [b, GPC_BY_LABEL[b]] as [string, string])} />
                <Seg label="GPC node" value={level} onChange={(v) => (setLevel(v as NodeLevel), setSample(null))} options={NODE_LEVELS.map((l) => [l, NODE_LEVEL_LABEL[l]] as [string, string])} />
              </div>
              {data.total > 0 ? (
                <>
                  <Sankey
                    data={data}
                    fromLabel={e?.name ?? a.input}
                    gpcBy={gpcBy}
                    more={more}
                    onMore={setOpen}
                    picked={sample}
                    onSample={(p) => setSample((cur) => (cur && cur.kind === p.kind && cur.key === p.key ? null : p))}
                  />
                  {sample ? (
                    <SamplesPanel
                      key={`${sample.kind}:${sample.key}:${gpcBy}:${level}:${media}:${month}`}
                      runId={runId}
                      input={a.input}
                      pick={sample}
                      gpcBy={gpcBy}
                      level={level}
                      media={media || null}
                      month={month || null}
                      onClose={() => setSample(null)}
                    />
                  ) : (
                    <p className="tx-muted tx-sample-hint">Click a GPC advertiser or node for sample creatives.</p>
                  )}
                  {open && openView ? (
                    <GpcTotalPanel label={openLabel} view={openView} from={from} entityName={e?.name ?? a.input} onClose={() => setOpen(null)} />
                  ) : null}
                  {/* Advertisers and products side by side, the taxonomy below (Scott, 9 November 2026). */}
                  <div className="tx-lists">
                    <RankList
                      title={gpcBy === 'parent' ? 'GPC top parents' : 'GPC advertisers'}
                      rows={rankAdvertisers(flows, gpcBy)}
                      total={data.total}
                      more={more}
                      onMore={setOpen}
                      tree={(r) => (r.key === NO_GPC ? null : { entity: r.key, role: gpcBy === 'parent' ? 'parent' : 'advertiser' })}
                    />
                    {(() => {
                      const products = rankProducts(flows)
                      return products ? (
                        <RankList
                          title="GPC products"
                          rows={products}
                          total={data.total}
                          tree={(r) => (r.key === NO_GPC || r.key === UNKNOWN_PRODUCT_ID ? null : { product: r.key })}
                        />
                      ) : (
                        <div className="tx-rank">
                          <div className="tx-rank-head">GPC products</div>
                          <p className="tx-muted">This comparison was run before products were recorded. Compare again to see them.</p>
                        </div>
                      )
                    })()}
                  </div>
                  <div className="tx-lists tx-lists-one">
                    <RankList title={`GPC ${NODE_LEVEL_LABEL[level].toLowerCase()}`} rows={rankNodes(flows, level)} total={data.total} />
                  </div>
                </>
              ) : (
                <p className="tx-muted">No spend for this media and month.</p>
              )}
            </>
          ) : null}

          {e && a.flows.length ? (
            <a className="tx-link-csv" href={`/taxonomy-comparison/creatives?run=${runId}&input=${encodeURIComponent(a.input)}`} title="Read live from Databricks: allow up to a minute">
              ⤓ Creatives behind {e.name} (CSV)
            </a>
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
        </>
      ) : null}
    </div>
  )
}

/**
 * The tile's left edge, the home page's convention: green when the spend maps
 * cleanly (one GPC advertiser takes most of it and little reaches that
 * advertiser from elsewhere), amber when it needs a look, slate when there is
 * nothing to show.
 */
function edgeTone(s: AdvertiserSummary): 'green' | 'amber' | 'slate' {
  if (!s.fromEntity || s.total <= 0) return 'slate'
  const d = s.dominant
  return d && (d.shiftedShare == null || d.shiftedShare < 0.1) ? 'green' : 'amber'
}

/** The short assessment: large type, four facts (lib/taxonomy-rules.ts summarise). */
function SummaryView({ s, from }: { s: AdvertiserSummary; from: FromTaxonomy }) {
  const name = TAXONOMY_LABEL[from]
  if (!s.fromEntity) return <p className="tx-sum-empty">Not found in {name}.</p>
  if (s.total <= 0) return <p className="tx-sum-empty">No creative spend for {name} &quot;{s.fromEntity}&quot; in Aug–Sep 2026.</p>
  const d = s.dominant
  return (
    <div className="tx-sum">
      <div className="tx-sum-total">
        <div className="tx-muted">
          {name} spend · Aug–Sep 2026
        </div>
        <div className="tx-sum-big total">{money(s.total)}</div>
        <div className="tx-muted">
          {s.fromEntity}
          {s.fromLevel ? ` (${s.fromLevel.toLowerCase()})` : ''}
        </div>
      </div>

      <div className="tx-sum-col">
        <div className="tx-sum-head">Lands in GPC</div>
        {s.gpc.map((g) => (
          <SumRow key={g.label} label={g.label} spend={g.spend} share={g.share} warn={g.label === NO_GPC} />
        ))}
        {s.gpcOthers ? <SumRow label={`Others (${s.gpcOthers.count})`} spend={s.gpcOthers.spend} share={s.gpcOthers.share} quiet /> : null}
      </div>

      <div className="tx-sum-col">
        <div className="tx-sum-head">GPC industries</div>
        {s.industries.map((i) => (
          <SumRow key={i.label} label={i.label} spend={i.spend} share={i.share} warn={i.label === UNCLASSIFIED} />
        ))}
        {s.industryOthers ? <SumRow label={`Other (${s.industryOthers.count})`} spend={s.industryOthers.spend} share={s.industryOthers.share} quiet /> : null}
      </div>

      {d && d.gpcTotal != null && d.followed != null && d.shifted != null ? (
        <div className="tx-sum-dominant">
          <div>
            <div className="tx-muted">GPC &quot;{d.label}&quot; in total</div>
            <div className="tx-sum-big gpc">{money(d.gpcTotal)}</div>
          </div>
          <div className="tx-sum-split">
            <div className="tx-sum-bar" aria-hidden>
              <span className="followed" style={{ width: `${(d.followedShare ?? 0) * 100}%` }} />
              <span className="shifted" style={{ width: `${(d.shiftedShare ?? 0) * 100}%` }} />
            </div>
            <div className="tx-sum-split-row">
              <span>
                <i className="dot followed" /> Followed from {name} &quot;{s.fromEntity}&quot;
              </span>
              <strong>
                {money(d.followed)} <span className="tx-muted">{pct(d.followedShare ?? 0)}</span>
              </strong>
            </div>
            <div className="tx-sum-split-row">
              <span>
                <i className="dot shifted" /> From creatives {name} files under other advertisers
              </span>
              <strong>
                {money(d.shifted)} <span className="tx-muted">{pct(d.shiftedShare ?? 0)}</span>
              </strong>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SumRow({ label, spend, share, warn, quiet }: { label: string; spend: number; share: number; warn?: boolean; quiet?: boolean }) {
  return (
    <div className={`tx-sum-row ${warn ? 'warn' : ''} ${quiet ? 'quiet' : ''}`}>
      <span className="tx-sum-label">
        {warn ? '⚠ ' : ''}
        {label}
      </span>
      <span className="tx-sum-val">{money(spend)}</span>
      <span className="tx-sum-pct">{pct(share)}</span>
    </div>
  )
}

export function Seg({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
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

function RankList({
  title,
  rows,
  total,
  more,
  onMore,
  tree,
}: {
  title: string
  rows: Ranked[]
  total: number
  more?: Set<string>
  onMore?: (key: string) => void
  /** What a row's tree icon opens (rollup.tsx); null for none, as on "No GPC advertiser". */
  tree?: (r: Ranked) => { product?: string; entity?: string; role?: 'advertiser' | 'parent' | 'brand' } | null
}) {
  return (
    <div className="tx-rank">
      <div className="tx-rank-head">{title}</div>
      <table className="tx-table">
        <tbody>
          {rows.slice(0, 12).map((r) => (
            <tr key={r.key} className={r.key === NO_GPC || r.key === UNCLASSIFIED ? 'flagged' : ''}>
              <td>
                {r.label}
                {(() => {
                  const t = tree?.(r)
                  return t ? <TreeButton product={t.product} entity={t.entity} role={t.role} label={r.label} /> : null
                })()}
                {more?.has(r.key) ? (
                  <button type="button" className="tx-more" onClick={() => onMore?.(r.key)} title="This GPC entity has more spend, from other advertisers: see its total">
                    Σ total
                  </button>
                ) : null}
              </td>
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

/** A GPC entity's whole spend, by the FROM entity each of its creatives belongs to. */
function GpcTotalPanel({
  label,
  view,
  from,
  entityName,
  onClose,
}: {
  label: string
  view: GpcTotalView
  from: FromTaxonomy
  entityName: string
  onClose: () => void
}) {
  return (
    <div className="tx-total" role="dialog" aria-label={`${label}: total GPC spend`}>
      <div className="tx-total-head">
        <div>
          <div className="tx-muted">GPC total for</div>
          <strong className="tx-total-title">{label}</strong>
        </div>
        <div className="tx-stat">
          <span className="tx-muted">Total in GPC</span>
          <strong>{money(view.total)}</strong>
        </div>
        <div className="tx-stat">
          <span className="tx-muted">From {entityName}</span>
          <strong>
            {money(view.own)} <span className="tx-muted">{pct(view.total ? view.own / view.total : 0)}</span>
          </strong>
        </div>
        <button type="button" className="tx-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <table className="tx-table">
        <thead>
          <tr>
            <th>{TAXONOMY_LABEL[from]} entity</th>
            <th className="num">Spend</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.slice(0, 25).map((r) => (
            <tr key={r.key} className={r.own ? 'own' : r.key === '∅' ? 'flagged' : ''}>
              <td>
                {r.label}
                {r.parent && r.parent !== r.label ? <span className="tx-muted"> · {r.parent}</span> : null}
                {r.own ? <span className="status good tx-own">this comparison</span> : null}
              </td>
              <td className="num">{money(r.spend)}</td>
              <td className="num tx-muted">{pct(view.total ? r.spend / view.total : 0)}</td>
            </tr>
          ))}
          {view.rows.length > 25 ? (
            <tr>
              <td className="tx-muted" colSpan={3}>
                +{view.rows.length - 25} more
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

// --- sample creatives -------------------------------------------------------

/** A Sankey node whose creatives to show: a GPC advertiser (or top parent) by id, or a taxonomy node by name. */
export type SamplePick = { kind: 'gpc' | 'node'; key: string; label: string }

/** An SVG group that acts as a button. */
function samplable(go: () => void, label: string) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: go,
    onKeyDown: (ev: React.KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        go()
      }
    },
  }
}

type SamplesState = { loading: true } | { loading: false; rows: SampleCreative[] } | { loading: false; error: string }

/**
 * The biggest creatives behind the node clicked, under the chart's media and
 * month filters, with thumbnails (Scott, 12 November 2026). Which creatives
 * is read from Databricks on click (samples/route.ts); each is shown through
 * MediaRadar's creative API by its id (creative/[id]/route.ts) - a thumbnail
 * here, the creative itself, played or shown, in a new tab.
 */
function SamplesPanel({
  runId,
  input,
  pick,
  gpcBy,
  level,
  media,
  month,
  onClose,
}: {
  runId: string
  input: string
  pick: SamplePick
  gpcBy: GpcBy
  level: NodeLevel
  media: MediaType | null
  month: Month | null
  onClose: () => void
}) {
  const [state, setState] = useState<SamplesState>({ loading: true })
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    let live = true
    const q = new URLSearchParams({ run: runId, input })
    if (pick.kind === 'gpc') {
      q.set('by', gpcBy)
      q.set('key', pick.key)
    } else {
      q.set('level', level)
      q.set('node', pick.key)
    }
    if (media) q.set('media', media)
    if (month) q.set('month', month)
    const tick = setInterval(() => live && setSecs((x) => x + 1), 1000)
    fetch(`/taxonomy-comparison/samples?${q}`)
      .then(async (res) => {
        const body = (await res.json()) as SampleCreative[] | { error: string }
        if (!live) return
        setState(Array.isArray(body) ? { loading: false, rows: body } : { loading: false, error: body.error })
      })
      .catch((err: Error) => live && setState({ loading: false, error: err.message }))
      .finally(() => clearInterval(tick))
    return () => {
      live = false
      clearInterval(tick)
    }
  }, [runId, input, pick, gpcBy, level, media, month])

  return (
    <div className="tx-total tx-samples" role="region" aria-label={`Sample creatives for ${pick.label}`}>
      <div className="tx-total-head">
        <div>
          <div className="tx-muted">
            Top creatives by spend · {month ? MONTH_LABEL[month] : 'Aug–Sep 2026'}
            {media ? ` · ${media}` : ''}
          </div>
          <strong className="tx-total-title">{pick.label}</strong>
        </div>
        <button type="button" className="tx-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {state.loading ? (
        <p className="tx-muted">Reading creatives from Databricks… {secs}s</p>
      ) : 'error' in state ? (
        <p className="status crit">{state.error}</p>
      ) : !state.rows.length ? (
        <p className="tx-muted">No creatives found for this{media || month ? ' with these filters' : ''}.</p>
      ) : (
        <div className="tx-sample-grid">
          {state.rows.map((c) => (
            <figure key={c.creativeId} className="tx-sample">
              <a className="tx-sample-media" href={`/taxonomy-comparison/creative/${c.creativeId}?type=creative`} target="_blank" rel="noreferrer" title="Open the creative">
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the creative API through the portfolio */}
                <img src={`/taxonomy-comparison/creative/${c.creativeId}?type=thumbnail`} alt={c.title ?? `Creative ${c.creativeId}`} loading="lazy" />
                {c.media !== 'Digital' ? <span className="tx-sample-play" aria-hidden>▶</span> : null}
              </a>
              <figcaption>
                <strong>{money(c.spend)}</strong> <span className="tx-muted">· {c.media}{c.creativeType ? ` · ${c.creativeType}` : ''}</span>
                {c.title ? <div className="tx-sample-title" title={c.title}>{c.title}</div> : null}
                <div className="tx-muted tx-sample-meta">
                  #{c.creativeId}
                  {c.firstSeen ? ` · first seen ${c.firstSeen.slice(0, 10)}` : ''}
                  {' · '}
                  <a href={`/taxonomy-comparison/creative/${c.creativeId}?type=creative`} target="_blank" rel="noreferrer">
                    Open ↗
                  </a>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}

// --- the Sankey -------------------------------------------------------------

/** Categorical slots in fixed order (validated light and dark, 30 October 2026); the tail and "none" are neutral. */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6']
const NEUTRAL = '#a3a29b'
/** "No GPC advertiser" is a finding, not a series: amber and hatched, with a warning label (Scott, 30 October 2026). */
const NONE = '#c98500'

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

function Sankey({
  data,
  fromLabel,
  gpcBy,
  more,
  onMore,
  onSample,
  picked,
}: {
  data: SankeyData
  fromLabel: string
  gpcBy: GpcBy
  more: Set<string>
  onMore: (key: string) => void
  /** A GPC advertiser (or top parent) or node was clicked: show its sample creatives. */
  onSample: (pick: SamplePick) => void
  /** The one whose samples are showing, highlighted. */
  picked: SamplePick | null
}) {
  const hatch = `tx-hatch-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const fillFor = (key: string) => (key === NO_GPC ? `url(#${hatch})` : color.get(key))
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
        <defs>
          <pattern id={hatch} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={6} height={6} fill={NONE} opacity={0.35} />
            <line x1={0} y1={0} x2={0} y2={6} stroke={NONE} strokeWidth={3} />
          </pattern>
        </defs>
        <g transform="translate(0, 28)">
        {left.map((p) => (
          <path key={`l-${p.key}`} d={p.d} fill={fillFor(p.key)} className={p.key === NO_GPC ? 'tx-link tx-link-none' : 'tx-link'}>
            <title>{`${fromLabel} → ${p.r.label}: ${money(p.r.spend)} (${pct(p.r.spend / data.total)})`}</title>
          </path>
        ))}
        {rightPaths.map((p, i) => (
          <path key={`r-${i}`} d={p.d} fill={fillFor(p.from)} className={p.from === NO_GPC ? 'tx-link tx-link-none' : 'tx-link'}>
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
          // "Other" is many advertisers folded together: nothing to sample.
          const pick: SamplePick | null = r.key === OTHER ? null : { kind: 'gpc', key: r.key, label: r.label }
          return (
            <g
              key={`a-${r.key}`}
              className={pick ? `tx-pickable ${picked?.kind === 'gpc' && picked.key === r.key ? 'on' : ''}` : ''}
              {...(pick ? samplable(() => onSample(pick), `Sample creatives for ${r.label}`) : {})}
            >
              <rect x={X[1]} y={a.y} width={NODE_W} height={Math.max(a.h, 3)} rx={3} fill={color.get(r.key)} className={r.key === NO_GPC ? 'tx-node-nogpc' : ''}>
                <title>{`${r.label}: ${money(r.spend)} (${pct(r.spend / data.total)})`}</title>
              </rect>
              {more.has(r.key) ? (
                <g
                  className="tx-more-dot"
                  role="button"
                  tabIndex={0}
                  transform={`translate(${X[1] - 13}, ${a.y + a.h / 2})`}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onMore(r.key)
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.stopPropagation()
                      onMore(r.key)
                    }
                  }}
                >
                  <title>More GPC spend from other advertisers: see the total</title>
                  <circle r={9} />
                  <text textAnchor="middle" dominantBaseline="central">Σ</text>
                </g>
              ) : null}
              <text x={X[1] + NODE_W + 6} y={a.y + a.h / 2} dominantBaseline="middle" className={`tx-node-label halo ${r.key === NO_GPC ? 'nogpc' : ''}`}>
                {r.key === NO_GPC ? `⚠ ${advLabel(r)} · ${pct(r.spend / data.total)}` : advLabel(r)}
              </text>
            </g>
          )
        })}

        {data.nodes.map((r) => {
          const nd = nodes.get(r.key)!
          return (
            <g
              key={`n-${r.key}`}
              className={r.key === OTHER ? '' : `tx-pickable ${picked?.kind === 'node' && picked.key === r.key ? 'on' : ''}`}
              {...(r.key === OTHER ? {} : samplable(() => onSample({ kind: 'node', key: r.key, label: r.label }), `Sample creatives for ${r.label}`))}
            >
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
