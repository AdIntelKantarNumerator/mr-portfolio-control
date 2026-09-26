'use client'

/**
 * The program review plan, edited where it belongs.
 *
 * Laid out as the slide reads — objective, detail, status, date, then the three
 * lists — because the people editing it have that slide in their heads and
 * anything else would need translating twice a fortnight.
 *
 * Each milestone is a collapsed summary that opens into a form. Five
 * milestones as five open forms is a page nobody can read; five summaries
 * with the status and date visible is the slide itself.
 */
import { useActionState, useState } from 'react'
import { WORKSTREAM_ITEM_STATE, WORKSTREAM_PHASE, WORKSTREAM_STATUS, label } from '@/lib/domain'
import {
  addPhase,
  addWorkstream,
  removePhase,
  removeWorkstream,
  setLeads,
  updateWorkstream,
  type WorkstreamState,
} from './milestone-actions'

export interface PhaseView {
  id: string
  phase: string
  label: string | null
  fromPeriod: string
  toPeriod: string
}

export interface WorkstreamView {
  id: string
  name: string
  details: string | null
  status: string
  targetLabel: string | null
  dependencies: string | null
  authoredBy: string | null
  /** What Yaara changed here since a person last looked, and why. */
  agentNote: string | null
  items: { state: string; text: string }[]
  phases: PhaseView[]
}

const field =
  'w-full rounded-md border px-2.5 py-1.5 text-[12.5px] bg-[var(--surface)] border-[var(--line)]'
const legend = 'text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]'

/** The deck's own colours, so a status means the same thing on both. */
const STATUS_COLOR: Record<string, string> = {
  planning: '#d9d9d9',
  on_track: '#93c47d',
  at_risk: '#ffd966',
  blocked: '#e06666',
  complete: '#6d9eeb',
}

function Btn({
  children,
  tone = 'quiet',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'quiet' | 'go' | 'danger' }) {
  const styles =
    tone === 'go'
      ? { background: 'var(--brand)', color: 'var(--surface)', borderColor: 'var(--brand)' }
      : tone === 'danger'
        ? { background: 'var(--surface)', color: 'var(--red)', borderColor: 'var(--line)' }
        : { background: 'var(--surface)', color: 'var(--muted)', borderColor: 'var(--line)' }
  return (
    <button
      {...rest}
      className="rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors disabled:opacity-50"
      style={styles}
    >
      {children}
    </button>
  )
}

function StatusChip({ status }: { status: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10.5px] font-bold"
      style={{ background: STATUS_COLOR[status] ?? '#d9d9d9', color: '#1a1a1a' }}
    >
      {label('workstreamStatus', status)}
    </span>
  )
}

function bulletsFor(w: WorkstreamView, state: string) {
  return w.items
    .filter((i) => i.state === state)
    .map((i) => i.text)
    .join('\n')
}

function PhaseEditor({ w, workstreamId }: { w: WorkstreamView; workstreamId: string }) {
  const [state, action, pending] = useActionState<WorkstreamState, FormData>(addPhase, {})
  const [, removeAction] = useActionState<WorkstreamState, FormData>(removePhase, {})

  return (
    <div className="mt-3">
      <div className={legend}>Release calendar</div>
      {w.phases.length > 0 ? (
        <ul className="m-0 mb-1.5 mt-1 flex flex-wrap list-none gap-1.5 p-0">
          {w.phases
            .slice()
            .sort((a, b) => a.fromPeriod.localeCompare(b.fromPeriod))
            .map((p) => (
              <li key={p.id} className="flex items-center gap-1 text-[11.5px]">
                <span
                  className="rounded px-1.5 py-0.5"
                  style={{ background: 'var(--raised)', border: '1px solid var(--line)' }}
                >
                  {p.label || label('workstreamPhase', p.phase)} · {p.fromPeriod}
                  {p.toPeriod !== p.fromPeriod ? ` → ${p.toPeriod}` : ''}
                </span>
                <form action={removeAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="workstreamId" value={workstreamId} />
                  <button
                    type="submit"
                    aria-label={`Remove ${p.phase} band`}
                    className="px-1 text-[13px] leading-none"
                    style={{ color: 'var(--muted)' }}
                  >
                    ×
                  </button>
                </form>
              </li>
            ))}
        </ul>
      ) : null}

      <form action={action} className="flex flex-wrap items-end gap-1.5">
        <input type="hidden" name="milestoneId" value={w.id} />
        <input type="hidden" name="workstreamId" value={workstreamId} />
        <select name="phase" className="rounded-md border px-2 py-1 text-[11.5px]" defaultValue="development">
          {WORKSTREAM_PHASE.map((p) => (
            <option key={p} value={p}>
              {label('workstreamPhase', p)}
            </option>
          ))}
        </select>
        <input name="fromPeriod" placeholder="2026-07" className="w-[92px] rounded-md border px-2 py-1 text-[11.5px]" />
        <input name="toPeriod" placeholder="2026-09" className="w-[92px] rounded-md border px-2 py-1 text-[11.5px]" />
        <input name="label" placeholder="label, if not the phase" className="w-[160px] rounded-md border px-2 py-1 text-[11.5px]" />
        <Btn type="submit" disabled={pending}>
          Add band
        </Btn>
        {state.error ? (
          <span className="text-[11.5px]" style={{ color: 'var(--red)' }} role="alert">
            {state.error}
          </span>
        ) : null}
      </form>
    </div>
  )
}

function Row({ w, workstreamId }: { w: WorkstreamView; workstreamId: string }) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<WorkstreamState, FormData>(updateWorkstream, {})
  const [, deleteAction] = useActionState<WorkstreamState, FormData>(removeWorkstream, {})

  return (
    <li className="rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--line)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={w.status} />
        <span className="text-[13px] font-semibold">{w.name}</span>
        {w.targetLabel ? (
          <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
            {w.targetLabel}
          </span>
        ) : null}
        {/* Read off a deck and nobody has checked it. Same flag the register
            uses, for the same reason. */}
        {w.authoredBy ? (
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
            read by {w.authoredBy}
          </span>
        ) : null}
        <span className="ml-auto">
          <Btn type="button" onClick={() => setOpen(!open)}>
            {open ? 'Close' : 'Edit'}
          </Btn>
        </span>
      </div>

      {!open && w.details ? (
        <p className="m-0 mt-1 text-[12.5px]" style={{ color: 'var(--muted)' }}>
          {w.details}
        </p>
      ) : null}

      {/*
        What she changed here since a person last looked.

        On the page as well as the slide, and deliberately: the owner should be
        able to disagree with her here, quietly, rather than first seeing it
        projected in a room. Editing the row clears it.
      */}
      {w.agentNote ? (
        <div
          className="mt-1.5 rounded-md border px-2 py-1.5"
          style={{ borderColor: 'var(--line)', background: 'var(--surface-2, transparent)' }}
        >
          <p className={legend} style={{ margin: 0 }}>
            Changed by Yaara since you last edited this
          </p>
          <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
            {w.agentNote
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => (
                <li key={line} className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                  {line}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {open ? (
        <>
          <form action={action} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="id" value={w.id} />
            <input type="hidden" name="workstreamId" value={workstreamId} />

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={legend}>Objective</span>
                <input name="name" defaultValue={w.name} className={field} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={legend}>Status</span>
                <select name="status" defaultValue={w.status} className={field}>
                  {WORKSTREAM_STATUS.map((s) => (
                    <option key={s} value={s}>
                      {label('workstreamStatus', s)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className={legend}>Details</span>
              <textarea name="details" rows={2} defaultValue={w.details ?? ''} className={field} />
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={legend}>Date</span>
                <input
                  name="targetLabel"
                  defaultValue={w.targetLabel ?? ''}
                  placeholder="9/30, Q3/Q4, Jan 2027 — however you say it"
                  className={field}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={legend}>Key dependencies</span>
                <input name="dependencies" defaultValue={w.dependencies ?? ''} className={field} />
              </label>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              {WORKSTREAM_ITEM_STATE.map((s) => (
                <label key={s} className="flex flex-col gap-1">
                  <span className={legend}>{label('workstreamItemState', s)}</span>
                  <textarea
                    name={`items_${s}`}
                    rows={4}
                    defaultValue={bulletsFor(w, s)}
                    placeholder="One per line"
                    className={field}
                  />
                </label>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Btn type="submit" tone="go" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Btn>
              {state.error ? (
                <span className="text-[11.5px]" style={{ color: 'var(--red)' }} role="alert">
                  {state.error}
                </span>
              ) : null}
            </div>
          </form>

          <PhaseEditor w={w} workstreamId={workstreamId} />

          <form action={deleteAction} className="mt-3">
            <input type="hidden" name="id" value={w.id} />
            <input type="hidden" name="workstreamId" value={workstreamId} />
            <Btn type="submit" tone="danger">
              Remove this milestone
            </Btn>
          </form>
        </>
      ) : null}
    </li>
  )
}

export function Milestones({
  workstreamId,
  milestones,
  devLead,
  programLead,
}: {
  workstreamId: string
  milestones: WorkstreamView[]
  devLead: string | null
  programLead: string | null
}) {
  const [addState, addAction, adding] = useActionState<WorkstreamState, FormData>(addWorkstream, {})
  const [, leadsAction] = useActionState<WorkstreamState, FormData>(setLeads, {})

  return (
    <div className="no-print flex flex-col gap-3">
      <form action={leadsAction} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className={legend}>Dev</span>
          <input
            name="devLead"
            defaultValue={devLead ?? ''}
            placeholder="Scott &amp; Sadiya"
            className="rounded-md border px-2.5 py-1.5 text-[12.5px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={legend}>Program</span>
          <input
            name="programLead"
            defaultValue={programLead ?? ''}
            placeholder="Spencer"
            className="rounded-md border px-2.5 py-1.5 text-[12.5px]"
          />
        </label>
        <input type="hidden" name="workstreamId" value={workstreamId} />
        <Btn type="submit">Save names</Btn>
      </form>

      {milestones.length === 0 ? (
        <p className="m-0 text-[12.5px]" style={{ color: 'var(--muted)' }}>
          No milestones yet — add the first one below, or send Yaara a program review deck and she
          will read them off it.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {milestones.map((w) => (
            <Row key={w.id} w={w} workstreamId={workstreamId} />
          ))}
        </ul>
      )}

      {/*
        Boxed, headed, and with its button next to its fields.
        Before this it was a bare row of two inputs with the button floated to
        the far right edge of the card — which read as part of the empty-state
        message rather than as a form, and the first person to look for "a way
        to add a milestone" did not find one. The placeholders made it worse:
        grey sample text in an unlabelled row looks like content, not an input.
      */}
      <form
        action={addAction}
        className="flex flex-col gap-2 rounded-lg border border-dashed p-3"
        style={{ borderColor: 'var(--line)' }}
      >
        <span className={legend}>Add a milestone</span>
        <input type="hidden" name="workstreamId" value={workstreamId} />

        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className={legend}>Objective</span>
            <input name="name" placeholder="Sports Dashboard MVP" className={field} required />
          </label>
          <label className="flex min-w-[240px] flex-[2] flex-col gap-1">
            <span className={legend}>Details</span>
            <input name="details" placeholder="What it actually is" className={field} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Btn type="submit" tone="go" disabled={adding}>
            {adding ? 'Adding…' : 'Add milestone'}
          </Btn>
          <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
            Status, target date and the three lists are set once it exists.
          </span>
          {addState.error ? (
            <span className="text-[11.5px]" style={{ color: 'var(--red)' }} role="alert">
              {addState.error}
            </span>
          ) : null}
        </div>
      </form>
    </div>
  )
}
