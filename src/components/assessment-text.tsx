'use client'

/**
 * An agent's sentence, with a pencil next to it.
 *
 * It sits beside "mark reviewed" because the two are the honest pair of
 * answers to reading a machine-written line: it is right, or it is nearly
 * right. Without the second one, a sentence that was 90% correct either got
 * reviewed as though it were 100% correct, or sat unreviewed forever — and
 * neither of those is a record of what anybody knows.
 *
 * Editing re-bylines the sentence. The card says who wrote it, and after an
 * edit that is you; the agent's original goes to the changelog rather than
 * being overwritten silently.
 */
import { useActionState, useEffect, useRef, useState } from 'react'
import { editAssessmentText, type HealthState } from '@/app/health-actions'

const EMPTY: HealthState = {}

export function AssessmentText({
  id,
  text,
  canEdit = true,
}: {
  id: string
  text: string
  /** False where the reader cannot be attributed; the text still renders. */
  canEdit?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [state, act, busy] = useActionState(editAssessmentText, EMPTY)
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open])

  // Closed during render on a successful save, so the form is never painted
  // over the text it just changed.
  const [seen, setSeen] = useState(state.stamp)
  if (state.stamp !== seen) {
    setSeen(state.stamp)
    if (open && state.ok) setOpen(false)
  }

  if (!canEdit) return <span className="text-[12.5px]">{text}</span>

  return (
    <span className="atext" ref={box}>
      {open ? (
        <form action={act} className="atext-form">
          <input type="hidden" name="id" value={id} />
          <textarea name="rationale" rows={3} maxLength={600} defaultValue={text} autoFocus required />
          <span className="atext-foot">
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save as mine'}
            </button>
            <button type="button" className="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            {state.error && <em className="err">{state.error}</em>}
          </span>
        </form>
      ) : (
        <>
          <span className="text-[12.5px]">{text}</span>
          <button
            type="button"
            className="atext-edit"
            onClick={() => setOpen(true)}
            title="Rewrite this in your own words"
            aria-label="Edit this assessment"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M11.4 1.9a1.5 1.5 0 0 1 2.1 2.1l-8 8L2 13l1-3.5 8.4-7.6Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </>
      )}
    </span>
  )
}
