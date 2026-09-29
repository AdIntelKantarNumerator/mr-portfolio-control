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
