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
    weight: 30,
    label: 'Blocks a project',
    means: 'While this is open, a project cannot move forward on something it needs.',
  },
  unblocks_project: {
    weight: 30,
    label: 'Unblocks a project',
    means: 'Doing this is what releases a blocked project.',
  },
  key_deliverable: {
    weight: 15,
    label: 'Key deliverable',
    means: "It is part of the project's main deliverable, not a side aspect.",
  },
  needs_decision: {
    weight: 15,
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
export const BASE: Record<ItemKind, number> = { blocker: 35, decision: 30, action: 20 }

/** One click of "more important" or "less important". */
export const ADJUST_STEP = 10

/**
 * Raised once is a little less than raised twice; each further place adds,
 * up to a point, so a thing everyone keeps repeating rises without swamping
 * what it actually is.
 */
export function mentionsBonus(mentions: number): number {
  const m = Math.max(1, Math.floor(mentions || 1))
  return m === 1 ? -5 : Math.min(15, (m - 1) * 5)
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

/*
 * BANDS ARE A DISTRIBUTION (Scott, 5 October 2026)
 *
 * The first scoring made 77 of 317 items Critical: a quarter of everything,
 * which is the same as nothing. Absolute thresholds cannot hold a shape -
 * tags drift, and a project that records its blockers carefully would be all
 * red. So the band is where an item ranks among the OPEN, ACTIVE items of its
 * own kind (blockers among blockers):
 *
 *   Critical  the top 10%, and only with a score of 60 or more
 *   High      the next 20% (to 30%), and 45 or more
 *   Medium    the next 30% (to 60%), and 25 or more
 *   Low       the rest
 *
 * The floors stop a weak item being called Critical just because everything
 * else is weaker. An inactive item - nobody has touched it for a week - is
 * never Critical, whatever its score: if it mattered that much, somebody
 * would be moving it. It is banded on its score alone, at most High.
 */
export const BAND_SHARE: Array<{ band: Band; upTo: number; floor: number }> = [
  { band: 'critical', upTo: 0.1, floor: 60 },
  { band: 'high', upTo: 0.3, floor: 45 },
  { band: 'medium', upTo: 0.6, floor: 25 },
]

/** On its score alone: for an item outside the ranking (inactive), or as a fallback. */
export function absoluteBand(score: number): Band {
  if (score >= 60) return 'critical'
  if (score >= 45) return 'high'
  if (score >= 25) return 'medium'
  return 'low'
}

const DOWN: Record<Band, Band> = { critical: 'high', high: 'medium', medium: 'low', low: 'low' }

export interface Bandable {
  kind: ItemKind
  score: number | null
  open: boolean
  inactive: boolean
  mentions: number
  lastActivityAt: Date
}

/**
 * Band every item, ranking the open active ones of each kind against each
 * other. Returns a band and a sentence saying why, per item, in input order.
 */
export function assignBands<T extends Bandable>(items: readonly T[]): Array<{ band: Band | null; note: string | null }> {
  const out: Array<{ band: Band | null; note: string | null }> = items.map(() => ({ band: null, note: null }))
  const NOUN: Record<ItemKind, string> = { blocker: 'blockers', decision: 'decisions', action: 'action items' }

  for (const kind of ['blocker', 'decision', 'action'] as const) {
    const ranked = items
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => item.kind === kind && item.open && !item.inactive && item.score != null)
      .sort(
        (a, b) =>
          b.item.score! - a.item.score! ||
          b.item.mentions - a.item.mentions ||
          b.item.lastActivityAt.getTime() - a.item.lastActivityAt.getTime(),
      )
    const n = ranked.length
    ranked.forEach(({ item, i }, rank) => {
      // Where the item's rank starts, as a share: the first of ten is at 0,
      // the second at 0.1. So of ten: one Critical, two High, three Medium.
      const at = rank / n
      const slot = BAND_SHARE.find((b) => at < b.upTo)
      let band: Band = slot ? slot.band : 'low'
      // Below the floor for its slot: down a band until it clears one.
      while (band !== 'low' && item.score! < BAND_SHARE.find((b) => b.band === band)!.floor) band = DOWN[band]
      out[i] = {
        band,
        note: `Number ${rank + 1} of ${n} open ${NOUN[kind]} by importance (score ${item.score}).`,
      }
    })

    for (const [i, item] of items.entries()) {
      if (item.kind !== kind || item.score == null || out[i]!.band) continue
      const abs = absoluteBand(item.score)
      out[i] = item.inactive && item.open
        ? { band: abs === 'critical' ? 'high' : abs, note: `Score ${item.score}. Inactive (no update for a week), so never Critical.` }
        : { band: abs, note: `Score ${item.score}.` }
    }
  }
  return out
}

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
