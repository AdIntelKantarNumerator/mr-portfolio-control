'use client'

/**
 * Putting tables into datasets from where the tables are, rather than from
 * inside each dataset.
 *
 * Added 2 October 2026: the Tables tab could show that a table was in no
 * dataset but not do anything about it, and finding them meant scrolling the
 * whole list. Now the tab filters to "Not in a dataset", and in edit mode each
 * row has a tick box and this bar adds the ticked tables to an existing
 * dataset or a new one. A table's own page can add it to a dataset or take it
 * out of one.
 *
 * The row tick boxes are plain inputs rendered by the server page with
 * form="dd-bulk", so they belong to the bar's form without the page having to
 * be a client component. The bar counts them by listening for changes.
 */
import { useActionState, useEffect, useState, useTransition } from 'react'
import { addTablesToDataset, removeTableFromDataset, type DictState } from './actions'

export const BULK_FORM = 'dd-bulk'
const NEW = '__new__'

type DatasetOption = { id: string; name: string }

function boxes(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${BULK_FORM}"][name="table"]`)]
}

/** The bar above the table in edit mode. */
export function BulkAssignBar({ datasets }: { datasets: DatasetOption[] }) {
  const [state, action, pending] = useActionState<DictState, FormData>(addTablesToDataset, {})
  const [count, setCount] = useState(0)
  const [choice, setChoice] = useState('')

  useEffect(() => {
    const recount = () => setCount(boxes().filter((b) => b.checked).length)
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement | null
      if (t?.getAttribute('form') === BULK_FORM) recount()
    }
    document.addEventListener('change', onChange)
    return () => document.removeEventListener('change', onChange)
  }, [])

  // After a successful add, untick everything so the next batch starts clean.
  // An effect, because it touches inputs this component does not render. The
  // count follows from the change event on a row box, which the listener above
  // hears, rather than being set here.
  useEffect(() => {
    if (!state.ok || !state.stamp) return
    const all = boxes()
    for (const b of all) b.checked = false
    all[0]?.dispatchEvent(new Event('change', { bubbles: true }))
  }, [state.ok, state.stamp])

  return (
    <form id={BULK_FORM} action={action} className="dd-bulk">
      <b>{count} selected</b>
      <span className="dd-quiet">Add to</span>
      <select name="datasetId" value={choice === NEW ? '' : choice} onChange={(e) => setChoice(e.target.value)} aria-label="Dataset to add them to">
        <option value="">choose a dataset…</option>
        {datasets.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
        <option value={NEW}>+ New dataset…</option>
      </select>
      {choice === NEW ? <input name="newName" placeholder="New dataset name" maxLength={120} aria-label="New dataset name" autoFocus /> : null}
      <button type="submit" className="btn btn-primary" disabled={pending || count === 0 || !choice}>
        {pending ? 'Adding…' : 'Add to dataset'}
      </button>
      {state.error ? <span className="dd-bulk-msg dd-bad">{state.error}</span> : null}
      {state.ok && state.message ? <span className="dd-bulk-msg">{state.message}</span> : null}
    </form>
  )
}

/** The header tick box: select or clear every table shown. */
export function SelectAllBox() {
  const [on, setOn] = useState(false)
  return (
    <input
      type="checkbox"
      checked={on}
      aria-label="Select every table shown"
      onChange={(e) => {
        const next = e.target.checked
        setOn(next)
        for (const b of boxes()) b.checked = next
        // One change event so the bar recounts; dispatched on a row box so it
        // carries the form attribute the bar listens for.
        boxes()[0]?.dispatchEvent(new Event('change', { bubbles: true }))
      }}
    />
  )
}

/** A table's datasets on its own page, in edit mode: take it out of one, or add it to another. */
export function TableDatasets({
  tableRef,
  current,
  datasets,
}: {
  tableRef: string
  current: DatasetOption[]
  datasets: DatasetOption[]
}) {
  const [state, action, pending] = useActionState<DictState, FormData>(addTablesToDataset, {})
  const [choice, setChoice] = useState('')
  const [removing, startRemove] = useTransition()
  const [removeError, setRemoveError] = useState<string | null>(null)
  const others = datasets.filter((d) => !current.some((c) => c.id === d.id))

  return (
    <div className="dd-table-sets">
      <span className="mr-label">Datasets</span>
      <div className="dd-picked">
        {current.length ? (
          current.map((d) => (
            <span key={d.id} className="dd-pickchip">
              {d.name}
              <button
                type="button"
                aria-label={`Take ${tableRef} out of ${d.name}`}
                disabled={removing}
                onClick={() =>
                  startRemove(async () => {
                    setRemoveError(null)
                    const r = await removeTableFromDataset(d.id, tableRef)
                    if (r.error) setRemoveError(r.error)
                  })
                }
              >
                ×
              </button>
            </span>
          ))
        ) : (
          <span className="dd-gap">In no dataset</span>
        )}
      </div>
      <form action={action} className="dd-bulk dd-bulk-one">
        <input type="hidden" name="table" value={tableRef} />
        <select name="datasetId" value={choice === NEW ? '' : choice} onChange={(e) => setChoice(e.target.value)} aria-label="Dataset to add this table to">
          <option value="">Add to a dataset…</option>
          {others.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value={NEW}>+ New dataset…</option>
        </select>
        {choice === NEW ? <input name="newName" placeholder="New dataset name" maxLength={120} aria-label="New dataset name" autoFocus /> : null}
        <button type="submit" className="btn" disabled={pending || !choice}>
          {pending ? 'Adding…' : 'Add'}
        </button>
        {state.error ? <span className="dd-bulk-msg dd-bad">{state.error}</span> : null}
        {state.ok && state.message ? <span className="dd-bulk-msg">{state.message}</span> : null}
        {removeError ? <span className="dd-bulk-msg dd-bad">{removeError}</span> : null}
      </form>
    </div>
  )
}
