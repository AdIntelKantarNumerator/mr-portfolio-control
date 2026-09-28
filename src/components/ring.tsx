'use client'

/**
 * The completion ring, and the colour rule behind it.
 *
 * Lives here rather than inside the home card because three screens draw it
 * now — the home board, the initiatives list and the projects list — and the
 * rule for what colour it is has to be the same on all of them. A ring that
 * is red on one page and amber on another for the same work is worse than no
 * ring.
 */

/**
 * Coordinates rounded before they reach the DOM.
 *
 * Math.cos on the server and Math.cos in the browser can disagree in the last
 * bit — 88.15874509685646 against ...648 — and React reports that as a
 * hydration mismatch and stops patching the tree. Three decimals is far below
 * a pixel at this size and is identical on both sides.
 */
const px = (n: number) => Math.round(n * 1000) / 1000

export function Ring({ pct, expected, color }: { pct: number; expected: number; color: string }) {
  const R = 50
  const C = 2 * Math.PI * R
  const len = (C * pct) / 100
  const a = ((expected / 100) * 360 - 90) * (Math.PI / 180)
  return (
    <span className="dial">
      <svg width="112" height="112" viewBox="0 0 118 118" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx="59" cy="59" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="13" />
        <circle
          cx="59"
          cy="59"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${px(len)} ${px(C - len)}`}
        />
      </svg>
      <svg width="112" height="112" viewBox="0 0 118 118" className="tick" aria-hidden="true">
        <line
          x1={px(59 + Math.cos(a) * 40)}
          y1={px(59 + Math.sin(a) * 40)}
          x2={px(59 + Math.cos(a) * 59)}
          y2={px(59 + Math.sin(a) * 59)}
          stroke="var(--ink)"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity=".62"
        />
      </svg>
    </span>
  )
}

/**
 * How far behind the calendar says this is, as a colour.
 *
 * Quiet work gets the neutral line colour rather than green: nobody has
 * touched it, so "on track" would be a claim the evidence does not support.
 * Everything else is the gap between done and due — four points is noise,
 * fifteen is a conversation.
 */
export function paceColor(health: 'good' | 'warn' | 'crit' | 'quiet', behind: number): string {
  if (health === 'quiet') return 'var(--line-2)'
  if (behind > 15) return 'var(--crit)'
  if (behind > 4) return 'var(--warn)'
  return 'var(--good)'
}

/**
 * The ring with its caption, for a list row: percentage inside, what it is
 * measured against underneath.
 */
export function NextMilestoneRing({
  pct,
  expected,
  health,
  size = 56,
}: {
  pct: number
  expected: number
  health: 'good' | 'warn' | 'crit' | 'quiet'
  size?: number
}) {
  const color = paceColor(health, expected - pct)
  return (
    <span className="ringmini" style={{ width: size, height: size }}>
      <Ring pct={pct} expected={expected} color={color} />
      <span className="pct" style={{ color }}>
        {pct}%
      </span>
    </span>
  )
}

/**
 * The colour of a row's left edge.
 *
 * Pace is the better signal and wins where it exists — how far behind the
 * calendar something is says more than a colour somebody typed in June. But
 * a row with no milestone has no pace, and rendering that as a neutral grey
 * edge meant a workstream assessed "In trouble" sat in a list looking
 * exactly like one nobody had an opinion about.
 *
 * So: pace, then the assessment, then nothing — and the caller supplies the
 * status colour for that last case, because the status vocabulary is
 * different at each tier and this function has no business knowing it.
 */
export function edgeColor(
  pace: 'good' | 'warn' | 'crit' | 'quiet' | null,
  behind: number,
  rag?: string | null,
): string | null {
  if (pace && pace !== 'quiet') return paceColor(pace, behind)
  if (rag === 'red') return 'var(--crit)'
  if (rag === 'amber') return 'var(--warn)'
  if (rag === 'green') return 'var(--good)'
  return null
}

/**
 * A milestone name cut down to a few words, for the caption under a ring.
 *
 * Milestone names in this portfolio run long and front-load the context -
 * "Insight Studio - Client Launch (MVP)", "Board sign-off on the Q1 shape".
 * The distinguishing part is almost always at the end, but truncating from
 * the left reads as a bug, so this drops the parts that carry no information
 * instead: the entity name before a dash, bracketed asides, and the small
 * words that only exist to join the others.
 *
 * It is deliberately not clever. Anything it cannot shorten is returned with
 * an ellipsis, and the full name is on the row above and in the title
 * attribute, so a bad abbreviation costs nothing.
 */
const FILLER = new Set([
  'a', 'an', 'the', 'of', 'for', 'to', 'on', 'in', 'at', 'by', 'and', 'with', 'from', 'into', 'our',
])

export function shortMilestone(name: string, words = 3): string {
  // "Project - Thing that matters" keeps the part after the last dash, which
  // is the part that is not already the row's own title.
  const tail = name.split(/\s+[-–—]\s+/).pop() ?? name
  const cleaned = tail
    .replace(/\([^)]*\)/g, ' ')  // bracketed asides
    .replace(/[^\p{L}\p{N}+/&.'\u2019\s-]/gu, ' ')  // apostrophes stay: "Nat'l" is one word
    .trim()

  const parts = cleaned.split(/\s+/).filter(Boolean)
  // Filler only goes if something survives it; "State of the Union" should
  // not become "State Union" when the whole name is four words of filler.
  const meaty = parts.filter((w, i) => i === 0 || !FILLER.has(w.toLowerCase()))
  const use = (meaty.length ? meaty : parts).slice(0, words)
  if (use.length === 0) return name.slice(0, 24)

  const out = use.join(' ')
  const dropped = (meaty.length ? meaty : parts).length > use.length
  return dropped ? `${out}…` : out
}
