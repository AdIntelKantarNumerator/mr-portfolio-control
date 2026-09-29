/**
 * The board's vocabulary, with nothing behind it.
 *
 * Level, sort and health filter, and the guards that validate them. Split out
 * of lib/home.ts because the client needs them and lib/home.ts opens a
 * database connection at import time — a client component importing it pulled
 * `pg` into the browser bundle, and the page 500'd on "Can't resolve 'dns'".
 *
 * The rule this encodes: a type shared across the server/client line lives in
 * a module that imports nothing.
 */
export type Level = 'initiative' | 'project' | 'workstream'
export const LEVELS: Level[] = ['initiative', 'project', 'workstream']

export function isLevel(v: string | undefined): v is Level {
  return v === 'initiative' || v === 'project' || v === 'workstream'
}

/**
 * How the board is ordered, and what it leaves out.
 *
 * Both live in the URL so a filtered board can be sent to somebody, and both
 * are applied on the server so the page that arrives is the page that was
 * asked for — filtering after render means the first paint is a board the
 * reader did not choose.
 */
/**
 * 'custom' is an order somebody dragged into place, kept in each table's
 * `sortOrder` column. It is deliberately a property of the portfolio rather
 * than of the reader: the order initiatives are discussed in is an editorial
 * decision a team makes together, the same way theme order already is, and a
 * per-browser copy would mean the board looked different in the meeting than
 * it did to the person who arranged it.
 */
export type Sort = 'active' | 'quiet' | 'name' | 'custom'
export const SORTS: Sort[] = ['active', 'quiet', 'name', 'custom']
export function isSort(v: string | undefined): v is Sort {
  return v === 'active' || v === 'quiet' || v === 'name' || v === 'custom'
}

/** 'all', or one of the health states a card can be in. */
export type HealthFilter = 'all' | 'good' | 'crit'
export const HEALTHS: HealthFilter[] = ['all', 'good', 'crit']
export function isHealth(v: string | undefined): v is HealthFilter {
  return v === 'all' || v === 'good' || v === 'crit'
}

export interface MixMember {
  id: string
  name: string
  href: string
}

export interface MixGroup {
  status: string
  label: string
  members: MixMember[]
}

/**
 * The order the segments are drawn in, and it is not alphabetical or
 * by-count: it is the life of a piece of work, left to right. Done, then
 * doing, then intending, then queued, then abandoned.
 *
 * Statuses not listed here keep their relative order after the ones that are,
 * so a new status added to the lifecycle appears rather than vanishing.
 */
/**
 * In-progress work, split by whether anything is standing in its way.
 *
 * "In progress" was the biggest segment on most cards and said the least: a
 * workstream shipping cleanly and one that has been stuck behind a blocker
 * for three weeks are both in progress, and the bar coloured them the same
 * green. The split is on open blockers, which is the same evidence `healthOf`
 * uses, so the bar and the card's health cannot disagree.
 */
export const IN_PROGRESS_OK = 'in_progress_on_track'
export const IN_PROGRESS_BLOCKED = 'in_progress_blocked'

/** The statuses that mean work is actively happening, whatever the tier calls it. */
export function isInProgress(status: string): boolean {
  return status === 'in_progress' || status === 'active'
}

export const MIX_ORDER = [
  'complete',
  'completed',
  IN_PROGRESS_OK,
  IN_PROGRESS_BLOCKED,
  'in_progress',
  'on_track',
  'active',
  'at_risk',
  'blocked',
  'paused',
  'planned',
  'planning',
  'backlog',
  'canceled',
  'cancelled',
] as const

export function mixRank(status: string): number {
  const i = (MIX_ORDER as readonly string[]).indexOf(status)
  return i === -1 ? MIX_ORDER.length : i
}

/**
 * A status as a person says it. "in_progress" is a column value, not a word.
 *
 * Deliberately not lib/domain.ts's `label()`: that one takes a named group,
 * and the mix bar mixes two vocabularies on one card - a project's lifecycle
 * status and a milestone's - which is exactly the case a group-keyed lookup
 * cannot serve.
 */
const STATUS_WORDS: Record<string, string> = {
  complete: 'complete',
  completed: 'completed',
  in_progress: 'in progress',
  in_progress_on_track: 'in progress \u2013 on track',
  in_progress_blocked: 'in progress \u2013 blocked',
  on_track: 'on track',
  at_risk: 'at risk',
  blocked: 'blocked',
  paused: 'paused',
  planned: 'planned',
  planning: 'planning',
  backlog: 'backlog',
  canceled: 'canceled',
  cancelled: 'cancelled',
  active: 'active',
  withdrawn: 'withdrawn',
}

export function statusLabel(status: string): string {
  return STATUS_WORDS[status] ?? status.replace(/_/g, ' ')
}


/**
 * The next milestone, as the health rule reads it.
 *
 * Declared here rather than imported from lib/home.ts so this module keeps
 * importing nothing — see the note at the top. lib/home.ts builds the full
 * card shape on top of it.
 */
export interface NextMilestone {
  id: string
  name: string
  due: string | null
  days: number | null
  pct: number
  expected: number
  basis: 'items' | 'plan' | 'done'
  basisLabel: string
}

export type Health = 'good' | 'warn' | 'crit' | 'quiet'

/**
 * Health, from the next milestone and from whether anything is happening.
 *
 * Counted where it can be counted. "Quiet" is not a shade of green: an entity
 * nobody has touched in a fortnight has no health to report, and saying so is
 * more useful than reporting the last thing that was true.
 */
export function healthOf(
  next: NextMilestone | null,
  openBlockers: number,
  activityScore: number,
  ageDays: number,
  /**
   * What the milestone's own status says, when the ring is drawing the plan
   * rather than a count.
   *
   * Without this the colour came from `expected - pct`, and with no checklist
   * those two are now the same number — so every card would be green. Worse,
   * the old arithmetic could not say "blocked, and early": subtracting a fixed
   * shortfall from a small expected clamps at zero and reads as barely behind.
   * A status is a person's judgement and outranks a gap either way.
   */
  concern: 'none' | 'warn' | 'crit' = 'none',
): Health {
  if (activityScore === 0 && ageDays >= 14) return 'quiet'
  if (openBlockers > 0 && next && next.days !== null && next.days <= 14) return 'crit'
  if (!next) return openBlockers > 0 ? 'warn' : 'good'

  if (concern === 'crit') return 'crit'

  // A counted percentage can disagree with the calendar, and that gap is the
  // one real measurement on this card. Only meaningful when something was
  // actually counted.
  if (next.basis === 'items') {
    const behind = next.expected - next.pct
    if (behind > 15) return 'crit'
    if (behind > 4) return 'warn'
  }

  return concern === 'warn' ? 'warn' : 'good'
}
