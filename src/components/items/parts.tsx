'use client'

/**
 * The pieces of the work-in-progress dashboards (Scott, 5 October 2026): the
 * closure health tile, the top five, the importance chip with its "why" and
 * history popups, the more/less important buttons, and "withdraw all".
 *
 * Shared by Blockers, Decisions and Action items, which are the same
 * dashboard over different items (lib/items.ts).
 */
import { useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { BAND_LABEL, FACTORS, isFactor, type Band } from '@/lib/importance'
import { HEALTH_WINDOW_DAYS, INACTIVE_DAYS, type HealthInput, type Rag } from '@/lib/item-activity'
import { adjustItem, loadItemHistory, withdrawInactive, type HistoryEntry } from '@/app/items-actions'
import { describeChange } from '@/lib/item-changes'

/**
 * A yes/no that remembers itself in this browser (Scott, 6 October 2026: the
 * "All" list's include switches keep your last setting). Read through
 * useSyncExternalStore so the server renders the default and the browser
 * shows the remembered value without a mismatch. Storage that is blocked or
 * missing just means the default, every time.
 */
const PREF_EVENT = 'mrpc-pref'
function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}
export function usePref(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    (notify) => {
      window.addEventListener('storage', notify)
      window.addEventListener(PREF_EVENT, notify)
      return () => {
        window.removeEventListener('storage', notify)
        window.removeEventListener(PREF_EVENT, notify)
      }
    },
    () => readPref(key, fallback),
    () => fallback,
  )
  const set = (v: boolean) => {
    try {
      window.localStorage.setItem(key, v ? '1' : '0')
    } catch {
      // Not remembered, but still applied below for this visit.
    }
    window.dispatchEvent(new Event(PREF_EVENT))
  }
  return [value, set]
}

/**
 * The "All" list's two switches: include inactive items, include the top
 * five. Both off by default and remembered. Changing any other filter turns
 * the top five on for that view - a filtered list should be everything that
 * matches - without changing the remembered setting.
 */
export function useAllListSwitches(opts?: { label?: string; pref?: string; top?: boolean }) {
  const [inactive, setInactive] = usePref(opts?.pref ?? 'wip.includeInactive', false)
  const [topSaved, setTopSaved] = usePref('wip.includeTop', false)
  const [topByFilter, setTopByFilter] = useState(false)
  const top = topSaved || topByFilter
  return {
    inactive,
    top,
    onFilterChange: () => setTopByFilter(true),
    controls: (
      <span className="rt-switches">
        <label className="rt-switch">
          <input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />
          {opts?.label ?? 'Include inactive'}
        </label>
        {opts?.top === false ? null : (
        <label className="rt-switch">
          <input
            type="checkbox"
            checked={top}
            onChange={(e) => {
              setTopByFilter(false)
              setTopSaved(e.target.checked)
            }}
          />
          Include top 5
        </label>
        )}
      </span>
    ),
  }
}

/** One item as the dashboard needs it: plain data, safe to send to the browser. */
export interface ItemInfo {
  ref: string
  kind: 'blocker' | 'decision' | 'action'
  title: string
  owner: string | null
  places: string[]
  score: number | null
  band: Band | null
  /** Why it has that band: its rank among open items of its kind, or why it cannot be Critical. */
  bandNote: string | null
  factors: string[]
  reasons: Array<{ factor: string; why: string; quote: string | null; source: string | null; url: string | null }>
  adjust: number
  mentions: number
  /** When it was raised or entered (its raised date, else when it was recorded). */
  createdAt: string
  /** Where it was first raised, with a link when there is one. */
  source: { title: string; url: string | null } | null
  raisedBy: string | null
  lastActivityAt: string
  inactive: boolean
  /** On hold until this day (YYYY-MM-DD): no reminders before it. */
  heldUntil?: string | null
}

const days = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))

export function BandChip({ band, score }: { band: Band | null; score: number | null }) {
  if (!band) return <span className="imp imp-none" title="Not scored yet: Yaara scores new items on her next pass">Unscored</span>
  return (
    <span className={`imp imp-${band}`} title={`Importance ${score} of 100`}>
      {BAND_LABEL[band]}
    </span>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal imp-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** "Why is this important": the factors Yaara tagged, each with its reason and evidence. */
export function WhyButton({ item }: { item: ItemInfo }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="linkish imp-why" onClick={() => setOpen(true)}>
        why?
      </button>
      {open ? (
        <Modal title={`${item.ref}: why it is ${item.band ? BAND_LABEL[item.band] : 'unscored'}`} onClose={() => setOpen(false)}>
          <p className="lead">{item.title}</p>
          {/* Where it came from and when (Scott, 5 October 2026). */}
          <p className="imp-origin">
            Raised <b>{new Date(item.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</b>
            {item.raisedBy ? <> by {item.raisedBy}</> : null}
            {item.source ? (
              <>
                {' '}in{' '}
                {item.source.url ? (
                  <a href={item.source.url} target="_blank" rel="noreferrer">
                    {item.source.title}
                  </a>
                ) : (
                  <b>{item.source.title}</b>
                )}
              </>
            ) : (
              <> · source not recorded</>
            )}
            .
          </p>
          <p className="imp-meta">
            {item.owner ? <>Owner: <b>{item.owner}</b></> : 'No owner'}
            {item.places.length ? <> · {item.places.join(', ')}</> : null} · open {days(item.createdAt)} day
            {days(item.createdAt) === 1 ? '' : 's'} · last update {days(item.lastActivityAt)} day{days(item.lastActivityAt) === 1 ? '' : 's'} ago
          </p>
          {item.bandNote ? <p className="imp-meta">{item.bandNote}</p> : null}
          {item.score == null ? (
            <p>Not scored yet. Yaara scores new items on her next hourly pass.</p>
          ) : (
            <>
              <p>
                Importance <b>{item.score}</b> of 100.
              </p>
              {item.factors.length ? (
                <ul className="imp-factors">
                  {item.factors.filter(isFactor).map((f) => {
                    const factor = FACTORS[f]
                    const reason = item.reasons.find((r) => r.factor === f)
                    return (
                      <li key={f}>
                        <b>
                          {factor.label} ({factor.weight > 0 ? '+' : ''}
                          {factor.weight})
                        </b>
                        : {reason?.why || factor.means}
                        {reason?.quote ? (
                          <blockquote>
                            “{reason.quote}”
                            {reason.source ? (
                              <span className="imp-src">
                                {' '}
                                {reason.url ? (
                                  <a href={reason.url} target="_blank" rel="noreferrer">
                                    {reason.source}
                                  </a>
                                ) : (
                                  reason.source
                                )}
                              </span>
                            ) : null}
                          </blockquote>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p>No factors apply: an ordinary item of its kind.</p>
              )}
              <p className="imp-meta">
                Raised in {item.mentions} place{item.mentions === 1 ? '' : 's'}
                {item.mentions === 1 ? ' (a little less important for that)' : ' (more important for each)'}.
                {item.adjust ? ` Adjusted ${item.adjust > 0 ? 'up' : 'down'} by hand: ${item.adjust > 0 ? '+' : ''}${item.adjust}.` : ''}
              </p>
            </>
          )}
        </Modal>
      ) : null}
    </>
  )
}

const EVENT_WORD: Record<string, string> = {
  raised: 'Raised',
  discussed: 'Discussed',
  updated: 'Update',
  changed: 'Changed',
  resolved: 'Resolved',
  done: 'Done',
  dropped: 'Withdrawn',
  reopened: 'Reopened',
  merged: 'Merged',
  owner: 'Owner',
  importance: 'Importance',
  nudged: 'Reminder sent',
  held: 'On hold',
}

/** Every update on an item, newest first: evidence, replies, status changes, edits. */
export function HistoryButton({ item }: { item: Pick<ItemInfo, 'ref' | 'title' | 'lastActivityAt'> }) {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="linkish imp-hist"
        title={`Last update ${days(item.lastActivityAt)} day(s) ago`}
        onClick={async () => {
          setOpen(true)
          setRows(await loadItemHistory(item.ref))
        }}
      >
        updates
      </button>
      {open ? (
        <Modal title={`${item.ref}: updates`} onClose={() => setOpen(false)}>
          <p className="lead">{item.title}</p>
          {rows === null ? (
            <p>Loading…</p>
          ) : rows.length === 0 ? (
            <p>Nothing recorded on it yet.</p>
          ) : (
            <ol className="imp-history">
              {rows.map((r, i) => (
                <li key={i}>
                  {/* When to the minute: two meetings on one day are two different places it changed. */}
                  <span className="imp-when">
                    {new Date(r.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>{' '}
                  <b>{EVENT_WORD[r.kind] ?? r.kind}</b>
                  {r.actor ? <> · {r.actor}</> : null}
                  {r.changes.length ? (
                    <ul className="imp-changes">
                      {r.changes.map((c, j) => (
                        <li key={j}>{describeChange(c)}</li>
                      ))}
                    </ul>
                  ) : null}
                  {r.note ? <div>{r.note}</div> : null}
                  {r.source ? (
                    <div className="imp-src">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {r.source}
                        </a>
                      ) : (
                        r.source
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </Modal>
      ) : null}
    </>
  )
}

/**
 * The controls a row carries, the same in the top five and in the lists
 * below: more or less important, why, and its updates.
 */
export function ItemTools({ item }: { item: ItemInfo }) {
  return (
    <span className="imp-tools">
      {item.heldUntil && item.heldUntil > new Date().toISOString().slice(0, 10) ? (
        <span className="imp-held" title="No reminders until then">
          On hold · {new Date(`${item.heldUntil}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      ) : null}
      <AdjustButtons item={item} />
      <WhyButton item={item} />
      <HistoryButton item={item} />
    </span>
  )
}

/** More or less important, one step at a time. A person's change, kept apart from Yaara's score. */
export function AdjustButtons({ item }: { item: Pick<ItemInfo, 'ref' | 'score'> }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async (delta: 1 | -1) => {
    setBusy(true)
    setError(null)
    const res = await adjustItem(item.ref, delta).catch(() => ({ error: 'Could not save that.' }))
    setBusy(false)
    if ('error' in res && res.error) setError(res.error)
    else router.refresh()
  }
  return (
    <span className="imp-adjust">
      <button type="button" onClick={() => go(1)} disabled={busy} title="More important" aria-label={`Make ${item.ref} more important`}>
        ▲
      </button>
      <button type="button" onClick={() => go(-1)} disabled={busy} title="Less important" aria-label={`Make ${item.ref} less important`}>
        ▼
      </button>
      {error ? <span className="err">{error}</span> : null}
    </span>
  )
}

const RAG_WORD: Record<Rag, string> = { green: 'Closing well', yellow: 'Slow', red: 'Stalling' }

/**
 * Larger, and each number coloured for what it means (Scott, 5 October
 * 2026): closed in green, opened in amber, how many are moving in blue, an
 * important item left a week in red.
 */
export function HealthTile({ rag, facts, noun }: { rag: Rag; facts: HealthInput; noun: string }) {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
  return (
    <section className={`tile imp-health imp-health-${rag}`}>
      <p className="ptitle">How fast {noun} are closing</p>
      <div className="imp-light">
        <span className="imp-dot" aria-hidden="true" />
        <b>{RAG_WORD[rag]}</b>
      </div>
      <ul className="imp-facts">
        <li>
          <b className="hf-good">{facts.closed} closed</b> and <b className="hf-new">{facts.opened} opened</b> in the last{' '}
          {HEALTH_WINDOW_DAYS} days.
        </li>
        <li>
          {facts.totalOpen === 0 ? (
            'Nothing open.'
          ) : (
            <>
              <b className="hf-move">
                {facts.activeOpen} of {facts.totalOpen}
              </b>{' '}
              open {plural(facts.totalOpen, 'item', 'items')} updated in the last {INACTIVE_DAYS} days.
            </>
          )}
        </li>
        {facts.criticalStale ? (
          <li>
            <b className="hf-bad">
              {facts.criticalStale} high-importance {plural(facts.criticalStale, 'item', 'items')}
            </b>{' '}
            untouched for {INACTIVE_DAYS}+ days.
          </li>
        ) : null}
      </ul>
    </section>
  )
}

export function TopItems({
  items,
  noun,
  edits,
}: {
  items: ItemInfo[]
  noun: string
  /** ref → the same edit button the list rows have, built by the page. */
  edits?: Record<string, React.ReactNode>
}) {
  return (
    <section className="tile imp-top">
      <p className="ptitle">The {Math.min(5, items.length) || 5} most important open {noun}</p>
      {items.length ? (
        <div className="imp-row imp-head" aria-hidden="true">
          <span>Importance</span>
          <span />
          <span>Owner</span>
          <span />
          <span />
        </div>
      ) : null}
      {items.length === 0 ? (
        <p className="rt-empty">Nothing open.</p>
      ) : (
        <ol>
          {items.slice(0, 5).map((i) => (
            <li key={i.ref} className={`imp-row imp-row-${i.band ?? 'none'}`}>
              <BandChip band={i.band} score={i.score} />
              <span className="imp-text">
                <span className="imp-ref">{i.ref}</span> {i.title}
              </span>
              <span className={`imp-owner${i.owner ? '' : ' imp-noowner'}`}>{i.owner ?? 'No owner'}</span>
              <ItemTools item={i} />
              <span className="imp-edit">{edits?.[i.ref] ?? null}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function WithdrawAll({ kind, scope, count, noun }: { kind: string; scope: string | null; count: number; noun: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  if (count === 0) return null
  return (
    <span className="rt-actions">
      <button
        type="button"
        className="rt-add imp-withdraw"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(`Withdraw all ${count} inactive ${noun}? Each is recorded as withdrawn and can be reopened.`)) return
          setBusy(true)
          const res = await withdrawInactive(kind, scope).catch(() => ({ error: 'Could not withdraw them.' }))
          setBusy(false)
          if ('error' in res && res.error) setSaid(res.error)
          else {
            setSaid(`Withdrew ${'count' in res ? res.count : count}.`)
            router.refresh()
          }
        }}
      >
        {busy ? 'Withdrawing…' : 'Withdraw all'}
      </button>
      {said ? <span className="mr-said">{said}</span> : null}
    </span>
  )
}
