/**
 * The parts of the agent lookup with no database: which areas exist, and how
 * a line is made and filtered. Apart from lib/agent-lookup.ts so tests can
 * load them without opening a database.
 */

export const LOOKUP_AREAS = [
  'intake',
  'prioritization',
  'dependencies',
  'readiness',
  'teams',
  'activity',
  'workflow',
  'dictionary',
  'briefs',
] as const
export type LookupArea = (typeof LOOKUP_AREAS)[number]

export const AREA_HELP: Record<LookupArea, string> = {
  intake: 'requests that have not started: title, status, requester, wanted-by date, size, score',
  prioritization: 'intake requests ranked by the active scoring model, highest first',
  dependencies: 'what is waiting on what, with status, criticality, due date and owner',
  readiness: 'launch-readiness gates per active project: how many required items are done, and which are not',
  teams: 'teams and which initiatives each is allocated to',
  activity: 'the most recent changes anyone made in the portfolio, newest first',
  workflow: 'the Workflow Assessment map: every component, what it does, who owns it, and what it feeds',
  dictionary: 'the Data Dictionary: datasets with what is loaded in ClickHouse Dev, schema statuses, and table warnings',
  briefs: 'the latest conversation brief on each initiative or project',
}

export const LIMIT = 80

export function readArea(raw: unknown): LookupArea | null {
  return (LOOKUP_AREAS as readonly string[]).includes(String(raw)) ? (raw as LookupArea) : null
}

/** One line, kept to one line: free text from a form can hold anything. */
export function line(...parts: Array<string | null | undefined | false>): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .join(' · ')
    .slice(0, 400)
}

/**
 * Keep the lines that mention every word of `q`. Words, not the phrase,
 * because "sports sponsorship loaded" should find the line that says
 * "Sports Sponsorship … Loaded" with other words between.
 */
export function filterLines(lines: string[], q: string | null | undefined): string[] {
  const words = (q ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 1)
  if (!words.length) return lines
  return lines.filter((l) => {
    const low = l.toLowerCase()
    return words.every((w) => low.includes(w))
  })
}
