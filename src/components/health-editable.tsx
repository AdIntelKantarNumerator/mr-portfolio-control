'use client'

/**
 * The health badge, clickable.
 *
 * It looks exactly like the read-only badge — same pill, same dot, same word
 * — because a row of controls reads as a form and a form reads as work.
 * Clicking it opens the only two questions an assessment answers: what
 * colour, and why.
 *
 * WHY "NEEDS INPUT" IS THE IMPORTANT CASE
 *
 * That badge is the app asking a question. Everywhere it appeared, the answer
 * had to be given on another screen, so it mostly went unanswered. This makes
 * the question and the answer the same click.
 */
import { useActionState, useEffect, useRef, useState } from 'react'
import { setHealth, type HealthState } from '@/app/health-actions'

const EMPTY: HealthState = {}

const RAGS = [
  { value: 'green', label: 'On track' },
  { value: 'amber', label: 'At risk' },
  { value: 'red', label: 'In trouble' },
  { value: 'unknown', label: 'Needs input' },
] as const

const TONE: Record<string, string> = {
  green: 'tone-green',
  amber: 'tone-amber',
  red: 'tone-red',
  unknown: 'tone-slate',
}

const WORD: Record<string, string> = {
  green: 'On track',
  amber: 'At risk',
  red: 'In trouble',
  unknown: 'Needs input',
}

export interface HealthEditableProps {
  level: 'initiative' | 'project' | 'workstream'
  id: string
  rag: string
  rationale?: string | null
  evidence?: string | null
  /** 'assessed' | 'source' | 'none' — shown in the tooltip, not on the pill. */
  origin?: string
}

export function HealthEditable({ level, id, rag, rationale, evidence, origin }: HealthEditableProps) {
  const [open, setOpen] = useState(false)
  const [state, act, busy] = useActionState(setHealth, EMPTY)
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  // Closed during render rather than in an effect, so the popover is never
  // painted over the value it just changed.
  const [seen, setSeen] = useState(state.stamp)
  if (state.stamp !== seen) {
    setSeen(state.stamp)
    if (open && state.ok) setOpen(false)
  }

  const tip = [
    WORD[rag] ?? rag,
    rationale,
    evidence ? `Evidence: ${evidence}` : null,
    origin === 'assessed' ? 'Assessed' : origin === 'source' ? 'From the source system' : 'Nobody has assessed this',
    'Click to record an assessment.',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <span className="ed hb" ref={box}>
      <button type="button" className={`pill ${TONE[rag] ?? 'tone-slate'} hb-btn`} onClick={() => setOpen(!open)} title={tip}>
        <span className={`rag-dot bg-rag-${rag}`} aria-hidden="true" />
        {WORD[rag] ?? rag}
      </button>

      {open && (
        <form action={act} className="ed-pop hb-pop">
          <input type="hidden" name="level" value={level} />
          <input type="hidden" name="id" value={id} />

          <label>
            <span>Health</span>
            <select name="rag" defaultValue={rag} autoFocus>
              {RAGS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Why</span>
            <textarea
              name="rationale"
              rows={3}
              maxLength={600}
              defaultValue={rationale ?? ''}
              placeholder="What is actually going on, in a sentence."
              required
            />
          </label>

          <label>
            <span>How you know</span>
            <input
              name="evidence"
              maxLength={200}
              defaultValue={evidence ?? ''}
              placeholder="A meeting, a deck, a ticket"
            />
          </label>

          <div className="hb-foot">
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {state.error && <span className="ed-err flow">{state.error}</span>}
          </div>
        </form>
      )}
    </span>
  )
}
