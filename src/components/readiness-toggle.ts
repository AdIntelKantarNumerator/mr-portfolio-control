'use client'

/**
 * Ticking readiness items off, on whichever screen you are looking at.
 *
 * THREE ATTEMPTS, AND WHY THIS ONE IS DIFFERENT
 *
 * The detail tile once drew straight from the server value with no local state
 * at all, so a click showed nothing until a write, three revalidations and a
 * re-render had completed. That was the pause.
 *
 * The Readiness matrix kept a `useState` copy seeded from the prop, which made
 * the click instant but never reconciled, and re-seeded on every remount.
 *
 * Then both moved to `useOptimistic`, on the reasoning that a server action's
 * `revalidatePath` is applied before its transition completes — so the value
 * shown when the transition ended would be the value just written. That is
 * true of one action at a time. It is not true of a dozen: somebody filling in
 * a checklist sets off a write per tick, the page refreshes those trigger are
 * coalesced, and the transitions end against a prop still holding what the
 * page first rendered with. Everything reverted at once, which is what it
 * looked like: tick the lot, watch the lot untick.
 *
 * WHAT THIS DOES INSTEAD
 *
 * Two changes, both about where things live rather than which hook is used.
 *
 * THE STATE LIVES ON THE SURFACE, NOT ON THE ITEM. One board per page holds
 * every unconfirmed edit, keyed by workstream and item. The checklist closes a
 * section when you open another, which unmounts its rows — and state held on a
 * row goes with it, which is why a section you came back to had forgotten what
 * you did in it.
 *
 * THE WRITE IS NOT A TRANSITION. It was `startTransition(async () => …)`,
 * which ties the request's life to the component that fired it. Closing a
 * section while its writes were still queued dropped them: fourteen ticks,
 * eleven rows. A plain promise is not anybody's to cancel.
 *
 * What is drawn is decided by the comparative rule in lib/readiness-status,
 * which needs no ordering guarantee — there isn't one to rely on. The refresh
 * that reconciles everything is debounced, because a checklist is filled in in
 * bursts and fourteen page refreshes to settle fourteen ticks is thirteen too
 * many.
 *
 * The buttons are never disabled while saving. The way to fill in a checklist
 * is to run down it, and locking each row until a page round trip finished was
 * its own kind of wrong.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toggleReadinessItem } from '@/app/readiness/actions'
import { editKey, settled, settleStatus, type PendingEdit } from '@/lib/readiness-status'

// Re-exported so a surface imports the board and the rules from one place.
export { nextStatus } from '@/lib/readiness-status'

/** How long after the last write to ask the page for fresh data, in ms. */
const SETTLE = 450

export interface ReadinessBoard {
  /** What to draw for this item, given what the server currently says. */
  statusOf: (workstreamId: string, itemId: string, server: string) => string
  /** True while this item's write is in the air. */
  savingOf: (workstreamId: string, itemId: string) => boolean
  /** What went wrong with this item's last write, if anything. */
  errorOf: (workstreamId: string, itemId: string) => string | null
  /** Set an item's status. Safe to call again before the last one lands. */
  set: (workstreamId: string, itemId: string, server: string, next: string) => void
}

/** The same map without one key, leaving the original alone. */
function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map
  const next = { ...map }
  delete next[key]
  return next
}

export function useReadinessBoard(): ReadinessBoard {
  const [edits, setEdits] = useState<Record<string, PendingEdit>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const refreshSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => router.refresh(), SETTLE)
  }, [router])

  const set = useCallback(
    (workstreamId: string, itemId: string, server: string, next: string) => {
      const key = editKey(workstreamId, itemId)

      setEdits((e) => ({
        ...e,
        // `base` is the server's word at the FIRST click of a run, kept across
        // later clicks: tick then untick then tick again is still one edit
        // waiting on one answer.
        [key]: { want: next, base: e[key]?.base ?? server },
      }))
      setErrors((x) => without(x, key))
      setSaving((s) => ({ ...s, [key]: true }))

      void (async () => {
        const fd = new FormData()
        fd.set('workstreamId', workstreamId)
        fd.set('itemId', itemId)
        fd.set('status', next)
        let failed: string | null = null
        try {
          const res = await toggleReadinessItem({}, fd)
          failed = res.error ?? null
        } catch {
          failed = 'That did not save. Try again.'
        }
        setSaving((x) => without(x, key))
        if (failed) {
          // Drop the edit as well as reporting it, so the box goes back to
          // what is actually stored rather than sitting there looking saved.
          setErrors((x) => ({ ...x, [key]: failed }))
          setEdits((x) => without(x, key))
        } else {
          refreshSoon()
        }
      })()
    },
    [refreshSoon],
  )

  /*
   * Forget an edit once the server has said something about it. Done here
   * rather than where the value is read, because reading must stay pure —
   * every row calls it on every render.
   */
  const forget = useCallback((key: string) => {
    setEdits((x) => without(x, key))
  }, [])

  const statusOf = useCallback(
    (workstreamId: string, itemId: string, server: string) => {
      const key = editKey(workstreamId, itemId)
      const edit = edits[key]
      if (edit && settled(server, edit)) queueMicrotask(() => forget(key))
      return settleStatus(server, edit)
    },
    [edits, forget],
  )

  return {
    statusOf,
    savingOf: (w, i) => Boolean(saving[editKey(w, i)]),
    errorOf: (w, i) => errors[editKey(w, i)] ?? null,
    set,
  }
}
