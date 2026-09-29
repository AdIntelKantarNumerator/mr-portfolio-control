/**
 * The order milestones are read in when the question is "when".
 *
 * WHY THIS IS NOT sortOrder
 *
 * `sortOrder` is the order somebody arranged the milestones in on the editor,
 * and on that page it is exactly right — it is their list. But the home card
 * draws those same milestones on a RAIL: a left-to-right run of time, with a
 * progress line along it and "NEXT MILESTONE" above. Read in hand order, a
 * rail claims a sequence the dates do not support, and the first open one
 * claims to be next when something due five days sooner sits further along.
 * That is what it was doing: a card read "12 Oct · 13d" with an Oct 7
 * milestone two marks to its right.
 *
 * So anything drawn or counted as time sorts by date here, and the editor
 * keeps its own order. The two are different questions about the same rows.
 *
 * UNDATED MILESTONES GO LAST
 *
 * A milestone with no target is not early, it is unscheduled — sorting it to
 * the front (where a null would land) would put the least certain work at the
 * head of the rail and make it "next". They keep their hand order among
 * themselves, so the editor's arrangement still decides what it can.
 */

export interface Dated {
  targetDate: Date | null
  sortOrder: number
  name: string
}

/**
 * Soonest first; undated last in hand order. Name breaks the remaining ties so
 * two milestones sharing a date and a sortOrder cannot swap places between one
 * render and the next.
 */
export function byTargetDate<T extends Dated>(ms: readonly T[]): T[] {
  return ms.slice().sort((a, b) => {
    const at = a.targetDate ? a.targetDate.getTime() : null
    const bt = b.targetDate ? b.targetDate.getTime() : null
    if (at === null && bt === null) return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
    if (at === null) return 1
    if (bt === null) return -1
    return at - bt || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
  })
}

/**
 * The one to put on the card: the next milestone that is actually ahead.
 *
 * WHAT WAS WRONG
 *
 * The card took the first incomplete milestone in date order, which is the
 * OLDEST incomplete one — routinely months past. Two things then went wrong
 * together. It called a milestone from June "next", and the plan line it was
 * measured against is the share of the calendar already gone, which for a
 * past date is all of it: the ring read 100% and went green. A card could
 * say "3 Sept · -26d" and "100%" at the same time, and mean neither.
 *
 * So: the soonest one still ahead of today. Undated milestones are ahead in
 * the sense that matters — nothing has passed — and sort last among
 * themselves, so they are taken only when no dated one is left.
 *
 * WHEN EVERYTHING LEFT IS OVERDUE
 *
 * There is still something to say, and saying nothing would hide it. The most
 * recent overdue one is returned with `overdue` set, and the caller colours
 * the card by that rather than by the plan line — which at that point is a
 * flat 100% for every one of them and can no longer tell them apart.
 */
export interface Upcoming<T> {
  milestone: T
  /** True when nothing is left ahead and this is the last one already missed. */
  overdue: boolean
}

export function nextUpcoming<T extends Dated & { status: string }>(
  ms: readonly T[],
  now: Date,
  isDone: (status: string) => boolean = (s) => s === 'complete',
): Upcoming<T> | null {
  // Midnight, not this instant: a milestone due today is due today all day,
  // and "overdue by four hours" is not a thing anybody means.
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const open = byTargetDate(ms).filter((m) => !isDone(m.status))

  const ahead = open.find((m) => !m.targetDate || m.targetDate.getTime() >= today)
  if (ahead) return { milestone: ahead, overdue: false }

  const last = open.at(-1)
  return last ? { milestone: last, overdue: true } : null
}
