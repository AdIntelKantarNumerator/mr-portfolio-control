'use client'

/**
 * New or edit: a name, and the meetings that make up the series, picked from
 * every meeting name on record. Selected ones stay at the top.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/items/parts'
import { shortDay } from '@/lib/series'
import { meetingChoices, saveSeries } from './actions'

export interface KnownMeeting {
  name: string
  sessions: number
  last: string | null
}

export function SeriesEditor({
  series,
  onClose,
}: {
  series?: { id: string; name: string; meetings: string[] }
  onClose: () => void
}) {
  const router = useRouter()
  // Fetched when the dialog opens: the page itself never needs the list.
  const [known, setKnown] = useState<KnownMeeting[] | null>(null)
  useEffect(() => {
    let live = true
    meetingChoices()
      .then((k) => live && setKnown(k))
      .catch(() => live && setKnown([]))
    return () => {
      live = false
    }
  }, [])
  const [name, setName] = useState(series?.name ?? '')
  const [picked, setPicked] = useState<Set<string>>(new Set(series?.meetings ?? []))
  const [find, setFind] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = useMemo(() => {
    // A meeting already in the series but no longer on record still shows,
    // so it can be removed.
    const all = new Map((known ?? []).map((k) => [k.name, k]))
    for (const m of picked) if (!all.has(m)) all.set(m, { name: m, sessions: 0, last: null })
    const q = find.trim().toLowerCase()
    return [...all.values()]
      .filter((k) => picked.has(k.name) || !q || k.name.toLowerCase().includes(q))
      .sort((a, b) => Number(picked.has(b.name)) - Number(picked.has(a.name)))
  }, [known, picked, find])

  const toggle = (m: string) => {
    const next = new Set(picked)
    if (next.has(m)) next.delete(m)
    else next.add(m)
    setPicked(next)
  }

  async function save() {
    setBusy(true)
    setError(null)
    const res = await saveSeries({ id: series?.id, name, meetings: [...picked] }).catch(() => ({ error: 'That could not be saved.' }) as const)
    setBusy(false)
    if ('error' in res && res.error) return setError(res.error)
    onClose()
    if (!series && 'id' in res && res.id) router.push(`/series/${res.id}`)
    else router.refresh()
  }

  return (
    <Modal title={series ? 'Edit series' : 'New series'} onClose={onClose}>
      <div className="ser-form">
        <input id="series-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Series name" autoFocus />
        <input
          id="series-find"
          type="search"
          className="ser-find"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Find a meeting"
          aria-label="Find a meeting"
        />
        <ul className="ser-pick">
          {options.map((k) => (
            <li key={k.name}>
              <label className={picked.has(k.name) ? 'on' : undefined}>
                <input type="checkbox" checked={picked.has(k.name)} onChange={() => toggle(k.name)} />
                <span>{k.name}</span>
                <em>{k.sessions ? `${k.sessions} · ${shortDay(k.last)}` : ''}</em>
              </label>
            </li>
          ))}
          {known === null ? <li className="ser-none">Loading…</li> : options.length === 0 ? <li className="ser-none">No meeting matches</li> : null}
        </ul>
        <div className="ser-actions">
          {error ? (
            <span className="mr-said mr-bad" role="alert">
              {error}
            </span>
          ) : (
            <span className="ser-count">{picked.size} selected</span>
          )}
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
