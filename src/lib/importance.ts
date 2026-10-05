/**
 * How important a blocker, decision or action item is: the rule, with no
 * database in it.
 *
 * WHY (5 October 2026)
 *
 * Keystone's card said "91 open actions", and the list behind it gave nobody
 * a way to tell which of them mattered. Scott set out what does:
 *
 *   - Most important: an item that blocks a project, or doing which unblocks
 *     one. A blocker in the key deliverable. A blocker needing a decision.
 *   - More important the more places it comes up; less if raised only once.
 *   - Less important: logistics (submit a PR, set up a meeting, create a
 *     ticket or channel, have a conversation); a blocker that touches a small
 *     part (a little missing data, one person's tooling, something far out);
 *     a blocker that is one bug.
 *
 * WHY FACTORS, NOT A NUMBER
 *
 * Yaara tags each item with the factors that apply, with the evidence for
 * each, and the score is computed here from those tags. A number she simply
 * chose would drift from one pass to the next and could not be explained; a
 * factor can be shown in the "why is this important" popup with its quote,
 * and argued with.
 *
 * WHY THE ADJUSTMENT IS SEPARATE
 *
 * Anyone can raise or lower an item, in the app or by telling her. That is
 * kept as its own number and added on top, so when she re-scores an item
 * after new evidence the person's judgement is not wiped out.
 */

export type ItemKind = 'blocker' | 'decision' | 'action'

export interface Factor {
  weight: number
  label: string
  /** What it means, in the words Yaara is given when she tags items. */
  means: string
}

export const FACTORS = {
  blocks_project: {
    weight: 35,
    label: 'Blocks a project',
    means: 'While this is open, a project cannot move forward on something it needs.',
  },
  unblocks_project: {
    weight: 35,
    label: 'Unblocks a project',
    means: 'Doing this is what releases a blocked project.',
  },
  key_deliverable: {
    weight: 20,
    label: 'Key deliverable',
    means: "It is part of the project's main deliverable, not a side aspect.",
  },
  needs_decision: {
    weight: 20,
    label: 'Needs a decision',
    means: 'It cannot move until somebody decides something.',
  },
  logistical: {
    weight: -20,
    label: 'Logistics',
    means: 'Submitting a pull request, setting up a meeting, having a conversation, creating a ticket or a channel.',
  },
  single_bug: {
    weight: -15,
    label: 'A single bug',
    means: 'One bug, rather than something structural.',
  },
  minor_scope: {
    weight: -15,
    label: 'Small part',
    means: 'It affects a small aspect: a little missing data, one person unable to use a tool, one report.',
  },
  far_out: {
    weight: -10,
    label: 'Further out',
    means: 'It bears on delivery well beyond the next milestone.',
  },
} as const satisfies Record<string, Factor>

export type FactorKey = keyof typeof FACTORS

export function isFactor(v: string): v is FactorKey {
  return Object.prototype.hasOwnProperty.call(FACTORS, v)
}

/** Where each kind starts, before any factor. A blocker is something in the way by definition. */
export const BASE: Record<ItemKind, number> = { blocker: 40, decision: 35, action: 25 }

/** One click of "more important" or "less important". */
export const ADJUST_STEP = 10

/**
 * Raised once is a little less than raised twice; each further place adds,
 * up to a point, so a thing everyone keeps repeating rises without swamping
 * what it actually is.
 */
export function mentionsBonus(mentions: number): number {
  const m = Math.max(1, Math.floor(mentions || 1))
  return m === 1 ? -5 : Math.min(20, (m - 1) * 7)
}

export function scoreOf(kind: ItemKind, factors: readonly string[], mentions: number, adjust = 0): number {
  const keys = [...new Set(factors.filter(isFactor))]
  // Blocking and unblocking are the same importance seen from two ends; an
  // item that is both is not twice as important.
  const blocking = keys.includes('blocks_project') || keys.includes('unblocks_project') ? FACTORS.blocks_project.weight : 0
  const rest = keys
    .filter((k) => k !== 'blocks_project' && k !== 'unblocks_project')
    .reduce((sum, k) => sum + FACTORS[k].weight, 0)
  // Her part is capped first, then the person's adjustment applied: capped
  // last, an item far over 100 swallowed a click on "less important" and
  // nothing visibly changed.
  const hers = Math.max(0, Math.min(100, BASE[kind] + blocking + rest + mentionsBonus(mentions)))
  return Math.max(0, Math.min(100, Math.round(hers + adjust)))
}

export type Band = 'critical' | 'high' | 'medium' | 'low'

export function bandOf(score: number | null | undefined): Band | null {
  if (score == null) return null
  if (score >= 70) return 'critical'
  if (score >= 50) return 'high'
  if (score >= 30) return 'medium'
  return 'low'
}

export const BAND_LABEL: Record<Band, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }

export function parseFactors(raw: string | null | undefined): FactorKey[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? [...new Set(v.map(String).filter(isFactor))] : []
  } catch {
    return []
  }
}

export interface Reason {
  factor: string
  why: string
  quote?: string | null
  source?: string | null
  url?: string | null
}

export function parseReasons(raw: string | null | undefined): Reason[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v
      .map((r) => r as Record<string, unknown>)
      .filter((r) => typeof r.factor === 'string' && typeof r.why === 'string')
      .map((r) => ({
        factor: String(r.factor),
        why: String(r.why),
        quote: typeof r.quote === 'string' ? r.quote : null,
        source: typeof r.source === 'string' ? r.source : null,
        url: typeof r.url === 'string' ? r.url : null,
      }))
  } catch {
    return []
  }
}
