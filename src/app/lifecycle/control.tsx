'use client'

/**
 * Close it, withdraw it, or bring it back.
 *
 * Ended work gets the loud treatment — a banner saying so, and one button to
 * reopen — because the question on an ended page is always "is this really
 * over, and can I undo it". Live work gets a quiet status control that opens on
 * click, because on a page about work in flight this is not the point.
 */
import { useActionState, useState } from 'react'
import { INITIATIVE_STATUS, PROJECT_STATUS, isEnded, label, reopenedStatus } from '@/lib/domain'
import { setLifecycle, type LifecycleState } from './actions'

const field =
  'w-full rounded-md border px-2.5 py-1.5 text-[12.5px] bg-[var(--surface)] border-[var(--line)]'

function Btn({
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

export function LifecycleControl({
  kind,
  id,
  status,
}: {
  kind: 'project' | 'initiative'
  id: string
  status: string
}) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<LifecycleState, FormData>(setLifecycle, {})

  const ended = isEnded(status)
  const statuses: readonly string[] = kind === 'project' ? PROJECT_STATUS : INITIATIVE_STATUS
  const back = reopenedStatus(kind)

  if (ended && !open) {
    return (
      <div
        className="no-print flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-[12.5px]"
        style={{ background: 'var(--raised)', borderColor: 'var(--line)' }}
      >
        <span className="font-semibold">
          {status === 'canceled' ? 'Withdrawn' : 'Closed'} — hidden from the default lists.
        </span>
        <Btn type="button" onClick={() => setOpen(true)}>
          Reopen
        </Btn>
      </div>
    )
  }

  if (!open) {
    return (
      <div className="no-print">
        <Btn type="button" onClick={() => setOpen(true)}>
          Change status…
        </Btn>
      </div>
    )
  }

  return (
    <form
      action={action}
      className="no-print flex flex-col gap-1.5 rounded-md border px-3 py-2.5"
      style={{ background: 'var(--raised)', borderColor: 'var(--line)' }}
    >
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <label
        className="text-[11px] font-semibold uppercase tracking-[0.05em]"
        style={{ color: 'var(--muted)' }}
        htmlFor={`status-${id}`}
      >
        Status
      </label>
      <select id={`status-${id}`} name="status" defaultValue={ended ? back : status} className={field}>
        {statuses.map((s) => (
          <option key={s} value={s}>
            {label(`${kind}Status`, s)}
            {s === 'canceled' ? ' (withdrawn)' : ''}
            {s === 'completed' ? ' (closed)' : ''}
          </option>
        ))}
      </select>
      <textarea
        name="note"
        rows={2}
        maxLength={1000}
        className={field}
        placeholder={
          ended
            ? 'Why is it coming back?'
            : 'Why — required when closing or withdrawing, optional otherwise.'
        }
      />
      <div className="flex items-center gap-2">
        <Btn type="submit" tone="go" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Btn>
        <Btn type="button" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Btn>
        {state.error ? (
          <span className="text-[11.5px]" style={{ color: 'var(--red)' }} role="alert">
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  )
}
