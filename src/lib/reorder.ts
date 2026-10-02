/**
 * Where a dragged card lands, and which edge of the target says so.
 *
 * This is its own function because the arithmetic is the part that goes wrong,
 * and it is the part a browser cannot be asked about in a unit test.
 *
 * The rule: the position is read off the list as it looks on screen — the
 * index of the card you dropped onto, taken *before* the dragged card is
 * lifted out. Lift, then insert at that index. Dragging up, that puts the card
 * above the one you dropped on; dragging down, it takes that card's place and
 * pushes it up. Both read as "this card now sits where I dropped it", which is
 * what a hand expects, and it is why `dropsBelow` exists: the guide line has to
 * be drawn on the edge the card is actually going to.
 */
export function moveCard(ids: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return ids
  const from = ids.indexOf(fromId)
  const to = ids.indexOf(toId)
  if (from < 0 || to < 0) return ids
  const next = [...ids]
  const [held] = next.splice(from, 1)
  if (held === undefined) return ids
  next.splice(to, 0, held)
  return next
}

/**
 * True when dropping on `toId` will leave the card *below* it — which is the
 * case whenever the card is being dragged down the list.
 */
export function dropsBelow(ids: string[], fromId: string, toId: string): boolean {
  const from = ids.indexOf(fromId)
  const to = ids.indexOf(toId)
  return from >= 0 && to >= 0 && from < to
}

/**
 * Put a reordered subset back into the whole order, in the slots it held.
 *
 * The board shows a subset: a health filter, or ended work hidden. Since the
 * order became one shared order (2 October 2026), what is saved is the order
 * of everything at that level, so dragging among the visible cards must not
 * shuffle the hidden ones. The visible ids keep the positions they occupied
 * in the whole list, refilled in their new order; everything else stays put.
 * Ids in `reordered` that are not in `full` are ignored.
 */
export function mergeOrder(full: string[], reordered: string[]): string[] {
  const inFull = new Set(full)
  const moving = reordered.filter((id) => inFull.has(id))
  const movingSet = new Set(moving)
  let next = 0
  return full.map((id) => (movingSet.has(id) ? moving[next++]! : id))
}

/**
 * The one card that moved between two orders, for the Activity line: the id
 * whose position changed most, with where it was and where it went (1-based).
 * Null when nothing moved.
 */
export function describeMove(before: string[], after: string[]): { id: string; from: number; to: number } | null {
  let best: { id: string; from: number; to: number } | null = null
  for (const [to, id] of after.entries()) {
    const from = before.indexOf(id)
    if (from < 0 || from === to) continue
    if (!best || Math.abs(to - from) > Math.abs(best.to - best.from)) best = { id, from: from + 1, to: to + 1 }
  }
  return best
}
