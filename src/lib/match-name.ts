/**
 * "Did you mean…" for names people type from memory.
 *
 * An agent asked to "move Keystone under GPC" gets given the words somebody
 * said out loud, not the string in the database. Requiring an exact match
 * meant she refused perfectly clear instructions over a missing "the", and
 * printing the first twelve initiatives alphabetically was no help at all — the
 * one they meant was rarely among them.
 *
 * This ranks candidates so she can ask one short question instead. It never
 * decides: it produces an ordered shortlist, and something else asks a person.
 * Guessing between two similar initiative names is exactly the mistake that ends
 * with one team's plan written onto another team's initiative.
 *
 * Deliberately not fuzzy in the clever sense. Three signals, in order of how
 * much they mean:
 *
 *   - one name contains the other ("GPC" in "GPC Taxonomy")
 *   - they share distinctive words ("Sports Dashboard" vs "Dashboard, Sports")
 *   - they are a few keystrokes apart ("Taxonmy" vs "Taxonomy")
 *
 * A typo-distance match alone is the weakest of the three and is capped, so
 * two unrelated four-letter names never look like a suggestion.
 */

/** Words too common to tell two pieces of work apart. */
const GENERIC = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by',
  'initiative', 'objective', 'programme', 'program', 'phase', 'project',
  'new', 'old', 'v1', 'v2', 'v3', 'data', 'platform', 'system', 'service',
])

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function words(s: string): string[] {
  return normalise(s).split(' ').filter((w) => w.length > 1 && !GENERIC.has(w))
}

/** Levenshtein, iterative and bounded by the shorter string. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = row
  }
  return prev[b.length]!
}

/** 0 to 1. Anything below about 0.35 is not worth showing anybody. */
export function similarity(query: string, candidate: string): number {
  const q = normalise(query)
  const c = normalise(candidate)
  if (!q || !c) return 0
  if (q === c) return 1

  // Before anything else: a query made entirely of words that cannot tell two
  // pieces of work apart identifies nothing. Without this, "data" scored 0.68
  // against "Data Platform Work" on containment alone — a confident suggestion
  // built on a word half the portfolio has in its name.
  if (words(q).length === 0) return 0

  // Containment. "GPC" against "GPC Taxonomy" is a strong signal, but a
  // two-letter query inside a long name is not, so it scales with how much of
  // the longer string the match accounts for.
  if (c.includes(q) || q.includes(c)) {
    const shorter = Math.min(q.length, c.length)
    const longer = Math.max(q.length, c.length)
    return 0.6 + 0.35 * (shorter / longer)
  }

  const qw = words(q)
  const cw = words(c)
  const shared = qw.filter((w) => cw.includes(w))
  if (shared.length > 0) {
    // Against the smaller set: "Dashboard" matching "Sports Dashboard" should
    // score well, not be punished for the words it did not say.
    return 0.45 + 0.45 * (shared.length / Math.min(qw.length, cw.length))
  }

  // Typo distance, and only for names close enough in length that the
  // comparison means something.
  const distance = editDistance(q, c)
  const longest = Math.max(q.length, c.length)
  if (distance > Math.max(2, Math.floor(longest * 0.25))) return 0
  return Math.max(0, 0.5 - distance / longest)
}

export interface Suggestion<T> {
  item: T
  name: string
  score: number
}

/**
 * The closest candidates, best first.
 *
 * Returns nothing rather than a weak guess when nothing is close: "I do not
 * know that one" is a better answer than a suggestion somebody has to read
 * carefully to reject.
 */
export function closest<T extends { name: string }>(
  query: string,
  candidates: readonly T[],
  limit = 4,
  floor = 0.35,
): Suggestion<T>[] {
  return candidates
    .map((item) => ({ item, name: item.name, score: similarity(query, item.name) }))
    .filter((s) => s.score >= floor)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** An exact match, ignoring case and punctuation. */
export function exact<T extends { name: string }>(query: string, candidates: readonly T[]): T | null {
  const q = normalise(query)
  return candidates.find((c) => normalise(c.name) === q) ?? null
}
