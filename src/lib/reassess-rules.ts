/**
 * "Reassess now" on a home page card: the rules, with no database in them.
 *
 * WHY A QUEUE
 *
 * The portfolio cannot write an assessment. Yaara does, and she cannot be
 * called: she has no public address, and the seam between her and the
 * portfolio is that she calls its agent API and it never calls her (the same
 * arrangement as the Ask Yaara chat, src/lib/yaara-chat.ts). So the button
 * leaves a request here, she collects it over GET /api/agent/reassess, runs
 * the same reassessment her assess_entity tool runs, publishes, and says she
 * has finished. The card waits for that and then refreshes.
 *
 * WHEN TO STOP WAITING
 *
 * A request nobody collects means she is not running - restarting after a
 * deploy, usually - and the person should be told rather than left watching a
 * spinner. One she collected but never finished means something went wrong on
 * her side. Both are reported as failures with words that say which.
 */

export const LEVELS = ['objective', 'initiative', 'project'] as const
export type Level = (typeof LEVELS)[number]

export function isLevel(v: string): v is Level {
  return (LEVELS as readonly string[]).includes(v)
}

/**
 * How long a request may wait to be collected. She collects within seconds
 * when she is running; three minutes covers a restart.
 */
export const UNCLAIMED_AFTER_MS = 3 * 60_000

/**
 * How long she may work on one. A reassessment reads the evidence and makes a
 * model call for the item and one for each level above it: a minute or two,
 * occasionally five when the evidence has to be read fresh.
 */
export const WORKING_LIMIT_MS = 15 * 60_000

/** Rows older than this are deleted; nobody is waiting on them. */
export const KEEP_FOR_MS = 2 * 86_400_000

export interface ReassessRowLike {
  status: string
  requestedAt: Date
  claimedAt: Date | null
  note: string | null
  error: string | null
}

export interface ReassessView {
  state: 'waiting' | 'working' | 'done' | 'failed'
  /** What to tell the person, when there is something: her note, or why it failed. */
  message: string | null
}

export function reassessView(row: ReassessRowLike, now: Date = new Date()): ReassessView {
  if (row.status === 'done') return { state: 'done', message: row.note }
  if (row.status === 'failed') return { state: 'failed', message: row.error ?? 'Yaara could not reassess this.' }
  if (row.status === 'queued') {
    if (now.getTime() - row.requestedAt.getTime() > UNCLAIMED_AFTER_MS) {
      return {
        state: 'failed',
        message: 'Yaara did not pick this up. She may be restarting; try again in a few minutes.',
      }
    }
    return { state: 'waiting', message: null }
  }
  if (row.status === 'working') {
    const from = row.claimedAt ?? row.requestedAt
    if (now.getTime() - from.getTime() > WORKING_LIMIT_MS) {
      return { state: 'failed', message: 'Yaara started but did not finish. The next hourly pass will try again.' }
    }
    return { state: 'working', message: null }
  }
  return { state: 'failed', message: 'This request is in a state nobody recognises.' }
}

/**
 * Whether a request is still going, so a second click on the same card - or
 * the same card in another tab - joins it rather than queueing another.
 */
export function stillGoing(row: ReassessRowLike, now: Date = new Date()): boolean {
  const view = reassessView(row, now)
  return view.state === 'waiting' || view.state === 'working'
}
