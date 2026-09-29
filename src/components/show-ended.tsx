'use client'

/**
 * Show the closed and withdrawn work too.
 *
 * Hiding ended work by default is right — a list that grows forever stops
 * being read — but hiding it silently is how somebody concludes their project
 * was deleted. So the count is always on the control, even when it is off: the
 * page says "12 closed or withdrawn hidden" rather than saying nothing and
 * leaving the reader to wonder.
 *
 * In the URL like every other filter here, so a view can be sent to somebody
 * and arrive the same way.
 */
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

export function ShowEnded({
  hidden,
  path,
  noun = 'items',
}: {
  /** How many are being hidden right now. Zero hides the control entirely. */
  hidden: number
  /** Where to push to — this component is used on several pages. */
  path: string
  noun?: string
}) {
  const router = useRouter()
  const params = useSearchParams()
  const on = params.get('ended') === '1'

  const toggle = useCallback(() => {
    const next = new URLSearchParams(params.toString())
    if (on) next.delete('ended')
    else next.set('ended', '1')
    const qs = next.toString()
    router.push(qs ? `${path}?${qs}` : path, { scroll: false })
  }, [on, params, router, path])

  // Nothing is ended and nothing is being shown: the control would be a
  // permanent reminder of a state this portfolio has never been in.
  if (!on && hidden === 0) return null

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        className="rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
        style={{
          background: on ? 'var(--brand)' : 'var(--surface)',
          color: on ? 'var(--surface)' : 'var(--muted)',
          borderColor: on ? 'var(--brand)' : 'var(--line)',
        }}
      >
        {on ? 'Hide closed and withdrawn' : `Show closed and withdrawn (${hidden})`}
      </button>
      {on ? (
        <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
          Including {noun} that are finished or were dropped.
        </span>
      ) : null}
    </div>
  )
}
