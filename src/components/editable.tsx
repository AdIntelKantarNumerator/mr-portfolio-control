'use client'

/**
 * A value you can click to change.
 *
 * Every field this wraps looks like text until you click it, then becomes the
 * right control for what it is — a list for a status, a date picker for a
 * date, a person picker for an owner. Nothing on the page announces itself as
 * a form, because most of the time nobody is editing and a screen full of
 * inputs is a screen nobody can read.
 *
 * WHY EMPTY IS STILL CLICKABLE
 *
 * "No owner" and "no date" are the values most worth fixing, and a gap you
 * cannot click is a gap you have to go somewhere else to fill. They render as
 * a muted prompt rather than as nothing.
 */
import { useActionState, useEffect, useRef, useState } from 'react'
import { setField, type FieldState } from '@/app/field-actions'

const EMPTY: FieldState = {}

export interface EditableProps {
  level: 'objective' | 'initiative' | 'project'
  id: string
  field: string
  /** What it says now. Null renders the prompt. */
  value: string | null
  /** The raw value the control starts from — an id, an ISO date, a status key. */
  raw?: string | null
  kind: 'choice' | 'person' | 'date' | 'number'
  /** For `number`: the range the control offers and the server enforces. */
  min?: number
  max?: number
  step?: number
  /** Drawn after the text — a progress bar, a unit. Not part of the hit area's label. */
  after?: React.ReactNode
  /** For `choice`: the values on offer, in the order they should appear. */
  options?: { value: string; label: string }[]
  /** For `person`: everybody the portfolio knows. */
  people?: { id: string; name: string }[]
  /** Shown when there is no value. */
  prompt?: string
  className?: string
  /** A dot, a badge — drawn before the text and left alone. */
  before?: React.ReactNode
}

export function Editable({
  level,
  id,
  field,
  value,
  raw,
  kind,
  options = [],
  people = [],
  prompt = 'set',
  className = '',
  before,
  after,
  min = 0,
  max = 100,
  step = 1,
}: EditableProps) {
  const [open, setOpen] = useState(false)
  const [state, act, busy] = useActionState(setField, EMPTY)
  const box = useRef<HTMLDivElement>(null)

  // Close on a click elsewhere or on escape. A popover that only closes by
  // saving traps somebody who opened it by accident.
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

  // Closing on a save, adjusted during render rather than in an effect: React
  // re-renders before painting, so the popover is never seen over the new
  // value.
  const [seen, setSeen] = useState(state.stamp)
  if (state.stamp !== seen) {
    setSeen(state.stamp)
    if (open) setOpen(false)
  }

  return (
    <span className={`ed ${className}`} ref={box as React.RefObject<HTMLDivElement>}>
      <button
        type="button"
        className={`ed-val${value ? '' : ' empty'}`}
        onClick={() => setOpen(!open)}
        title={`Click to change the ${field}`}
      >
        {before}
        {value ?? prompt}
        {after}
      </button>

      {open && (
        <form action={act} className="ed-pop">
          <input type="hidden" name="level" value={level} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="field" value={field} />

          {kind === 'choice' && (
            <select name="value" defaultValue={raw ?? ''} autoFocus>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}

          {kind === 'person' && (
            <select name="value" defaultValue={value ?? ''} autoFocus>
              <option value="">— nobody —</option>
              {people.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          )}

          {kind === 'date' && <input type="date" name="value" defaultValue={raw?.slice(0, 10) ?? ''} autoFocus />}

          {kind === 'number' && (
            <input type="number" name="value" min={min} max={max} step={step} defaultValue={raw ?? ''} autoFocus />
          )}

          <button type="submit" disabled={busy}>
            {busy ? '…' : 'Save'}
          </button>

          {state.error && (
            <span className="ed-err">
              {state.error}
              {state.suggestions?.length ? ` Did you mean ${state.suggestions.join(', or ')}?` : ''}
            </span>
          )}
        </form>
      )}
    </span>
  )
}
