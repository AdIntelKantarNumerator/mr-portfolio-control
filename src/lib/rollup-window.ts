/**
 * The window a piece of work occupies, when nobody typed one.
 *
 * WHY THIS IS ONE FUNCTION IN ONE FILE
 *
 * It was two. The detail page rolled an initiative's window up from its
 * projects' dates; the timeline rolled it up from its projects' dates
 * AND their milestones. So an initiative could read "Jun 17 → Oct 5" on one screen
 * and be drawn to Oct 12 on the other, and both were behaving exactly as
 * written. Two implementations of one idea drift the moment either is touched,
 * and the only fix that stays fixed is that there is one of them.
 *
 * WHAT COUNTS AS "BENEATH"
 *
 * Every date of every child, and every milestone at or below. An initiative with
 * no project dates but four dated milestones has a window — it was showing
 * as undated, which on a chart is indistinguishable from work nobody has
 * planned.
 *
 * WHY ENDED WORK STILL COUNTS
 *
 * This is the other half of the same bug. The timeline built its roll-up from
 * the rows it was about to DRAW, so switching the chart to "Live only" took
 * completed projects out of their initiative's window — and the initiative's bar
 * moved, or vanished, because of a filter that was only ever meant to change
 * what was listed. A window is a fact about the work; which rows you are
 * looking at is a question about the screen. Callers pass everything.
 */

export interface Window {
  start: Date | null
  end: Date | null
  /** True when either end came from underneath rather than from the row. */
  rolledUp: boolean
}

const stamp = (d: Date | null | undefined) => (d ? d.getTime() : null)

/**
 * `own` is what somebody typed. `beneath` is every date known below it, in any
 * order — a child's start or target, a milestone's target. Each end falls back
 * on its own, so a typed start with no target extends to the last thing
 * underneath rather than losing the start.
 */
export function rollUpWindow(
  own: { startDate: Date | null; targetDate: Date | null },
  beneath: ReadonlyArray<Date | null | undefined>,
): Window {
  const stamps = beneath.map(stamp).filter((n): n is number => n !== null)
  const low = stamps.length ? new Date(Math.min(...stamps)) : null
  const high = stamps.length ? new Date(Math.max(...stamps)) : null

  const start = own.startDate ?? low
  const end = own.targetDate ?? high
  return { start, end, rolledUp: (!own.startDate && low !== null) || (!own.targetDate && high !== null) }
}
