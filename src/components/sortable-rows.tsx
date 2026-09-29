'use client'

/**
 * A list of rows you can put in your own order.
 *
 * The home board and the timeline already do this; the three list pages did
 * not, so the order a reader arranged in one place was not the order they got
 * in another. Same storage, same rules, same words — see app/order-actions.ts
 * for whose order it is, and lib/reorder.ts for the arithmetic.
 *
 * WHY IT WRAPS ROWS RATHER THAN RENDERING THEM
 *
 * The three lists draw quite different rows — an initiative row carries a ring
 * and a mix bar, a project row is a table cell — and none of that is this
 * component's business. It takes what a page already renders and adds the
 * grip and the drop target around it.
 */
import { useState } from 'react'
import { setCardOrder } from '@/app/order-actions'
import { dropsBelow, moveCard } from '@/lib/reorder'

export function SortableRows({
  ids,
  level,
  draggable,
  render,
}: {
  /** The ids, in the order the server sent them. */
  ids: string[]
  level: 'objective' | 'initiative' | 'project'
  /** True only under the Custom sort. */
  draggable: boolean
  /** One row, by id. */
  render: (id: string) => React.ReactNode
}) {
  const [order, setOrder] = useState<string[] | null>(null)
  const [held, setHeld] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The order the server sent, remembered so a change of filter or level
  // drops any local arrangement rather than applying it to a different list.
  const key = ids.join(',')
  const [seen, setSeen] = useState(key)
  if (key !== seen) {
    setSeen(key)
    setOrder(null)
  }

  const shown = order ? order.filter((id) => ids.includes(id)) : ids

  function move(fromId: string, toId: string) {
    const next = moveCard(shown, fromId, toId)
    if (next === shown) return
    setOrder(next)
    setError(null)
    void setCardOrder(level, next)
      .then((r) => setError(r.error ?? null))
      .catch(() => setError('The new order could not be saved.'))
  }

  return (
    <>
      {error ? (
        <p className="dragnote">
          <b>{error}</b>
        </p>
      ) : null}

      {shown.map((id) => (
        <div
          key={id}
          className={[
            'rowwrap',
            held === id ? 'held' : '',
            over === id && held && held !== id
              ? dropsBelow(shown, held, id)
                ? 'over-below'
                : 'over-above'
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onDragOver={(e) => {
            if (!draggable || !held) return
            // Without this the drop is refused and the row springs back.
            e.preventDefault()
            setOver(id)
          }}
          onDrop={(e) => {
            if (!draggable || !held) return
            e.preventDefault()
            move(held, id)
            setHeld(null)
            setOver(null)
          }}
        >
          {draggable && (
            // To the left of the row, clear of everything in it that is a
            // link or a control.
            <span
              className="rowgrip"
              draggable
              onDragStart={(e) => {
                setHeld(id)
                e.dataTransfer.effectAllowed = 'move'
                // Firefox refuses to start a drag with an empty payload.
                e.dataTransfer.setData('text/plain', id)
              }}
              onDragEnd={() => {
                setHeld(null)
                setOver(null)
              }}
              title="Drag to reorder"
              aria-label="Drag to reorder"
            />
          )}
          {render(id)}
        </div>
      ))}
    </>
  )
}

/** The Sort By picker the home board, the timeline and the lists all share. */
export function SortPicker({ sort }: { sort: string }) {
  return (
    <label className="fpill">
      <span>
        <span className="lab">Sort by</span>
        <select
          className="fsel"
          value={sort}
          onChange={(e) => {
            const next = new URLSearchParams(window.location.search)
            next.set('sort', e.target.value)
            window.location.search = next.toString()
          }}
          aria-label="Sort by"
        >
          <option value="active">Most active</option>
          <option value="quiet">Quietest</option>
          <option value="name">Name</option>
          <option value="custom">Custom</option>
        </select>
      </span>
    </label>
  )
}
