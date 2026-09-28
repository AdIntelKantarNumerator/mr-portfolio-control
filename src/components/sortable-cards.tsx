'use client'

/**
 * The board, rearrangeable by dragging.
 *
 * Only when the sort picker says "Custom". Under every other sort the order
 * is computed from something — activity, name — and letting somebody drag a
 * card there would produce an arrangement that silently reverts on the next
 * render, which is worse than not offering it.
 *
 * WHY A GRIP RATHER THAN A DRAGGABLE CARD
 *
 * A card is full of things you click: the assessment, the mix bar's segments,
 * the milestone rail, links. Making the whole card draggable means every one
 * of those becomes a drag the moment the pointer moves a few pixels, and a
 * reader who meant to click a segment ends up rearranging the board. The grip
 * is a frame down the top and both sides — the edges nobody clicks — which is
 * where a hand reaches for a card anyway.
 *
 * WHAT HAPPENS ON DROP
 *
 * The list reorders immediately and the server is told afterwards. A drag
 * that has to wait for a round trip before the card moves feels broken, and
 * the cost of being optimistic here is small: if the write fails the message
 * says so and the next render puts it back.
 */
import { useState } from 'react'
import type { HomeCard } from '@/lib/home'
import type { Level } from '@/lib/home-types'
import { setCardOrder } from '@/app/order-actions'
import { moveCard, dropsBelow } from '@/lib/reorder'
import { InitiativeCard } from './initiative-card'

export function SortableCards({
  cards,
  level,
  draggable,
  onOpen,
}: {
  cards: HomeCard[]
  level: Level
  /** True only under the Custom sort. */
  draggable: boolean
  onOpen: (title: string, body: React.ReactNode) => void
}) {
  // Null until something is dragged, then this is the order on screen. Kept
  // separate from `cards` so a re-render with fresh server data replaces it
  // rather than fighting it.
  const [order, setOrder] = useState<string[] | null>(null)
  const [held, setHeld] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The order the server sent, remembered so a change of sort or level drops
  // any local arrangement instead of applying it to a different list.
  const serverIds = cards.map((c) => c.id).join(',')
  const [seenIds, setSeenIds] = useState(serverIds)
  if (serverIds !== seenIds) {
    setSeenIds(serverIds)
    setOrder(null)
  }

  const byId = new Map(cards.map((c) => [c.id, c]))
  const shown = order ? (order.map((id) => byId.get(id)).filter(Boolean) as HomeCard[]) : cards

  function move(fromId: string, toId: string) {
    const was = shown.map((c) => c.id)
    const ids = moveCard(was, fromId, toId)
    // Same array back means nothing moved — a card dropped on itself, or an
    // id that has gone. Writing that to the server would be a no-op with a
    // changelog entry, which reads as a change nobody made.
    if (ids === was) return
    setOrder(ids)
    setError(null)
    void setCardOrder(level, ids)
      .then((r) => setError(r.error ?? null))
      .catch(() => setError('The new order could not be saved.'))
  }

  return (
    <>
      {/* No instructions. The grip changes the cursor to a hand on hover and
          carries a title, which is how every other draggable thing on a
          screen announces itself; a standing sentence above the board was
          paying for that hint on every visit, forever, including the
          thousandth. Only a failure gets a line, because a drag that silently
          did not save is the one thing the reader cannot see for themselves. */}
      {error && (
        <p className="dragnote">
          <b>{error}</b>
        </p>
      )}

      {shown.map((c) => (
        <div
          key={c.id}
          className={[
            'dragwrap',
            held === c.id ? 'held' : '',
            // The guide line goes on the edge the card is actually landing on,
            // so dragging down does not draw a line above and then drop below.
            over === c.id && held && held !== c.id
              ? dropsBelow(shown.map((x) => x.id), held, c.id)
                ? 'over-below'
                : 'over-above'
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onDragOver={(e) => {
            if (!draggable || !held) return
            // Without this the drop is refused and the card springs back.
            e.preventDefault()
            setOver(c.id)
          }}
          onDrop={(e) => {
            if (!draggable || !held) return
            e.preventDefault()
            move(held, c.id)
            setHeld(null)
            setOver(null)
          }}
        >
          {draggable && (
            <span
              className="grip"
              draggable
              onDragStart={(e) => {
                setHeld(c.id)
                e.dataTransfer.effectAllowed = 'move'
                // Firefox refuses to start a drag with an empty payload.
                e.dataTransfer.setData('text/plain', c.id)
              }}
              onDragEnd={() => {
                setHeld(null)
                setOver(null)
              }}
              aria-label={`Drag ${c.name} to reorder`}
              title={`Drag ${c.name} to reorder`}
            />
          )}
          <InitiativeCard card={c} onOpen={onOpen} />
        </div>
      ))}
    </>
  )
}
