'use client'

/**
 * The timeline's controls.
 *
 * The same four the home board has, in the same order, with the same words —
 * a reader who has learned one has learned the other. The two extra switches
 * are this chart's own: whether ended work is drawn, and whether the
 * dependency lines are.
 *
 * Everything goes in the URL rather than in component state, because the chart
 * is rendered on the server and because a particular view of the timeline is
 * the kind of thing people send each other.
 */
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

export function TimelineControls({
  level,
  sort,
  find,
  show,
  links,
  count,
}: {
  level: string
  sort: string
  find: string
  show: 'live' | 'all'
  links: boolean
  count: number
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [text, setText] = useState(find)

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    router.push(`/roadmap${next.toString() ? `?${next}` : ''}`)
  }

  return (
    <div className="rt-bar">
      <label className="rt-f">
        <span>Showing</span>
        <select value={level} onChange={(e) => go({ level: e.target.value })}>
          <option value="initiative">Initiatives</option>
          <option value="project">Projects</option>
          <option value="workstream">Workstreams</option>
        </select>
      </label>

      <label className="rt-f">
        <span>Sort by</span>
        <select value={sort} onChange={(e) => go({ sort: e.target.value })}>
          <option value="active">Most active</option>
          <option value="quiet">Quietest</option>
          <option value="name">Name</option>
          <option value="custom">Custom</option>
        </select>
      </label>

      <label className="rt-f">
        <span>Health</span>
        <select value={show} onChange={(e) => go({ show: e.target.value === 'all' ? 'all' : null })}>
          <option value="live">Live only</option>
          <option value="all">Include ended</option>
        </select>
      </label>

      <label className="rt-f">
        <span>Find</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go({ find: text })
          }}
          onBlur={() => {
            if (text !== find) go({ find: text })
          }}
          placeholder="Find…"
        />
      </label>

      <label className="tl-toggle">
        <input type="checkbox" checked={links} onChange={(e) => go({ links: e.target.checked ? null : '0' })} />
        <span>Dependencies</span>
      </label>

      <span className="rt-count">{count}</span>
    </div>
  )
}
