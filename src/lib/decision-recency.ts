/**
 * Decisions are a record of what was decided, not work in progress
 * (Scott, 8 October 2026).
 *
 * Something becomes a decision when it has been decided; nothing further is
 * owed on it in the portfolio. So a decision is never "open" or "closed" in
 * the sense a blocker or an action is. It is recent for sixty days after it
 * was made, and inactive after that: listed by default while recent, hidden
 * (but still there) once inactive.
 *
 * Everywhere that asks "is this item live" - the item list, importance bands,
 * the home cards - reads a decision through this, so "open" for a decision
 * means "not withdrawn" and "inactive" means "older than sixty days".
 */

export const RECENT_DECISION_DAYS = 60

const DAY = 86_400_000

/** When it was decided: settled, else raised, else recorded. */
export function decidedAt(d: { resolvedAt?: Date | null; raisedAt?: Date | null; createdAt?: Date | null }): Date | null {
  return d.resolvedAt ?? d.raisedAt ?? d.createdAt ?? null
}

/** Decided in the last sixty days. */
export function isRecentDecision(
  d: { resolvedAt?: Date | null; raisedAt?: Date | null; createdAt?: Date | null },
  now: Date | number = Date.now(),
): boolean {
  const at = decidedAt(d)
  const t = typeof now === 'number' ? now : now.getTime()
  return Boolean(at && t - at.getTime() <= RECENT_DECISION_DAYS * DAY)
}

/** Not withdrawn or merged away: still a decision on record. */
export function isDecisionOnRecord(d: { status: string }): boolean {
  return d.status !== 'dropped'
}
