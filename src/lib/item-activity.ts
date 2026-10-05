/**
 * Open, inactive, and how well a piece of work is closing things: the rules,
 * with no database in them.
 *
 * WHY (5 October 2026)
 *
 * Items were recorded and then never touched, so every list only grew. Scott:
 * an item with no update in seven days is "inactive". It drops out of the
 * open list and the home page counts and gets its own section, where it can
 * be withdrawn. An update is any new evidence, a reply, a status change, a
 * manual edit or a score change. A reminder being sent is not.
 *
 * The health tile at the top of each dashboard says whether a piece of work
 * is getting through its items. Over the last fourteen days:
 *
 *   green   at least as many closed as opened, and most open items updated
 *           within the week
 *   red     a Critical item untouched for a week, or more than twice as many
 *           opened as closed (when at least three were opened, so two new
 *           items on a quiet project do not turn it red)
 *   yellow  anything between
 */

export const INACTIVE_DAYS = 7
export const HEALTH_WINDOW_DAYS = 14
/** Reminders start once an item has been open this long. */
export const NUDGE_AFTER_DAYS = 2

const DAY = 86_400_000

export function isInactive(lastActivityAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastActivityAt.getTime() > INACTIVE_DAYS * DAY
}

export function daysSince(at: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / DAY))
}

export interface HealthInput {
  /** Items created in the window. */
  opened: number
  /** Items closed in the window. */
  closed: number
  /** Open items updated within INACTIVE_DAYS. */
  activeOpen: number
  /** All open items, active or not. */
  totalOpen: number
  /** Open Critical items with no update for INACTIVE_DAYS. */
  criticalStale: number
}

export type Rag = 'green' | 'yellow' | 'red'

export function closureHealth(h: HealthInput): { rag: Rag; reasons: string[] } {
  const reasons: string[] = []
  const activeShare = h.totalOpen === 0 ? 1 : h.activeOpen / h.totalOpen
  const window = `the last ${HEALTH_WINDOW_DAYS} days`

  reasons.push(`${h.closed} closed and ${h.opened} opened in ${window}.`)
  reasons.push(
    h.totalOpen === 0
      ? 'Nothing open.'
      : `${h.activeOpen} of ${h.totalOpen} open item${h.totalOpen === 1 ? '' : 's'} updated in the last ${INACTIVE_DAYS} days.`,
  )
  if (h.criticalStale) {
    reasons.push(`${h.criticalStale} Critical item${h.criticalStale === 1 ? '' : 's'} untouched for ${INACTIVE_DAYS}+ days.`)
  }

  if (h.criticalStale > 0 || (h.opened >= 3 && h.opened > 2 * h.closed)) return { rag: 'red', reasons }
  if (h.closed >= h.opened && activeShare >= 0.5) return { rag: 'green', reasons }
  return { rag: 'yellow', reasons }
}
