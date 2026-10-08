/**
 * Linear value mapping, kept separate from the client so it can be tested
 * without an API key or a database.
 */

/**
 * Linear project states are lowercase strings ("backlog", "started", ...) and
 * newer workspaces also expose a `status` object whose `type` carries the same
 * meaning. The status object wins when both are present, because it is the
 * field Linear is moving towards; the rest of the app never sees either shape.
 */
export function mapProjectStatus(state?: string | null, statusType?: string | null): string {
  const v = (statusType ?? state ?? '').toLowerCase()
  switch (v) {
    case 'backlog':
      return 'backlog'
    case 'planned':
      return 'planned'
    case 'started':
    case 'inprogress':
    case 'in_progress':
      return 'in_progress'
    case 'paused':
    case 'onhold':
      return 'paused'
    case 'completed':
      return 'completed'
    case 'canceled':
    case 'cancelled':
      return 'canceled'
    default:
      // An unrecognised state must not throw: Linear adds values, and a sync
      // that dies on an unknown status is worse than one that files it as
      // backlog and carries on.
      return 'backlog'
  }
}

/**
 * Linear's objective status, whichever shape this version of their API sends.
 *
 * It was an enum string. It is now an object — `{ name: "In Progress", type:
 * "started" }` — and the day that changed, every sync returned 400 because the
 * query still asked for it as a leaf. Accepting both shapes here means the
 * next move in either direction is a no-op rather than an outage, and `type`
 * is preferred over `name` because names are workspace-editable and types are
 * the fixed vocabulary.
 */
export function mapInitiativeStatus(v?: string | null | { name?: string; type?: string }): string {
  const raw = typeof v === 'string' || v == null ? v : (v.type ?? v.name)
  switch ((raw ?? '').toLowerCase()) {
    // The object form's `type` vocabulary, which the enum did not have.
    case 'started':
    case 'inprogress':
    case 'in_progress':
    case 'active':
      return 'active'
    case 'backlog':
    case 'planned':
      return 'planned'
    case 'completed':
      return 'completed'
    case 'canceled':
    case 'cancelled':
      return 'canceled'
    case 'paused':
      return 'paused'
    default:
      return 'planned'
  }
}

const PRIORITY_BY_NUMBER: Record<number, string> = {
  0: 'no_priority',
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
}

export function mapPriority(n?: number | null): string | null {
  if (n === null || n === undefined) return null
  return PRIORITY_BY_NUMBER[n] ?? null
}

/** Linear reports progress as 0..1 in most versions and 0..100 in some. */
export function normaliseProgress(raw: unknown): number {
  const n = Number(raw ?? 0)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n > 1 ? n / 100 : n))
}

/**
 * A Linear milestone's status as this app's milestone status, when Linear's
 * says something this one can: done is complete, overdue is at risk. Its
 * other two - next and unstarted - say where the milestone sits in the queue,
 * not how it is going, so they map to nothing.
 */
export function milestoneStatusFrom(linear: unknown): 'complete' | 'at_risk' | null {
  return linear === 'done' ? 'complete' : linear === 'overdue' ? 'at_risk' : null
}

/**
 * What the sync should set a milestone's status to, or undefined to leave it.
 *
 * WHY (Scott, 8 October 2026)
 *
 * The sync never read a milestone's status at all: 35 milestones done in
 * Linear read "planning" here. Now done and overdue come across. And when
 * Linear stops saying either - a done milestone reopened, an overdue one
 * whose date moved - the status the sync set goes back to planning. Only one
 * the sync set: a status that matches nothing Linear said before was put
 * there by the program-review deck or by somebody, and is theirs. (A status
 * corrected on the milestone editor is protected separately, by
 * mergeFromSource.)
 */
export function syncedMilestoneStatus(
  linearNow: unknown,
  linearBefore: unknown,
  current: string | null,
): string | undefined {
  const now = milestoneStatusFrom(linearNow)
  if (now) return now
  const before = milestoneStatusFrom(linearBefore)
  return before && current === before ? 'planning' : undefined
}

export function parseLinearDate(v?: string | null): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
