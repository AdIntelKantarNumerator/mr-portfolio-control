'use client'

/**
 * Closing an entry, and putting one back.
 *
 * The comment box opens on the click rather than sitting there permanently.
 * Two reasons: a register of forty cards each carrying a textarea is unusable,
 * and a button that closes something the instant it is pressed is a button
 * people press by accident. Opening the box is the confirmation step, and it
 * costs a reader nothing.
 *
 * Who closed it is not asked for. It is the signed-in user, taken on the
 * server — a name typed into a box is exactly the field that gets filled in
 * wrong, or left as whoever used this laptop last.
 */
import { useActionState, useEffect, useRef, useState } from 'react'
import { moveEntry, reopenEntry, resolveEntry, type ActionState } from './actions'

const box =
  'w-full rounded-md border px-2.5 py-1.5 text-[12.5px] bg-[var(--surface)] border-[var(--line)]'

function Button({
  children,
  tone = 'quiet',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'quiet' | 'go' }) {
  return (
    <button
      {...rest}
      className="rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors disabled:opacity-50"
      style={
        tone === 'go'
          ? { background: 'var(--brand)', color: 'var(--surface)', borderColor: 'var(--brand)' }
          : { background: 'var(--surface)', color: 'var(--muted)', borderColor: 'var(--line)' }
      }
    >
      {children}
    </button>
  )
}

export function ResolveControl({
  id,
  refName,
  kind,
  resolved,
}: {
  id: string
  refName: string
  kind: string
  resolved: boolean
}) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<ActionState, FormData>(
    resolved ? reopenEntry : resolveEntry,
    {},
  )
  const field = useRef<HTMLTextAreaElement>(null)

  // Focus the box when it opens: the click was the intent, and making someone
  // then find the textarea with the mouse is a step for no reason.
  useEffect(() => {
    if (open) field.current?.focus()
  }, [open])

  // Nothing collapses this form on success, and nothing needs to: a save
  // revalidates the page, the row's resolvedAt changes, and the key on this
  // component changes with it - so React remounts it closed, showing the
  // opposite verb. The card flipping to "Resolved" with a new trail entry is
  // better confirmation than the word "Saved" ever was.

  const verb = resolved ? 'Reopen' : kind === 'blocker' ? 'Mark resolved' : 'Mark decided'
  const prompt = resolved
    ? 'Why is it open again?'
    : kind === 'blocker'
      ? 'What unblocked it?'
      : 'What was decided?'

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        {verb}
      </Button>
    )
  }

  return (
    <form action={action} className="flex w-full flex-col gap-1.5">
      <input type="hidden" name="id" value={id} />
      <label
        className="text-[11px] font-semibold uppercase tracking-[0.05em]"
        style={{ color: 'var(--muted)' }}
        htmlFor={`comment-${id}`}
      >
        {prompt}
      </label>
      <textarea
        id={`comment-${id}`}
        ref={field}
        name="comment"
        rows={2}
        required
        minLength={4}
        maxLength={1000}
        className={box}
        placeholder={
          resolved
            ? 'The vendor pushed the date again, so this is live once more.'
            : kind === 'blocker'
              ? 'IT granted the service account on Tuesday; the loader runs.'
              : 'Went with Snowflake. Rick signed off in the architecture review.'
        }
      />
      <div className="flex items-center gap-2">
        <Button type="submit" tone="go" disabled={pending}>
          {pending ? 'Saving…' : verb}
        </Button>
        <Button type="button" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        {/* Scoped to this entry: one card's error must not appear on forty. */}
        {state.error && (!state.ref || state.ref === refName) ? (
          <span className="text-[11.5px]" style={{ color: 'var(--red)' }} role="alert">
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  )
}

export interface WorkOption {
  /** "type:id" — one control for initiatives and projects together. */
  value: string
  label: string
}

/**
 * Put an entry on the piece of work it actually belongs to.
 *
 * Opens on click for the same reason the resolve box does: forty cards each
 * carrying a permanently visible dropdown is unusable, and a control that acts
 * on change is one people trigger by accident while scrolling.
 *
 * The reason field is optional. From-and-to is the record, and the honest
 * answer is nearly always "it was filed wrong" — asking someone to type that on
 * every correction is friction on exactly the task this exists to make easy.
 */
export function MoveControl({
  id,
  refName,
  current,
  options,
}: {
  id: string
  refName: string
  current: string | null
  options: WorkOption[]
}) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<ActionState, FormData>(moveEntry, {})

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        Move…
      </Button>
    )
  }

  return (
    <form action={action} className="flex w-full flex-col gap-1.5">
      <input type="hidden" name="id" value={id} />
      <label
        className="text-[11px] font-semibold uppercase tracking-[0.05em]"
        style={{ color: 'var(--muted)' }}
        htmlFor={`target-${id}`}
      >
        Which work does this belong to?
      </label>
      <select
        id={`target-${id}`}
        name="target"
        defaultValue={current ?? ''}
        required
        className={box}
      >
        <option value="" disabled>
          Pick an initiative or project…
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        name="reason"
        maxLength={300}
        className={box}
        placeholder="Optional — why it moved"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" tone="go" disabled={pending}>
          {pending ? 'Moving…' : 'Move'}
        </Button>
        <Button type="button" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        {state.error && (!state.ref || state.ref === refName) ? (
          <span className="text-[11.5px]" style={{ color: 'var(--red)' }} role="alert">
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  )
}
