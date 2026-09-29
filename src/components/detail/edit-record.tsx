'use client'

/**
 * "Edit details" at the top of a record's page, and "+ New" on its children.
 *
 * WHY AT THE TOP RATHER THAN IN A FORM AT THE FOOT
 *
 * The initiative page carried a rename form below everything else, and the
 * project and workstream pages carried nothing at all: renaming one, or
 * moving it under a different parent, meant going to Linear or to the
 * grouping screen. Editing is the exception on a page whose job is to be
 * read, so it is a button next to the title rather than a form taking up the
 * bottom third of every visit.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createChild, editRecord, type RecordState } from '@/app/record-actions'

export interface Named {
  id: string
  name: string
}

export function EditRecordButton({
  level,
  id,
  name,
  description,
  parentId,
  parents,
}: {
  level: 'initiative' | 'project' | 'workstream'
  id: string
  name: string
  description: string
  /** Null for an initiative, which rolls up to nothing. */
  parentId: string | null
  parents: Named[]
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
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

const PARENT_LABEL = { project: 'Initiative', workstream: 'Project' } as const

function EditDialog({
  level,
  id,
  name,
  description,
  parentId,
  parents,
  onClose,
}: {
  level: 'initiative' | 'project' | 'workstream'
  id: string
  name: string
  description: string
  parentId: string | null
  parents: Named[]
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
      // Left out entirely for an initiative, so the action does not treat an
      // absent field as "detach from everything".
      ...(level === 'initiative' ? {} : { parentId: String(form.get('parentId') ?? '') }),
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

          {level !== 'initiative' && (
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

          <label className="mr-label" htmlFor="er-desc">
            Description
          </label>
          <textarea id="er-desc" name="description" rows={3} defaultValue={description} />

          <div className="mr-row">
            <button type="submit" className="mr-go" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {state.error ? <span className="mr-said mr-bad">{state.error}</span> : null}
            {level !== 'initiative' ? (
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
  level: 'project' | 'workstream'
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
