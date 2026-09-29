'use client'

/**
 * "I have read this and I stand behind it."
 *
 * Reviewing does not change the rating. Someone who disagrees enters their own
 * assessment — a different act, recorded differently — rather than quietly
 * editing a machine's words into their own.
 */
import { useTransition } from 'react'
import { reviewAssessment } from './review'

export function MarkReviewedButton({ assessmentId }: { assessmentId: string }) {
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => void reviewAssessment(assessmentId))}
      className="rounded-md border px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
      style={{ borderColor: 'var(--line)' }}
    >
      {pending ? 'marking…' : 'mark reviewed'}
    </button>
  )
}
