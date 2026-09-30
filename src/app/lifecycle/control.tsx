'use client'

/**
 * Close it, withdraw it, or bring it back.
 *
 * Ended work gets the loud treatment — a banner saying so, and one button to
 * reopen — because the question on an ended page is always "is this really
 * over, and can I undo it". Live work gets a quiet status control that opens on
 * click, because on a page about work in flight this is not the point.
 *
 * A Strategic Objective can also be deleted, when nothing is filed under it.
 * That sits behind its own button and a typed name, well away from Save.
 */
import { useActionState, useState } from 'react'
import {
  INITIATIVE_STATUS,
  OBJECTIVE_STATUS,
  PROJECT_STATUS_SET,
  isEnded,
  reopenedStatus,
  tierStatusLabel,
} from '@/lib/domain'
import { deleteObjective, type GroupState } from '@/app/objectives/actions'
import { setLifecycle, type LifecycleState } from './actions'

type Kind = 'project' | 'initiative' | 'objective'

const STATUSES: Record<Kind, readonly string[]> = {
  project: PROJECT_STATUS_SET,
  initiative: INITIATIVE_STATUS,
  objective: OBJECTIVE_STATUS,
}

/** What the option says. The ending states get the words people use. */
function optionLabel(kind: Kind, s: string): string {
  if (s === 'canceled') return kind === 'objective' ? 'Withdraw' : `${tierStatusLabel(kind, s)} (withdrawn)`
  if (s === 'completed') return kind === 'objective' ? 'Close' : `${tierStatusLabel(kind, s)} (closed)`
  return tierStatusLabel(kind, s)
}

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
  liveChildren = 0,
  deletion,
}: {
  kind: Kind
  id: string
  status: string
  /** Live initiatives beneath an objective, which ending it takes off the home page. */
  liveChildren?: number
  /**
   * Objectives only. `blockers` says what has to move before it can go; while
   * it is set the panel explains that instead of asking for the name.
   */
  deletion?: { name: string; summary: string; blockers: string | null }
}) {
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [state, action, pending] = useActionState<LifecycleState, FormData>(setLifecycle, {})

  const ended = isEnded(status)
  // Live work is only ever ended here: moving between live states is the
  // pill's job, which keeps the two controls from being two ways to do one
  // thing. Ended work can go anywhere but where it is.
  const statuses = STATUSES[kind].filter((s) => (ended ? s !== status : isEnded(s)))
  const back = reopenedStatus(kind)
  const chosen = picked ?? (ended ? back : statuses[0])

  if (deleting && deletion) {
    return <DeleteObjective id={id} {...deletion} onCancel={() => setDeleting(false)} />
  }

  const del = deletion ? (
    <Btn type="button" onClick={() => setDeleting(true)}>
      Delete…
    </Btn>
  ) : null

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
        {del}
      </div>
    )
  }

  if (!open) {
    return (
      <div className="no-print flex items-center gap-2">
        <Btn type="button" onClick={() => setOpen(true)}>
          Close or withdraw…
        </Btn>
        {del}
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
      <select
        id={`status-${id}`}
        name="status"
        value={chosen}
        onChange={(e) => setPicked(e.target.value)}
        className={field}
      >
        {statuses.map((s) => (
          <option key={s} value={s}>
            {optionLabel(kind, s)}
          </option>
        ))}
      </select>
      {isEnded(chosen) && !ended && liveChildren > 0 ? (
        <p className="text-[11.5px]" style={{ color: 'var(--red)' }}>
          {liveChildren} live initiative{liveChildren === 1 ? '' : 's'} will drop off the home page with it. Move{' '}
          {liveChildren === 1 ? 'it' : 'them'} to another objective first if the work carries on.
        </p>
      ) : null}
      <textarea
        name="note"
        rows={2}
        maxLength={1000}
        className={field}
        placeholder={
          ended
            ? 'Why is it coming back? Required when reopening.'
            : 'Why is it ending? Required.'
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

/**
 * The delete confirm. Says what goes with it, and wants the name typed.
 */
function DeleteObjective({
  id,
  name,
  summary,
  blockers,
  onCancel,
}: {
  id: string
  name: string
  summary: string
  blockers: string | null
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const [state, action, pending] = useActionState<GroupState, FormData>(deleteObjective, {})
  const matches = typed.trim() === name.trim()

  // Something has to move first. Said plainly, with where to do it, and with
  // nothing to type or click that could look like it might work anyway.
  if (blockers) {
    return (
      <div
        className="no-print flex flex-col gap-1.5 rounded-md border px-3 py-2.5"
        style={{ background: 'var(--raised)', borderColor: 'var(--line)' }}
        role="status"
      >
        <p className="text-[12.5px] font-semibold">This Strategic Objective cannot be deleted yet.</p>
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
          {blockers}
        </p>
        <div>
          <Btn type="button" onClick={onCancel}>
            OK
          </Btn>
        </div>
      </div>
    )
  }

  return (
    <form
      action={action}
      className="no-print flex flex-col gap-1.5 rounded-md border px-3 py-2.5"
      style={{ background: 'var(--raised)', borderColor: 'var(--red)' }}
    >
      <input type="hidden" name="id" value={id} />
      <p className="text-[12.5px] font-semibold">Delete this Strategic Objective permanently?</p>
      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
        This cannot be undone. {summary} The changelog keeps a record that it existed.
      </p>
      <label className="text-[11.5px]" htmlFor={`confirm-${id}`} style={{ color: 'var(--muted)' }}>
        Type <b>{name}</b> to confirm
      </label>
      <input
        id={`confirm-${id}`}
        name="confirmName"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        className={field}
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!matches || pending}
          className="rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--red)', color: 'var(--surface)', borderColor: 'var(--red)' }}
        >
          {pending ? 'Deleting…' : 'Delete permanently'}
        </button>
        <Btn type="button" onClick={onCancel} disabled={pending}>
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
