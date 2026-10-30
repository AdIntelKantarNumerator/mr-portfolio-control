'use client'

/**
 * The paste box, the progress while a run works, and the result.
 *
 * Progress is polled from the run's row every two seconds (actions.ts
 * pollRun): the work happens in the server process, not in this request.
 */
import { useActionState, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  cell,
  MAX_ADVERTISERS,
  MEDIA_TYPES,
  money,
  MONTH_LABEL,
  MONTHS,
  NOT_TRACKED,
  TAXONOMIES,
  TAXONOMY_LABEL,
  total,
  type AdvertiserResult,
  type Candidate,
  type Flag,
  type Step,
  type Taxonomy,
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
        <textarea
          name="advertisers"
          className="tx-input"
          rows={6}
          placeholder={'One advertiser per line, e.g.\nProgressive\nProcter & Gamble\nToyota'}
          defaultValue={initial?.input.join('\n') ?? ''}
          title={`Up to ${MAX_ADVERTISERS} advertisers. Aug–Sep 2026, advertiser level.`}
        />
        <div className="tx-form-foot">
          <span className="tx-muted">Aug–Sep 2026 · VX1, VX2, GPC, MediaRadar Classic</span>
          {state.error ? <span className="status crit">{state.error}</span> : null}
          <button type="submit" className="btn btn-primary" disabled={pending || run?.status === 'running'}>
            {pending ? 'Starting…' : 'Compare'}
          </button>
        </div>
      </form>

      {run ? (
        run.status === 'done' && run.result ? (
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

const FLAG_TONE: Record<Flag['kind'], string> = { name: 'warn', missing: 'crit', gap: 'crit', spread: 'warn' }
const FLAG_LABEL: Record<Flag['kind'], string> = { name: 'Name differs', missing: 'Not found', gap: 'Missing spend', spread: 'Spend differs' }

function Results({ run, onChange }: { run: RunView; onChange: (run: RunView) => void }) {
  const result = run.result!
  const flagged = result.advertisers.filter((a) => a.flags.length).length
  return (
    <>
      <div className="tx-summary">
        <div>
          <span className="tx-big">{result.advertisers.length}</span> advertisers compared ·{' '}
          <span className={flagged ? 'tx-warn' : ''}>{flagged} with flags</span>
        </div>
        <a className="btn" href={`/taxonomy-comparison/csv?run=${run.id}`}>
          Download CSV
        </a>
      </div>
      <p className="tx-muted tx-meta">
        Classic is a snapshot{result.classicLoadedAt ? ` loaded ${result.classicLoadedAt.slice(0, 10)}` : ''} · matching
        {result.model ? ` by ${result.model}` : ' by name only'} · Classic does not track CTV
      </p>
      {result.advertisers.map((a) => (
        <AdvertiserCard key={a.input} a={a} runId={run.id} onChange={onChange} />
      ))}
    </>
  )
}

function AdvertiserCard({ a, runId, onChange }: { a: AdvertiserResult; runId: string; onChange: (run: RunView) => void }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const pick = (t: Taxonomy, id: string) =>
    start(async () => {
      setError(null)
      const out = await pickEntity(runId, a.input, t, id)
      if (out.error) setError(out.error)
      else if (out.run) onChange(out.run)
    })
  const flagMedia = new Set(a.flags.filter((f) => f.media).map((f) => f.media))
  return (
    <div className={`tile tx-card ${pending ? 'tx-busy' : ''}`}>
      <div className="tile-head">
        <h2 className="tx-title">{a.input}</h2>
        <div className="tile-right">
          {pending ? <span className="status quiet">Updating…</span> : null}
          {a.flags.length ? <span className="status warn">{a.flags.length} flag{a.flags.length === 1 ? '' : 's'}</span> : <span className="status good">Consistent</span>}
        </div>
      </div>

      <p className="tx-commentary">{a.commentary}</p>

      <div className="tx-entities">
        {TAXONOMIES.map((t) => {
          const r = a.taxonomies[t]
          const e = r.entity
          const tone = !e ? 'crit' : e.kind === 'exact' ? 'good' : 'warn'
          const title = e?.reason ?? (e ? `Exact name match (id ${e.id})` : r.missing)
          return (
            <label key={t} className="tx-entity" title={title}>
              <span className="tx-muted">
                {TAXONOMY_LABEL[t]}
                {e?.level ? <strong className="tx-level"> · {e.level}</strong> : null}
              </span>
              {r.candidates?.length ? (
                <select
                  className={`tx-pick status ${tone}`}
                  value={e?.id ?? ''}
                  disabled={pending}
                  onChange={(ev) => pick(t, ev.target.value)}
                >
                  {r.candidates.map((c) => (
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
          )
        })}
      </div>
      {error ? <p className="status crit">{error}</p> : null}

      <div className="tx-scroll">
        <table className="tx-table">
          <thead>
            <tr>
              <th>Media</th>
              <th>Month</th>
              {TAXONOMIES.map((t) => (
                <th key={t} className="num">
                  {TAXONOMY_LABEL[t]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MEDIA_TYPES.map((m) =>
              MONTHS.map((mo, i) => (
                <tr key={`${m}${mo}`} className={`${flagMedia.has(m) ? 'flagged' : ''} ${i === 0 ? 'first' : ''}`}>
                  {i === 0 ? <td rowSpan={MONTHS.length}>{m}</td> : null}
                  <td className="tx-muted">{MONTH_LABEL[mo]}</td>
                  {TAXONOMIES.map((t) => {
                    const r = a.taxonomies[t]
                    if (NOT_TRACKED[t]?.includes(m)) return <td key={t} className="num tx-muted">n/a</td>
                    if (!r.entity) return <td key={t} className="num tx-muted">—</td>
                    const v = cell(r.grid, m, mo)
                    return (
                      <td key={t} className={`num ${v ? '' : 'tx-muted'}`}>
                        {v ? money(v) : '0'}
                      </td>
                    )
                  })}
                </tr>
              )),
            )}
            <tr className="total">
              <td colSpan={2}>Total</td>
              {TAXONOMIES.map((t) => (
                <td key={t} className="num">
                  {a.taxonomies[t].entity ? money(total(a.taxonomies[t].grid)) : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

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

function optionLabel(c: Candidate): string {
  const size = c.spend != null ? money(c.spend) : c.size
  return `${c.name}${c.level ? ` (${c.level.toLowerCase()})` : ''}${size ? ` · ${size}` : ''}${c.via ? ` · ${c.via}` : ''}`
}
