'use client'

/**
 * The series' items, folded until asked for (12 October 2026).
 *
 * A strip of counts; opening it shows the items grouped by topic (the work
 * they sit on), blockers first, with the buttons to close what is finished.
 * "Looks done" shows only what Yaara thinks is finished, each with what she
 * saw, and accepts them in one go. Items on hold sit apart at the bottom.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { SeriesRow } from '@/lib/series-data'
import { QUIET_ALERT, shortDay } from '@/lib/series'
import { cleanUp, type CleanupAction } from '../actions'

type Row = SeriesRow & { bucket: string }

const BUCKETS: Array<{ key: string; label: string; tone: string }> = [
  { key: 'new', label: 'New', tone: 'var(--c1)' },
  { key: 'changed', label: 'Changed', tone: 'var(--warn)' },
  { key: 'quiet', label: 'Not Discussed', tone: 'var(--crit)' },
  { key: 'resolved', label: 'Resolved', tone: 'var(--good)' },
  { key: 'decided', label: 'Decisions', tone: 'var(--c4)' },
]
const KIND = { blocker: 'Blocker', decision: 'Decision', action: 'Action' } as const
const KIND_ORDER = { blocker: 0, action: 1, decision: 2 } as const
const today = () => new Date().toISOString().slice(0, 10)

export function SeriesDetail({ seriesId, seriesName, rows }: { seriesId: string; seriesName: string; rows: Row[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState<Set<string>>(new Set(['new', 'changed', 'quiet']))
  const [doneOnly, setDoneOnly] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const held = (r: Row) => Boolean(r.heldUntil && r.heldUntil > today() && r.open)
  const suggested = rows.filter((r) => r.suggested && r.open)
  const counts = Object.fromEntries(BUCKETS.map((b) => [b.key, rows.filter((r) => r.bucket === b.key).length]))
  const alerts = rows.filter((r) => r.open && r.kind !== 'decision' && r.quiet >= QUIET_ALERT && !held(r)).length

  const visible = useMemo(
    () => (doneOnly ? suggested : rows.filter((r) => shown.has(r.bucket))),
    [rows, shown, doneOnly, suggested],
  )
  const groups = useMemo(() => {
    const live = visible.filter((r) => !held(r))
    const byPlace = new Map<string, Row[]>()
    for (const r of live) byPlace.set(r.place ?? 'Other', [...(byPlace.get(r.place ?? 'Other') ?? []), r])
    const weight = (list: Row[]) => list.filter((r) => r.kind === 'blocker' || r.quiet >= QUIET_ALERT).length * 10 + list.length
    const out = [...byPlace.entries()]
      .map(([place, list]) => ({ place, list: list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.quiet - a.quiet) }))
      .sort((a, b) => weight(b.list) - weight(a.list) || a.place.localeCompare(b.place))
    const onHold = visible.filter(held)
    if (onHold.length) out.push({ place: 'On hold', list: onHold })
    return out
  }, [visible])

  async function act(refs: string[], action: CleanupAction, key: string) {
    setBusy(key)
    setError(null)
    const res = await cleanUp({ seriesId, seriesName, refs, action }).catch(() => ({ error: 'That could not be saved.' }) as const)
    setBusy(null)
    if ('error' in res && res.error) setError(res.error)
    router.refresh()
  }

  const toggle = (key: string) => {
    setDoneOnly(false)
    setOpen(true)
    setShown((prev) => {
      const next = new Set(prev)
      if (next.has(key) && open) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <section className="tile ser-detail">
      <div className="ser-strip">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`ser-chip${open && !doneOnly && shown.has(b.key) ? ' on' : ''}`}
            style={{ borderColor: b.tone }}
            onClick={() => toggle(b.key)}
            aria-pressed={open && !doneOnly && shown.has(b.key)}
          >
            <b style={{ color: b.tone }}>{counts[b.key] ?? 0}</b> {b.label}
          </button>
        ))}
        {suggested.length ? (
          <button
            type="button"
            className={`ser-chip${doneOnly ? ' on' : ''}`}
            style={{ borderColor: 'var(--good)' }}
            onClick={() => {
              setOpen(true)
              setDoneOnly(!doneOnly)
            }}
            aria-pressed={doneOnly}
          >
            <b style={{ color: 'var(--good)' }}>{suggested.length}</b> Looks done
          </button>
        ) : null}
        {alerts ? <span className="ser-quiet-n" title={`Not mentioned for ${QUIET_ALERT}+ sessions`}>{alerts} quiet too long</span> : null}
        <button type="button" className="linkish ser-fold" onClick={() => setOpen(!open)}>
          {open ? 'Hide items' : 'Show items'}
        </button>
      </div>

      {open ? (
        <div className="ser-groups">
          {error ? (
            <p className="mr-said mr-bad" role="alert">
              {error}
            </p>
          ) : null}
          {doneOnly && suggested.length > 1 ? (
            <button type="button" className="btn btn-primary ser-accept-all" disabled={busy !== null} onClick={() => act(suggested.map((r) => r.ref), 'done', 'all')}>
              {busy === 'all' ? '…' : `Accept all ${suggested.length} as done`}
            </button>
          ) : null}
          {groups.length === 0 ? <p className="ser-none">Nothing here.</p> : null}
          {groups.map((g) => (
            <div key={g.place} className="ser-group">
              <h3>
                {g.place} <span className="ser-n">{g.list.length}</span>
              </h3>
              <ul>
                {g.list.map((r) => (
                  <li key={r.ref} className="ser-irow">
                    <Link href={r.href} className="ser-item">
                      <span className={`ser-kind ser-${r.kind}`}>{KIND[r.kind]}</span>
                      <span className="ser-ref">{r.ref}</span>
                      <span className="ser-title">{r.title}</span>
                    </Link>
                    <span className="ser-facts">
                      <span>{r.owner ?? <em className="ser-alert">no owner</em>}</span>
                      {r.due ? <span>due {shortDay(r.due)}</span> : null}
                      <span className="ser-bucket">{BUCKETS.find((b) => b.key === r.bucket)?.label}</span>
                      {r.open && r.kind !== 'decision' && r.quiet >= 1 ? (
                        <span className={r.quiet >= QUIET_ALERT ? 'ser-alert' : undefined}>quiet {r.quiet} session{r.quiet === 1 ? '' : 's'}</span>
                      ) : null}
                      {held(r) ? <span>on hold until {shortDay(r.heldUntil)}</span> : null}
                      {r.change && r.bucket === 'changed' ? <span className="ser-chg">{r.change}</span> : null}
                    </span>
                    {r.suggested && r.open ? (
                      <span className="ser-sugg">
                        Looks done: {r.suggested.note}
                        {r.suggested.source ? (
                          <>
                            {' '}
                            {r.suggested.url ? (
                              <a href={r.suggested.url} target="_blank" rel="noreferrer">
                                ({r.suggested.source})
                              </a>
                            ) : (
                              `(${r.suggested.source})`
                            )}
                          </>
                        ) : null}
                      </span>
                    ) : null}
                    {r.open && r.kind !== 'decision' ? (
                      <span className="ser-btns">
                        <button type="button" className="ser-b ser-b-done" disabled={busy !== null} onClick={() => act([r.ref], 'done', r.ref)}>
                          {busy === r.ref ? '…' : r.suggested ? 'Accept' : 'Done'}
                        </button>
                        <button type="button" className="ser-b" disabled={busy !== null} onClick={() => act([r.ref], r.suggested ? 'dismiss' : 'still-open', r.ref)}>
                          {r.suggested ? 'Not done' : 'Still open'}
                        </button>
                        <button type="button" className="ser-b" disabled={busy !== null} onClick={() => act([r.ref], 'withdraw', r.ref)}>
                          Withdraw
                        </button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
