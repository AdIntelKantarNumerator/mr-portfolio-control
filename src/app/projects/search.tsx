'use client'

/**
 * Search by name, key or the problem it was created to solve.
 *
 * The query goes in the URL rather than component state, for the same reason
 * the register's filters do: a search that found the thing can be sent to
 * somebody else, and the back button does what people expect.
 *
 * Debounced, because a keystroke-per-navigation on a server-rendered page is a
 * request per letter.
 */
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

export function ProjectSearch({ total }: { total: number }) {
  const router = useRouter()
  const params = useSearchParams()
  const current = params.get('q') ?? ''
  const [text, setText] = useState(current)

  useEffect(() => {
    if (text === current) return
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString())
      if (text.trim()) next.set('q', text.trim())
      else next.delete('q')
      const qs = next.toString()
      router.replace(qs ? `/projects?${qs}` : '/projects', { scroll: false })
    }, 200)
    return () => clearTimeout(timer)
  }, [text, current, params, router])

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <label
        htmlFor="project-search"
        className="text-[10.5px] font-bold uppercase tracking-[0.06em]"
        style={{ color: 'var(--muted)' }}
      >
        Find
      </label>
      <input
        id="project-search"
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Search ${total} projects by name, key or problem…`}
        className="min-w-[240px] flex-1 rounded-md border px-2.5 py-1.5 text-[12.5px]"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--ink)' }}
      />
    </div>
  )
}
