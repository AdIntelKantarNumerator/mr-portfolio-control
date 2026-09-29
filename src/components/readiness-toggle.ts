'use client'

/**
 * Ticking a readiness item, on whichever screen you are looking at.
 *
 * WHAT WAS WRONG, TWICE
 *
 * The two surfaces that show this checklist got it wrong in opposite ways.
 *
 * The tile on a detail page drew straight from the server value and had no
 * local state at all, so a click did nothing visible until the whole page had
 * been round-tripped — a write, three revalidations and a re-render. That is
 * the pause.
 *
 * The matrix on the Readiness page kept its own `useState` copy seeded from
 * the prop. That made the click instant, but the copy never reconciled with
 * the server afterwards, and `useState` re-seeds whenever the component
 * remounts — so a refresh carrying a value the write had not landed in yet
 * put the old tick back. Check one, check another, and the first appears to
 * undo itself.
 *
 * WHAT THIS DOES
 *
 * `useOptimistic` layers the click over the server value rather than copying
 * it. The tick is immediate, and when the action settles the value shown goes
 * back to being whatever the server says — which by then is the value that
 * was just written, because a server action's `revalidatePath` is applied
 * before its transition completes. The two can no longer disagree, because
 * there is only one of them.
 *
 * The button is not disabled while saving. It was, and on a checklist that is
 * its own kind of wrong: the natural way to fill one in is to run down it,
 * and every tick locked the row until a full page round trip had finished.
 */
import { useOptimistic, useState, useTransition } from 'react'
import { toggleReadinessItem } from '@/app/readiness/actions'

// Re-exported so both surfaces import the hook and the rule from one place.
export { nextStatus } from '@/lib/readiness-status'

export interface ReadinessToggle {
  /** What to draw: the click if one is in flight, otherwise the server's word. */
  status: string
  pending: boolean
  error: string | null
  /** Set the item to a status. Safe to call again before the last one lands. */
  set: (status: string) => void
}

export function useReadinessToggle(
  workstreamId: string,
  itemId: string,
  current: string,
): ReadinessToggle {
  const [status, show] = useOptimistic(current)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const set = (next: string) => {
    startTransition(async () => {
      // Inside the transition, which is the only place an optimistic update
      // is allowed to happen and the thing that ties it to the action's life.
      show(next)
      setError(null)
      const fd = new FormData()
      fd.set('workstreamId', workstreamId)
      fd.set('itemId', itemId)
      fd.set('status', next)
      const res = await toggleReadinessItem({}, fd)
      if (res.error) setError(res.error)
    })
  }

  return { status, pending, error, set }
}
