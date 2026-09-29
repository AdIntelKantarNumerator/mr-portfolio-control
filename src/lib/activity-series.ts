/**
 * The little bar chart beside the activity score.
 *
 * WHAT IT WAS DOING
 *
 *   activity: [1,2,3,4,5,6,7,8].map(() => Math.round(activityScore))
 *
 * — the same number, eight times. The card then scaled the bars by their own
 * maximum, so every bar came out full height, and every card on the board drew
 * an identical block of eight. It looked like a chart and carried no
 * information at all: the only thing it could tell you was whether the score
 * was zero.
 *
 * WHAT IT DOES NOW
 *
 * Counts what actually happened, per week, over the last eight. That is a
 * shape worth looking at — a project that was busy a month ago and silent
 * since reads differently from one that picked up last week, and those two
 * had the same picture before.
 *
 * Undated events are left out rather than dropped into the newest bucket.
 * Yaara records `at` for almost everything; the handful without one are not
 * evidence that something happened this week.
 */

export interface DatedEvent {
  at: string | null
}

export const BUCKETS = 8
const WEEK = 7 * 86_400_000

/**
 * Events per week, oldest bucket first, ending with the week containing `now`.
 *
 * Returns a fixed-length array so every card draws the same number of bars and
 * the same week lines up across cards — a sparkline whose buckets mean
 * different things on different rows is worse than none.
 */
export function activitySeries(events: readonly DatedEvent[], now: Date = new Date()): number[] {
  const out = new Array<number>(BUCKETS).fill(0)
  const end = now.getTime()

  for (const e of events) {
    if (!e.at) continue
    const t = Date.parse(e.at)
    if (!Number.isFinite(t)) continue
    const age = end - t
    // Anything in the future belongs to the current week: a clock skew of a
    // few minutes should not fall off the chart.
    const bucket = BUCKETS - 1 - Math.floor(Math.max(0, age) / WEEK)
    if (bucket < 0) continue
    out[Math.min(BUCKETS - 1, bucket)]! += 1
  }

  return out
}
