/**
 * How far through its next milestone a piece of work is, and where that number
 * came from.
 *
 * WHAT WAS WRONG
 *
 * The ring showed a percentage from a lookup table on the milestone's status:
 * on_track was 55, at_risk 40, blocked 25, anything else 10. So 55% did not
 * mean 55% of anything. It meant "on track", and every card with an on-track
 * next milestone read exactly 55 — two unrelated initiatives showing the same
 * number on the same screen, which is the tell.
 *
 * Beside it the ring drew "% expected", which IS real: the share of the
 * calendar between the work's start and the milestone's date that has already
 * gone. The card then compared the two and coloured itself by the gap. So a
 * constant was being measured against a clock: as any date approached,
 * expected climbed towards 100, the gap crossed the threshold, and the work
 * turned red on schedule — whatever was actually happening. Sports was red at
 * "99% expected" the day before a milestone its own status called on track.
 *
 * WHAT IT DOES NOW
 *
 * Two honest answers, and it says which one it is giving.
 *
 *   - When the milestone has a checklist, the number is that checklist: items
 *     done over items total. That can disagree with the plan, and a
 *     disagreement means something, because both sides are measured.
 *   - When it has no checklist, there is no measured progress to report. The
 *     number is the plan line itself, so the ring reads as "the calendar says
 *     this much", and the COLOUR comes from the status somebody set. Nothing
 *     is invented to manufacture a gap.
 *
 * The second case is most of them today, and the label under the ring has to
 * say so — a number that means two different things without saying which is
 * worse than a crude one.
 */

/** Where the number came from. The card shows this; it is not decoration. */
export type Basis = 'items' | 'plan' | 'done'

export interface Progress {
  pct: number
  basis: Basis
  /** Set only when basis is 'items'. */
  done?: number
  total?: number
}

const DONE = new Set(['complete', 'completed', 'done', 'closed', 'shipped'])
const AT_RISK = new Set(['at_risk', 'at risk', 'risk', 'slipping'])
const BLOCKED = new Set(['blocked', 'missed', 'overdue'])
const NOT_STARTED = new Set(['planning', 'planned', 'not_started', 'backlog', 'proposed', 'draft'])

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

export function milestoneProgress(input: {
  status: string
  /** Items on this milestone's checklist. Zero total means there is none. */
  done?: number
  total?: number
  /** The share of the calendar already gone, 0–100. */
  expected: number
}): Progress {
  const state = (input.status ?? '').toLowerCase()
  if (DONE.has(state)) return { pct: 100, basis: 'done' }

  const total = input.total ?? 0
  if (total > 0) {
    const done = Math.max(0, Math.min(total, input.done ?? 0))
    return { pct: clamp((done / total) * 100), basis: 'items', done, total }
  }

  // Nothing counted. The plan line is the only real number in the room, and
  // the status is carried separately as colour — see `concernOf`.
  return { pct: clamp(input.expected), basis: 'plan' }
}

/**
 * What the status alone says about whether to worry.
 *
 * Kept apart from the percentage on purpose. When there is no checklist the
 * ring cannot express concern through its length without inventing a
 * shortfall, so concern travels as its own answer and the card colours by it.
 *
 * Work nobody has started is judged by the calendar rather than by the word:
 * "planning" is unremarkable three months out and is the whole story three
 * days out, and the only thing that changed is the date.
 */
export function concernOf(status: string, expected: number): 'none' | 'warn' | 'crit' {
  const state = (status ?? '').toLowerCase()
  if (DONE.has(state)) return 'none'
  if (BLOCKED.has(state)) return 'crit'
  if (AT_RISK.has(state)) return 'warn'
  if (NOT_STARTED.has(state)) {
    if (expected >= 90) return 'crit'
    if (expected >= 50) return 'warn'
    return 'none'
  }
  return 'none'
}

/**
 * How to name a counted ring: "3 of 7 done".
 *
 * Empty when there is nothing counted. The card carried a caption saying so
 * under every ring — true, and on every card at once, which made it furniture
 * rather than information. The ring's own "of the plan" already says which
 * number it is, and the full explanation is one click away on the ring
 * itself.
 */
export function basisLabel(p: Progress): string {
  if (p.basis === 'done') return 'complete'
  if (p.basis === 'items') return `${p.done} of ${p.total} done`
  return ''
}

/**
 * Everything that decides whether the next milestone is in trouble, in the
 * order those things outrank each other.
 *
 * Extracted because it is a rule, and it was four conditions deep inside the
 * function that builds a card — where the only way to exercise it was to
 * construct a portfolio in a database and look at the colour of a ring.
 *
 * The order is the whole content:
 *
 *   1. Nothing left but missed dates. This is the case the plan line cannot
 *      express at all — every overdue milestone measures 100% of its calendar,
 *      so a board full of them looks finished.
 *   2. The work beneath it is blocked. A milestone is a date; what does or
 *      does not make it is the work underneath, and if that work is blocked
 *      the date is not on track whatever the milestone's own status says.
 *      A person set that status days ago; the blocker is now.
 *   3. Otherwise what the status says — see `concernOf`.
 */
export function nextConcern(input: {
  /** Nothing is left ahead; this is the last one already missed. */
  overdue: boolean
  /** Something beneath this milestone carries an open blocker. */
  blocked: boolean
  status: string
  expected: number
}): 'none' | 'warn' | 'crit' {
  if (input.overdue) return 'crit'
  if (input.blocked) return 'crit'
  return concernOf(input.status, input.expected)
}
