'use client'

/**
 * "Edit details" at the top of a record's page, and "+ New" on its children.
 *
 * WHY AT THE TOP RATHER THAN IN A FORM AT THE FOOT
 *
 * The objective page carried a rename form below everything else, and the
 * initiative and project pages carried nothing at all: renaming one, or
 * moving it under a different parent, meant going to Linear or to the
 * grouping screen. Editing is the exception on a page whose job is to be
 * read, so it is a button next to the title rather than a form taking up the
 * bottom third of every visit.
 */
import { TIER_LABEL } from '@/lib/home-types'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createChild, editRecord, type RecordState } from '@/app/record-actions'

export interface Named {
  id: string
  name: string
}

/**
 * The window, as the dialog has to talk about it.
 *
 * Two dates and, for each end, what it would fall back to. A reader looking at
 * "Jun 17 → Oct 12 (rolled up)" and opening this dialog finds the fields empty,
 * which is correct — nobody typed those dates — and would be baffling without
 * the roll-up shown beside them as what emptiness currently means.
 */
export interface WindowEdit {
  /** yyyy-mm-dd, or '' when this end is rolled up. */
  startDate: string
  targetDate: string
  /** yyyy-mm-dd the roll-up gives when the field above is empty. */
  rolledStart: string
  rolledTarget: string
}

export function EditRecordButton({
  level,
  id,
  name,
  description,
  parentId,
  parents,
  window,
}: {
  level: 'objective' | 'initiative' | 'project'
  id: string
  name: string
  description: string
  /** Null for an objective, which rolls up to nothing. */
  parentId: string | null
  parents: Named[]
  window: WindowEdit
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="dhead-edit" onClick={() => setOpen(true)}>
        Edit details
      </button>
      {open && (
        <EditDialog
          level={level}
          id={id}
          name={name}
          description={description}
          parentId={parentId}
          parents={parents}
          window={window}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

const PARENT_LABEL = { initiative: TIER_LABEL.objective, project: TIER_LABEL.initiative } as const

function EditDialog({
  level,
  id,
  name,
  description,
  parentId,
  parents,
  window: win,
  onClose,
}: {
  level: 'objective' | 'initiative' | 'project'
  id: string
  name: string
  description: string
  parentId: string | null
  parents: Named[]
  window: WindowEdit
  onClose: () => void
}) {
  const router = useRouter()
  const [state, setState] = useState<RecordState>({})
  const [busy, setBusy] = useState(false)

  async function submit(form: FormData) {
    setBusy(true)
    const res = await editRecord({
      level,
      id,
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? ''),
      startDate: String(form.get('startDate') ?? ''),
      targetDate: String(form.get('targetDate') ?? ''),
      // Left out entirely for an objective, so the action does not treat an
      // absent field as "detach from everything".
      ...(level === 'objective' ? {} : { parentId: String(form.get('parentId') ?? '') }),
    }).catch((): RecordState => ({ error: 'That could not be saved.' }))
    setBusy(false)
    setState(res)
    if (res.ok) {
      router.refresh()
      onClose()
    }
  }

  return (
    <div className="modal-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Edit ${level}`}>
        <div className="modal-head">
          <h3>Edit {level}</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form action={submit}>
          <label className="mr-label" htmlFor="er-name">
            Name
          </label>
          <input id="er-name" name="name" defaultValue={name} required minLength={3} maxLength={200} />

          {level !== 'objective' && (
            <>
              <label className="mr-label" htmlFor="er-parent">
                {PARENT_LABEL[level]}
              </label>
              <select id="er-parent" name="parentId" defaultValue={parentId ?? ''}>
                <option value="">— not in {PARENT_LABEL[level].toLowerCase()} —</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          )}

          <div className="mr-grid">
            <span>
              <label className="mr-label" htmlFor="er-start">
                Start
              </label>
              <input id="er-start" type="date" name="startDate" defaultValue={win.startDate} />
            </span>
            <span>
              <label className="mr-label" htmlFor="er-target">
                Target
              </label>
              <input id="er-target" type="date" name="targetDate" defaultValue={win.targetDate} />
            </span>
            <span />
          </div>
          <p className="mr-hint">
            {win.startDate || win.targetDate ? (
              <>
                Typed dates win over the work beneath. Empty a field to give that end back to the roll-up
                {win.rolledStart || win.rolledTarget ? (
                  <>
                    {' '}
                    (which today would be {win.rolledStart || '—'} → {win.rolledTarget || '—'})
                  </>
                ) : null}
                .
              </>
            ) : win.rolledStart || win.rolledTarget ? (
              <>
                Both ends are rolled up from the work beneath — {win.rolledStart || '—'} →{' '}
                {win.rolledTarget || '—'}. Typing a date here replaces that end and stops it moving when the
                work below does.
              </>
            ) : (
              <>Nothing beneath carries a date, so this window is whatever you type here.</>
            )}
          </p>

          <label className="mr-label" htmlFor="er-desc">
            Description
          </label>
          <textarea id="er-desc" name="description" rows={3} defaultValue={description} />

          <div className="mr-row">
            <button type="submit" className="mr-go" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {state.error ? <span className="mr-said mr-bad">{state.error}</span> : null}
            {level !== 'objective' ? (
              <span className="mr-hint">
                Moving this changes every roll-up above it — the board, the timeline and the readiness matrix
                all follow.
              </span>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * "+ New" on a tier tile.
 *
 * The parent is fixed — it is the page you are on — so the only thing to ask
 * for is a name. Anything else has a sensible default and a place to be
 * edited afterwards, and a six-field dialog is how a quick capture stops
 * being quick.
 */
export function NewChildButton({
  level,
  parentId,
  label,
}: {
  level: 'initiative' | 'project'
  parentId: string
  label: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<RecordState>({})
  const [busy, setBusy] = useState(false)

  async function submit(form: FormData) {
    setBusy(true)
    const res = await createChild({
      level,
      parentId,
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? ''),
    }).catch((): RecordState => ({ error: 'That could not be created.' }))
    setBusy(false)
    setState(res)
    if (res.ok && res.href) router.push(res.href)
  }

  return (
    <>
      <button type="button" className="tile-add" onClick={() => setOpen(true)} title={`New ${label.toLowerCase()}`}>
        + New
      </button>
      {open && (
        <div className="modal-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={`New ${label.toLowerCase()}`}>
            <div className="modal-head">
              <h3>New {label.toLowerCase()}</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            <form action={submit}>
              <label className="mr-label" htmlFor="nc-name">
                Name
              </label>
              <input id="nc-name" name="name" required minLength={3} maxLength={200} autoFocus />

              <label className="mr-label" htmlFor="nc-desc">
                Description
              </label>
              <textarea id="nc-desc" name="description" rows={3} />

              <div className="mr-row">
                <button type="submit" className="mr-go" disabled={busy}>
                  {busy ? 'Creating…' : 'Create'}
                </button>
                {state.error ? <span className="mr-said mr-bad">{state.error}</span> : null}
                <span className="mr-hint">
                  It starts as planned, with no dates. You land on its page to fill the rest in.
                </span>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
