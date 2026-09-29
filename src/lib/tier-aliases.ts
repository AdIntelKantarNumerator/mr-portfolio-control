/**
 * Accepting the old tier words from something that has not been redeployed.
 *
 * The three tiers were renamed to line up with Linear's:
 *
 *   workstream -> project      (a Linear Project is this)
 *   project    -> initiative   (a Linear Initiative is this)
 *   initiative -> objective    (no Linear counterpart)
 *
 * Yaara writes to this app over HTTP and deploys separately from it, so for
 * some window one of them is running yesterday's vocabulary. If the API simply
 * rejected the old words, that window would be an outage — and, worse, a
 * *silent* one: her writes would 4xx into a log nobody reads while the board
 * quietly stopped moving.
 *
 * WHY THIS IS NOT JUST A LENIENT PARSER
 *
 * The dangerous case is not the rejected word, it is the accepted one. Every
 * old word is also a NEW word for a different tier: a caller saying "project"
 * could mean the tier that is now called an initiative, or the tier that is
 * now called a project, and nothing in the payload says which. Guessing costs
 * a record filed one level off, which nobody notices until a rollup is wrong.
 *
 * So the caller has to say which vocabulary it is speaking, once, in a header:
 *
 *     X-Tier-Vocabulary: 2026-09    (the old words)
 *
 * Absent the header the new words are assumed, which is what a caller written
 * after today sends and what Yaara sends the moment she is redeployed. Old
 * words WITHOUT the header are refused, with a message that says what to do —
 * because a caller sending "workstream" today is either stale or confused, and
 * either way the honest answer is to tell it so rather than to pick a tier on
 * its behalf.
 */

export const LEGACY_VOCABULARY = '2026-09'
export const VOCABULARY_HEADER = 'x-tier-vocabulary'

/** What each old word means in the new vocabulary. */
const LEGACY: Record<string, string> = {
  workstream: 'project',
  project: 'initiative',
  initiative: 'objective',
}

/** Words that only ever meant one thing, so they pass through either way. */
const UNCHANGED = new Set(['milestone', 'external', 'person', 'team'])

export interface TierReading {
  /** The tier in today's words, or null when it could not be read. */
  tier: string | null
  /** What to tell the caller when it could not be. */
  problem: string | null
}

/**
 * Read a tier name from a request.
 *
 * `legacy` is whether the caller declared the old vocabulary — see
 * vocabularyOf below, which reads the header for you.
 */
export function readTier(raw: string | null | undefined, legacy: boolean): TierReading {
  const word = String(raw ?? '').trim().toLowerCase()
  if (!word) return { tier: null, problem: 'No level was given.' }
  if (UNCHANGED.has(word)) return { tier: word, problem: null }

  if (legacy) {
    const mapped = LEGACY[word]
    if (mapped) return { tier: mapped, problem: null }
    return {
      tier: null,
      problem:
        `"${word}" is not a level in the ${LEGACY_VOCABULARY} vocabulary. ` +
        'It had workstream, project and initiative.',
    }
  }

  if (word === 'objective' || word === 'initiative' || word === 'project') {
    return { tier: word, problem: null }
  }

  if (word === 'workstream') {
    return {
      tier: null,
      problem:
        'The levels were renamed: a workstream is now a project, a project is now an initiative, ' +
        'and an initiative is now an objective. Send the new word, or set ' +
        `${VOCABULARY_HEADER}: ${LEGACY_VOCABULARY} to keep sending the old ones for now.`,
    }
  }

  return { tier: null, problem: `"${word}" is not a level. Use objective, initiative or project.` }
}

/** True when the caller has declared it is still speaking the old words. */
export function vocabularyOf(headers: Headers): boolean {
  return headers.get(VOCABULARY_HEADER)?.trim() === LEGACY_VOCABULARY
}
