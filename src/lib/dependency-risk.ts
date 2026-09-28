/**
 * A dependency with a date somebody is going to miss.
 *
 * WHAT A REQUIRED DATE MEANS
 *
 * A dependency records that one piece of work is waiting on another. Putting a
 * date on it turns that into a commitment: the thing being waited on has to
 * land by then, or the thing waiting cannot land at all. Before this, that
 * date sat on the row and nothing read it — the dependency stayed "open" and
 * green while the date went past, and the first anybody knew was the week it
 * mattered.
 *
 * WHO GOES RED
 *
 * The item DELIVERING — the `from` end. That is the work that has to move, and
 * it is where somebody would go to do something about it. Marking the waiting
 * end instead would light up a team who cannot act, which is how a portfolio
 * teaches people that red means nothing.
 *
 * WHAT "NOT ON TRACK" MEANS, EXACTLY
 *
 * Two things, and only two, because both are checkable rather than guessed:
 *
 *   - the required date has passed and the delivering work is not finished; or
 *   - the delivering work's own target date is after the required date.
 *
 * The second is the useful one: it fires the day somebody moves a target,
 * months before the miss, which is the whole point of writing the date down.
 *
 * A dependency that is resolved, or an accepted risk, never fires. Those are
 * both somebody having already looked at it and decided — re-raising it would
 * be arguing with the person who closed it.
 */

export interface DependencyLike {
  id: string
  fromType: string
  fromId: string
  toType: string
  toId: string
  status: string
  /** The required date: when the delivering end has to have landed. */
  dueDate: Date | string | null
}

/** Whatever the delivering end is, reduced to the two facts that decide this. */
export interface DeliveringWork {
  /** Its own committed date, if it has one. */
  targetDate: Date | string | null
  /** True when it has already landed, whatever the dates say. */
  done: boolean
}

export type LateReason = 'overdue' | 'will-miss'

const day = (v: Date | string | null | undefined): string | null => {
  if (!v) return null
  const d = typeof v === 'string' ? v : v.toISOString()
  return d.slice(0, 10)
}

/** Statuses that mean somebody has already looked at this and decided. */
const SETTLED = new Set(['resolved', 'accepted_risk'])

/**
 * Why this dependency is late, or null if it is not.
 *
 * `work` is what is known about the delivering end. Null — an external
 * dependency, or one pointing at something since deleted — can still be
 * overdue: the date passing is a fact about the calendar, not about the row.
 */
export function lateness(
  dep: DependencyLike,
  work: DeliveringWork | null,
  today: Date = new Date(),
): LateReason | null {
  if (SETTLED.has(dep.status)) return null

  const required = day(dep.dueDate)
  if (!required) return null
  if (work?.done) return null

  if (required < day(today)!) return 'overdue'

  const target = day(work?.targetDate)
  if (target && target > required) return 'will-miss'

  return null
}

/**
 * Everything that has to go red, by entity id.
 *
 * Returned as a map rather than a set so a caller can say WHY — "its target is
 * after a date something else is waiting on" is a different sentence from "the
 * date has passed", and a card that says neither is a card people learn to
 * scroll past.
 */
export function lateDependencies(
  deps: readonly DependencyLike[],
  workFor: (type: string, id: string) => DeliveringWork | null,
  today: Date = new Date(),
): Map<string, { depId: string; reason: LateReason }[]> {
  const out = new Map<string, { depId: string; reason: LateReason }[]>()
  for (const dep of deps) {
    const reason = lateness(dep, workFor(dep.fromType, dep.fromId), today)
    if (!reason) continue
    out.set(dep.fromId, [...(out.get(dep.fromId) ?? []), { depId: dep.id, reason }])
  }
  return out
}
