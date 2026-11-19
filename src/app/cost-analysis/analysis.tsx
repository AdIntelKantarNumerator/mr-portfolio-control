'use client'

/**
 * The three views of Cost Analysis, all from one baseline:
 *
 *   Baseline     A typical day per component, with its seven days drawn small.
 *   Scenario     Levers for the decisions people actually ask about; the
 *                change in yearly run rate, the one-time cost, and what else
 *                on the map the change reaches but this does not price.
 *   On the map   The map's groups, each priced component lit by its cost.
 *
 * Every assumption behind a lever is in its tooltip, not on the page.
 */
import { useMemo, useState } from 'react'
import { Empty, Pill, Stat } from '@/components/ui'
import {
  ASSUMPTIONS,
  DEDUP_OPTIONS,
  NO_CHANGE,
  downstream,
  scenario,
  type Baseline,
  type CostComponent,
  type Levers,
} from '@/lib/cost-model'

type View = 'baseline' | 'scenario' | 'map'

interface MapData {
  groups: { key: string; name: string }[]
  components: { id: string; name: string; groupKey: string; kind: string }[]
  links: { from: string; to: string }[]
}

const VIEWS: { key: View; label: string }[] = [
  { key: 'baseline', label: 'Baseline' },
  { key: 'scenario', label: 'Scenario' },
  { key: 'map', label: 'On the map' },
]

export function money(x: number): string {
  const a = Math.abs(x)
  const s = x < 0 ? '−' : ''
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e4) return `${s}$${Math.round(a / 1e3)}k`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}k`
  return `${s}$${Math.round(a)}`
}

const signed = (x: number) => (Math.abs(x) < 0.5 ? '$0' : `${x > 0 ? '+' : ''}${money(x)}`)

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

const LIFECYCLE: Record<string, { tone: 'amber' | 'red'; label: string; title: string } | undefined> = {
  parallel: { tone: 'amber', label: 'Parallel run', title: 'Runs alongside GPC until it retires' },
  eliminating: { tone: 'red', label: 'Being eliminated', title: 'On its way out' },
}

export function CostAnalysis({
  baseline,
  source,
  defs,
  map,
}: {
  baseline: Baseline
  source: { kind: 'datadog' | 'snapshot'; error: string | null; readAt: string }
  defs: CostComponent[]
  map: MapData
}) {
  const [view, setView] = useState<View>('baseline')
  // A component counts as on the map only if the live map has it by that name,
  // so a rename in the map editor shows up here as "Not on map", not as a gap.
  const def = useMemo(() => {
    const names = new Set(map.components.map((c) => c.name))
    return new Map(defs.map((d) => [d.key, { ...d, mapName: d.mapName && names.has(d.mapName) ? d.mapName : null }]))
  }, [defs, map])
  const window = `${dayLabel(baseline.window[0]!)} – ${dayLabel(baseline.window.at(-1)!)}`

  return (
    <div className="ca">
      <div className="ca-head">
        <nav className="dd-tabs" aria-label="Cost Analysis views">
          {VIEWS.map((v) => (
            <a
              key={v.key}
              href={`#${v.key}`}
              className={v.key === view ? 'on' : ''}
              aria-current={v.key === view ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault()
                setView(v.key)
              }}
            >
              {v.label}
            </a>
          ))}
        </nav>
        <span
          className={`ca-source ${source.kind}`}
          title={
            source.kind === 'datadog'
              ? `GCP AI cost (Vertex AI + Gemini API), production projects, read ${new Date(source.readAt).toLocaleString()}`
              : 'Production GCP AI cost from Datadog for the 13 November cost review. Set DATADOG_API_KEY and DATADOG_APP_KEY to read it live.'
          }
        >
          {source.kind === 'datadog' ? 'Datadog' : 'Snapshot'} · GCP AI · {window}
        </span>
      </div>
      {source.error ? <div className="ca-warn">Showing the snapshot. {source.error}.</div> : null}

      {view === 'baseline' && <BaselineView baseline={baseline} def={def} snapshot={source.kind === 'snapshot'} />}
      {view === 'scenario' && <ScenarioView baseline={baseline} def={def} map={map} />}
      {view === 'map' && <MapView baseline={baseline} def={def} map={map} />}
    </div>
  )
}

function BaselineView({ baseline, def, snapshot }: { baseline: Baseline; def: Map<string, CostComponent>; snapshot: boolean }) {
  const rows = [...baseline.components].sort((a, b) => b.perDay - a.perDay)
  const max = Math.max(1, ...rows.map((r) => r.perDay), ...baseline.unallocated.map((u) => u.perDay))
  const peak = Math.max(1, ...rows.flatMap((r) => r.days))
  const unalloc = baseline.unallocated.reduce((a, u) => a + u.perDay, 0)

  return (
    <div className="ca-body">
      <div className="ca-stats">
        <Stat value={money(baseline.total)} label="Typical day" />
        <Stat value={money(baseline.total * 365)} label="Per year at that rate" />
        {/* The snapshot holds five production projects only: an empty Unallocated or Dev there is unknown, not zero. */}
        <Stat value={snapshot ? '—' : money(unalloc)} label="Unallocated / day" sub={snapshot ? 'Not in the snapshot' : undefined} tone={unalloc > 0 ? 'amber' : undefined} />
        <Stat value={snapshot ? '—' : money(baseline.devPerDay)} label="Dev projects / day" sub={snapshot ? 'Not in the snapshot' : undefined} />
      </div>

      <div className="ca-bars">
        {rows.map((r) => {
          const d = def.get(r.key)
          const life = d ? LIFECYCLE[d.lifecycle] : undefined
          return (
            <div key={r.key} className="ca-row">
              <div className="ca-name">
                <span>{d?.name ?? r.key}</span>
                <span className="ca-tags">
                  {life ? <Pill tone={life.tone} title={life.title}>{life.label}</Pill> : null}
                  {d && !d.mapName ? <Pill tone="amber" title="Billed in GCP, but no component of this name on the Workflow map">Not on map</Pill> : null}
                </span>
              </div>
              <div className="ca-track" aria-hidden="true">
                <span className="ca-bar" style={{ width: `${(r.perDay / max) * 100}%` }} />
              </div>
              <div className="ca-spark" title={r.days.map((v) => money(v)).join(' · ')} aria-label="Cost on each day of the window">
                {r.days.map((v, i) => (
                  <span key={i} style={{ height: `${Math.max(4, (v / peak) * 100)}%` }} />
                ))}
              </div>
              <div className="ca-val">
                {money(r.perDay)}
                <small>{money(r.perDay * 365)} / yr</small>
              </div>
            </div>
          )
        })}
        {baseline.unallocated.map((u) => (
          <div key={u.project} className="ca-row ca-unalloc">
            <div className="ca-name">
              <span>{u.project}</span>
              <span className="ca-tags">
                <Pill tone="slate" title="A GCP project no component claims yet (lib/cost-model.ts COST_COMPONENTS)">Unallocated</Pill>
              </span>
            </div>
            <div className="ca-track" aria-hidden="true">
              <span className="ca-bar" style={{ width: `${(u.perDay / max) * 100}%` }} />
            </div>
            <div />
            <div className="ca-val">{money(u.perDay)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Seg<T extends string | number | boolean>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { v: T; label: string; hint?: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="ca-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} type="button" aria-pressed={o.v === value} title={o.hint} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  show,
  hint,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  show: string
  hint: string
  onChange: (v: number) => void
}) {
  return (
    <div className="ca-lever" title={hint}>
      <label htmlFor={id}>
        {label} <output htmlFor={id}>{show}</output>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

function ScenarioView({ baseline, def, map }: { baseline: Baseline; def: Map<string, CostComponent>; map: MapData }) {
  const [lv, setLv] = useState<Levers>(NO_CHANGE)
  const set = <K extends keyof Levers>(k: K, v: Levers[K]) => setLv((x) => ({ ...x, [k]: v }))
  const s = useMemo(() => scenario(baseline, lv), [baseline, lv])
  const hasParallel = baseline.components.some((c) => def.get(c.key)?.lifecycle === 'parallel')
  const max = Math.max(1, ...s.rows.flatMap((r) => [r.base, r.next]))

  // What else the change reaches on the map, beyond what it prices.
  const touched = useMemo(() => {
    const idOf = new Map(map.components.map((c) => [c.name, c.id]))
    const moved = s.rows.filter((r) => Math.abs(r.next - r.base) > 0.5 || r.oneTime > 0)
    const start = moved.map((r) => def.get(r.key)?.mapName).flatMap((n) => (n && idOf.has(n) ? [idOf.get(n)!] : []))
    const priced = new Set(defs(def).map((d) => d.mapName))
    const name = new Map(map.components.map((c) => [c.id, c.name]))
    return [...downstream(start, map.links)].map((id) => name.get(id)!).filter((n) => n && !priced.has(n)).sort()
  }, [s, def, map])

  return (
    <div className="ca-body ca-scen">
      <div className="ca-levers">
        <Slider
          id="ca-cov"
          label="New coverage"
          value={lv.coveragePct}
          min={-30}
          max={60}
          step={5}
          show={`${lv.coveragePct > 0 ? '+' : ''}${lv.coveragePct}%`}
          hint="More or fewer new creatives a day: a market, network, medium or country added or dropped. Moves every component driven by new creatives."
          onChange={(v) => set('coveragePct', v)}
        />
        <Slider
          id="ca-hist"
          label="Historical processing"
          value={lv.historyMonths}
          min={0}
          max={36}
          step={3}
          show={`${lv.historyMonths} mo`}
          hint={`Past months run once through every creative-driven component. Assumes a past month holds as many creatives as a current one (×${ASSUMPTIONS.historyMonthVsNow}). October's GPC reprocessing cost about $35k above run rate.`}
          onChange={(v) => set('historyMonths', v)}
        />
        <div className="ca-lever">
          <span className="ca-lh">De-duplication</span>
          <Seg
            label="De-duplication method"
            value={lv.dedupFactor}
            options={DEDUP_OPTIONS.map((o) => ({ v: o.factor, label: o.label, hint: o.hint }))}
            onChange={(v) => set('dedupFactor', v)}
          />
        </div>
        <div className="ca-lever">
          <span className="ca-lh">Run AI</span>
          <Seg
            label="Online or batch"
            value={lv.batch}
            options={[
              { v: false, label: 'Online' },
              { v: true, label: 'Batch', hint: `Batch at about ${ASSUMPTIONS.batchShare * 100}% of the online price, for every component that need not answer in seconds (not yet checked against our Vertex AI pricing)` },
            ]}
            onChange={(v) => set('batch', v)}
          />
        </div>
        {hasParallel && (
          <div className="ca-lever">
            <span className="ca-lh">VX0 parallel run</span>
            <Seg
              label="VX0 Classification Engine"
              value={lv.retireParallel}
              options={[
                { v: false, label: 'Keep' },
                { v: true, label: 'Retire', hint: 'GPC covers its tags, and VX1/VX2 are derived from GPC' },
              ]}
              onChange={(v) => set('retireParallel', v)}
            />
          </div>
        )}
        <Slider
          id="ca-games"
          label="Live sports games"
          value={lv.gamesPct}
          min={-50}
          max={100}
          step={10}
          show={`${lv.gamesPct > 0 ? '+' : ''}${lv.gamesPct}%`}
          hint="Cost follows the game calendar: games × frames sampled × price per frame."
          onChange={(v) => set('gamesPct', v)}
        />
        <button type="button" className="ca-reset" onClick={() => setLv(NO_CHANGE)} disabled={lv === NO_CHANGE}>
          Reset
        </button>
      </div>

      <div className="ca-result">
        <div className="ca-stats ca-stats-3">
          <Stat
            value={signed(s.runRateDelta)}
            label="Run rate / year"
            tone={s.runRateDelta > 1 ? 'red' : s.runRateDelta < -1 ? 'green' : undefined}
          />
          <Stat value={money(s.oneTime)} label="One-time" tone={s.oneTime > 0 ? 'amber' : undefined} />
          <Stat value={money(s.nextDay)} label="New typical day" />
        </div>
        <div className="ca-legend">
          <span><i className="b" />Baseline</span>
          <span><i className="n" />Scenario</span>
        </div>
        <div className="ca-bars">
          {[...s.rows].sort((a, b) => b.base - a.base).map((r) => {
            const d = r.next - r.base
            return (
              <div key={r.key} className="ca-row ca-row-scen">
                <div className="ca-name"><span>{def.get(r.key)?.name ?? r.key}</span></div>
                <div className="ca-track ca-pair" aria-hidden="true">
                  <span className="ca-bar b" style={{ width: `${(r.base / max) * 100}%` }} />
                  <span className="ca-bar n" style={{ width: `${(r.next / max) * 100}%` }} />
                </div>
                <div className="ca-val">
                  {money(r.next)}
                  <small className={d > 0.5 ? 'up' : d < -0.5 ? 'down' : ''}>
                    {Math.abs(d) < 0.5 ? 'no change' : `${signed(d)} / day`}
                    {r.oneTime > 0 ? ` · ${money(r.oneTime)} once` : ''}
                  </small>
                </div>
              </div>
            )
          })}
        </div>
        {touched.length > 0 && (
          <div className="ca-touched">
            <span className="ca-lh" title="Downstream on the Workflow map, two links out. Their cost is not in this scenario.">Also reaches, not priced</span>
            <div className="ca-chips">
              {touched.map((n) => (
                <Pill key={n} tone="slate">{n}</Pill>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const defs = (m: Map<string, CostComponent>) => [...m.values()]

function MapView({ baseline, def, map }: { baseline: Baseline; def: Map<string, CostComponent>; map: MapData }) {
  const cost = new Map<string, number>()
  for (const c of baseline.components) {
    const n = def.get(c.key)?.mapName
    if (n) cost.set(n, c.perDay)
  }
  const offMap = baseline.components.filter((c) => !def.get(c.key)?.mapName)
  const heat = (v: number) => (v >= 500 ? 'h3' : v >= 250 ? 'h2' : 'h1')
  if (!map.components.length) return <div className="ca-body"><Empty>The Workflow map is empty here, so there is nothing to place cost on.</Empty></div>

  return (
    <div className="ca-body">
      <div className="ca-legend">
        <span><i className="h3" />$500+ / day</span>
        <span><i className="h2" />$250–500</span>
        <span><i className="h1" />Under $250</span>
        <span><i className="none" />No cost mapped yet</span>
      </div>
      <div className="ca-lanes">
        {map.groups.map((g) => {
          const comps = map.components.filter((c) => c.groupKey === g.key)
          const priced = comps.filter((c) => cost.has(c.name)).sort((a, b) => cost.get(b.name)! - cost.get(a.name)!)
          const rest = comps.length - priced.length
          return (
            <div key={g.key} className="ca-lane">
              <span className="ca-lt">{g.name}</span>
              {priced.map((c) => (
                <div key={c.id} className={`ca-node ${heat(cost.get(c.name)!)}`}>
                  <b>{c.name}</b>
                  <small>{money(cost.get(c.name)!)} / day</small>
                </div>
              ))}
              {rest > 0 && <span className="ca-more">{priced.length ? `+ ${rest} more` : `${rest} component${rest === 1 ? '' : 's'}`}</span>}
            </div>
          )
        })}
        {offMap.length > 0 && (
          <div className="ca-lane">
            <span className="ca-lt">Billed, not on the map</span>
            {offMap.map((c) => (
              <div key={c.key} className={`ca-node off ${heat(c.perDay)}`} title="Add it on the Workflow map to place it in a group">
                <b>{def.get(c.key)?.name ?? c.key}</b>
                <small>{money(c.perDay)} / day</small>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
