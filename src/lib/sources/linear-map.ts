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

export function mapInitiativeStatus(v?: string | null): string {
  switch ((v ?? '').toLowerCase()) {
    case 'active':
      return 'active'
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

export function parseLinearDate(v?: string | null): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
