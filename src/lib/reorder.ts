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
