/**
 * Walking the three tiers, up and down.
 *
 * Initiative → project → workstream. Two questions get asked of that shape all
 * over the app, and both were being answered ad hoc where they came up.
 *
 * UPWARDS: WHAT IS THIS UNDER?
 *
 * The Action Items page showed a workstream and "Unknown" for both the project
 * and the initiative, because it read only the tier the item had been filed
 * against. But a tier above is never unknown — it is a fact about where the
 * work sits. A tier BELOW can be genuinely unknown, and stays that way: an
 * action filed against an initiative is not secretly about one of its
 * workstreams, and guessing one would be inventing a link nobody made.
 *
 * DOWNWARDS: WHAT COUNTS AS PART OF THIS?
 *
 * A home card's counts roll up — "10 blockers" on an initiative means ten
 * across everything beneath it. So a page filtered to that initiative has to
 * use the same set, or the reader clicks a count of ten and arrives at a list
 * of none. That mismatch is worse than no link at all, because it reads as
 * data loss rather than a filter.
 */

export type Tier = 'initiative' | 'project' | 'workstream'

export const TIERS: Tier[] = ['initiative', 'project', 'workstream']

export function isTier(v: string | null | undefined): v is Tier {
  return v === 'initiative' || v === 'project' || v === 'workstream'
}

/** Who sits directly above whom. Both maps are child id → parent id. */
export interface Parents {
  /** workstream id → project id */
  projectOf: ReadonlyMap<string, string | null>
  /** project id → initiative id */
  initiativeOf: ReadonlyMap<string, string | null>
}

export interface Ancestry {
  initiative: string | null
  project: string | null
  workstream: string | null
}

/**
 * Where a record sits, filled in upwards from the tier it was filed against.
 *
 * Only upwards. A tier below the one given stays null, because nothing in the
 * data says which one it would be.
 */
export function ancestryOf(level: Tier, id: string, parents: Parents): Ancestry {
  if (level === 'workstream') {
    const project = parents.projectOf.get(id) ?? null
    return {
      workstream: id,
      project,
      initiative: project ? (parents.initiativeOf.get(project) ?? null) : null,
    }
  }
  if (level === 'project') {
    return { workstream: null, project: id, initiative: parents.initiativeOf.get(id) ?? null }
  }
  return { workstream: null, project: null, initiative: id }
}

/**
 * Where a record sits when several links place it at once.
 *
 * An action can be filed against more than one thing — "the Creative Central
 * workstream, and the Global initiative" is a real and reasonable pair. Each
 * link fills in the tiers above itself, so the two can disagree about a tier
 * neither of them named directly, and the order rows come back in must not
 * decide which answer wins.
 *
 * Two rules settle it:
 *
 *   - A tier somebody FILED wins over the same tier INFERRED from another
 *     link. The filing is a fact; the inference is a guess about a fact.
 *   - Between two links at the same tier, the first wins, because one record
 *     cannot be in two projects at once and picking the later one would make
 *     the column disagree with itself as rows are reordered.
 *
 * This is what the Action Items page's Initiative column reads, and — through
 * scopeFilter — what decides whether a card's link shows the record it
 * counted. Getting it wrong dropped a row from a list of three.
 */
export function placeOf(
  links: ReadonlyArray<{ level: Tier; id: string }>,
  parents: Parents,
): Ancestry {
  const out: Ancestry = { initiative: null, project: null, workstream: null }
  const filed = new Set<Tier>()

  for (const link of links) {
    if (filed.has(link.level)) continue
    const at = ancestryOf(link.level, link.id, parents)
    for (const tier of TIERS) {
      if (!at[tier]) continue
      if (tier === link.level) out[tier] = at[tier]
      else if (!out[tier] && !filed.has(tier)) out[tier] = at[tier]
    }
    filed.add(link.level)
  }
  return out
}

/** Who sits directly beneath whom. Both maps are parent id → child ids. */
export interface Children {
  /** initiative id → project ids */
  projectsIn: ReadonlyMap<string, readonly string[]>
  /** project id → workstream ids */
  workstreamsIn: ReadonlyMap<string, readonly string[]>
}

/**
 * Every id at or beneath one record, including its own.
 *
 * "Including its own" matters: a blocker filed against the initiative itself
 * is part of that initiative's count, and leaving it out would make the page
 * disagree with the card that linked to it.
 */
export function idsAtOrBelow(level: Tier, id: string, children: Children): Set<string> {
  const out = new Set<string>([id])
  if (level === 'workstream') return out

  const projects = level === 'initiative' ? (children.projectsIn.get(id) ?? []) : [id]
  for (const p of projects) {
    out.add(p)
    for (const w of children.workstreamsIn.get(p) ?? []) out.add(w)
  }
  return out
}

/** "initiative:abc" → the pair, or null when it is not one. */
export function parseScope(raw: string | null | undefined): { level: Tier; id: string } | null {
  const [level, ...rest] = String(raw ?? '').split(':')
  const id = rest.join(':')
  if (!isTier(level) || !id) return null
  return { level, id }
}

/** The other direction, for building a link. */
export function formatScope(level: Tier, id: string): string {
  return `${level}:${id}`
}
