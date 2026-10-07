/**
 * How a piece of work is doing, from things that are true.
 *
 * WHY THERE IS NO PERCENTAGE HERE
 *
 * The board showed a completion ring for three versions running, and all three
 * were wrong in the same way: the number did not come from anybody counting
 * anything.
 *
 *   - First it was a lookup on the next milestone's status — on_track was 55,
 *     at_risk 40 — so every on-track card on the board read exactly 55%.
 *   - Then it was the share of the calendar already gone between the work's
 *     start and the milestone's date. That is elapsed time wearing the word
 *     "progress": add a milestone today, dated three weeks out, to work that
 *     began in June, and it opens at 80% before anybody has touched it.
 *
 * The second is the worse of the two, because it is plausible. A number that
 * moves on its own, every day, without any work happening is not a weak
 * measurement — it is not a measurement. There is no coefficient that fixes
 * it, so the ring is gone rather than re-tuned.
 *
 * WHAT IS LEFT IS EVERYTHING THAT WAS ALREADY TRUE
 *
 * Blockers somebody filed. Dependencies whose required date the delivering end
 * will miss. Milestones whose date has passed with the work not done. Children
 * whose own status says they are in trouble. And silence — nothing recorded
 * for weeks, which is not health, only the absence of news.
 *
 * Each of those is a fact with a source, and each is reported as a reason
 * rather than folded into a score. "At risk" on its own asks the reader to
 * trust it; "at risk — 2 milestones overdue, nothing recorded in 3 weeks"
 * tells them what to go and look at.
 *
 * WHY SILENCE NO LONGER OUTRANKS TROUBLE
 *
 * It used to: a card with no recent activity was "quiet" whatever else was
 * true, so an objective with four open blockers and a missed date could
 * report no signal. Silence is now a reason that travels with the state
 * instead of replacing it — and on work with nothing wrong, it is still the
 * headline, because nothing wrong and nothing happening is not the same as
 * going well.
 */

/** The four states, worst first. Same vocabulary the rest of the board uses. */
export type Health = 'crit' | 'warn' | 'good' | 'quiet'

export interface Reason {
  /** One short clause, already pluralised. */
  text: string
  /** How it reads: a problem, a caution, or context. */
  tone: 'crit' | 'warn' | 'muted'
}

export interface CardHealth {
  health: Health
  /** Worst first, and never empty — a state with no reason is a claim. */
  reasons: Reason[]
  /** The one-line version, for a tooltip or a narrow card. */
  summary: string
}

export interface HealthFacts {
  /** Open blockers filed against this work or anything beneath it. */
  blockers: number
  /** The oldest of those, in days. Null when there are none. */
  oldestBlockerDays: number | null
  /** Dependencies this work is going to miss the required date on. */
  lateDependencies: number
  /** Dated, not done, and the date has passed. */
  overdueMilestones: number
  /** Children whose own status says blocked or at risk. */
  troubledChildren: number
  /** How many children there are at all, so a count can be put in proportion. */
  totalChildren: number
  /** Days since anything was recorded. Null means nothing ever was. */
  daysSinceActivity: number | null
}

/** Past this many days with nothing recorded, silence is worth saying out loud. */
const QUIET_DAYS = 14

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function cardHealth(f: HealthFacts): CardHealth {
  const reasons: Reason[] = []

  if (f.blockers > 0) {
    reasons.push({
      tone: 'crit',
      text:
        f.oldestBlockerDays !== null && f.oldestBlockerDays >= 1
          ? `${plural(f.blockers, 'blocker')}, oldest open ${plural(f.oldestBlockerDays, 'day')}`
          : plural(f.blockers, 'blocker'),
    })
  }

  if (f.lateDependencies > 0) {
    reasons.push({
      tone: 'crit',
      // The delivering end is the one that has to move, which is why it is
      // this card's problem and not the waiting end's.
      text: `${plural(f.lateDependencies, 'dependency', 'dependencies')} will miss the date`,
    })
  }

  if (f.overdueMilestones > 0) {
    reasons.push({ tone: 'warn', text: `${plural(f.overdueMilestones, 'milestone')} overdue` })
  }

  if (f.troubledChildren > 0) {
    reasons.push({
      tone: 'warn',
      text:
        f.totalChildren > 0
          ? `${f.troubledChildren} of ${f.totalChildren} in trouble`
          : plural(f.troubledChildren, 'item') + ' in trouble',
    })
  }

  const silent = f.daysSinceActivity === null || f.daysSinceActivity >= QUIET_DAYS
  if (silent) {
    reasons.push({
      tone: 'muted',
      text:
        f.daysSinceActivity === null
          ? 'nothing recorded yet'
          : `nothing recorded in ${weeks(f.daysSinceActivity)}`,
    })
  }

  // Trouble outranks silence: an objective with four blockers that nobody has
  // written about in a month is blocked, and reporting "no signal" buries it.
  const health: Health =
    f.blockers > 0 || f.lateDependencies > 0
      ? 'crit'
      : f.overdueMilestones > 0 || f.troubledChildren > 0
        ? 'warn'
        : silent
          ? 'quiet'
          : 'good'

  if (reasons.length === 0) {
    // Earned, and said plainly: the things that would show trouble were
    // checked and were not there. That is different from nobody looking.
    reasons.push({ tone: 'muted', text: 'nothing blocked, nothing overdue, active this week' })
  }

  return { health, reasons, summary: reasons.map((r) => r.text).join(' · ') }
}

function weeks(days: number): string {
  if (days < 14) return plural(days, 'day')
  const w = Math.floor(days / 7)
  return w < 9 ? plural(w, 'week') : plural(Math.floor(days / 30), 'month')
}

/**
 * The card's state: the assessment when there is one, the facts when not.
 *
 * WHY THE ASSESSMENT WINS (Scott, 7 October 2026)
 *
 * The home card said "Blocked" and the detail page's Health tile, one click
 * away, said "At risk" - for every objective on the board. The card worked
 * its state out from the facts, and any open blocker anywhere beneath made it
 * crit; once the follow-up work began filing blockers in earnest, every
 * objective had one. The Health tile shows the assessment Yaara or a person
 * made, which weighs those same blockers against everything else. Two
 * answers to one question, a click apart, is the thing to fix, and the
 * assessment is the considered one.
 *
 * So the assessment sets the state and the facts stay as its reasons: "At
 * risk - 14 blockers, oldest open 9 days". Work nobody has assessed, or
 * assessed as unknown, keeps the state the facts give it.
 */
export function assessedHealth(rag: string | null | undefined, facts: CardHealth): CardHealth {
  const fromRag: Health | null = rag === 'red' ? 'crit' : rag === 'amber' ? 'warn' : rag === 'green' ? 'good' : null
  return fromRag ? { ...facts, health: fromRag } : facts
}

/**
 * What to call each state on screen. The same words as the detail page's
 * Health tile (components/detail/health-tile.tsx), since the state is now
 * usually that tile's assessment: red is "In trouble", not "Blocked", which a
 * red assessment need not be.
 */
export const HEALTH_LABEL: Record<Health, string> = {
  crit: 'In trouble',
  warn: 'At risk',
  good: 'On track',
  quiet: 'No signal',
}

/**
 * The colour a state is drawn in, wherever it is drawn.
 *
 * One rule, so the same work cannot read one colour on the board and another
 * on a list page. This used to live in components/ring.tsx beside the
 * completion ring, and took a `behind` argument — the gap between the ring's
 * number and the plan line — which it preferred over the state it was handed.
 * That is how a blocked card came to draw a green ring beside its own Blocked
 * pill.
 */
export function stateColor(health: Health): string {
  return { crit: 'var(--crit)', warn: 'var(--warn)', good: 'var(--good)', quiet: 'var(--line-2)' }[health]
}

/**
 * A row's left edge: the state, falling back to the last assessment.
 *
 * 'quiet' falls through to the RAG on purpose. Nobody has reported lately,
 * but somebody's last judgement is better than a neutral line.
 */
export function edgeColor(health: Health | null, rag?: string | null): string | null {
  if (health && health !== 'quiet') return stateColor(health)
  if (rag === 'red') return 'var(--crit)'
  if (rag === 'amber') return 'var(--warn)'
  if (rag === 'green') return 'var(--good)'
  return null
}
