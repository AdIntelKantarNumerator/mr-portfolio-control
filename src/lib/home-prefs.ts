/**
 * Remembering how somebody last had the board set.
 *
 * WHY A COOKIE AND NOT localStorage
 *
 * The board is rendered on the server. localStorage is only readable after
 * hydration, so restoring from it means painting the default board first and
 * replacing it a moment later — the reader watches their view change out from
 * under them on every visit, which reads as a bug even when it lands on the
 * right answer.
 *
 * A cookie arrives with the request. The server renders the board they left,
 * first time, with no flash and no redirect.
 *
 * WHY THE URL STILL WINS
 *
 * The cookie is the fallback, not the truth. A link to
 * /?level=project&health=crit has to show that board to whoever opens it,
 * including somebody whose own last view was something else — otherwise the
 * link is not a link, it is a suggestion.
 */
import { isHealth, isLevel, isSort, type HealthFilter, type Level, type Sort } from './home-types'

export const HOME_PREFS_COOKIE = 'pcr:home'

export interface HomePrefs {
  level: Level
  sort: Sort
  health: HealthFilter
}

export const HOME_DEFAULTS: HomePrefs = { level: 'objective', sort: 'active', health: 'all' }

/**
 * Parse `level.sort.health`.
 *
 * Positional and delimited rather than JSON: three known values in a fixed
 * order do not need a parser, and a cookie that cannot throw is one less
 * thing between a reader and their page. Anything unrecognised falls back to
 * the default for that field alone — a stale cookie from an older build
 * degrades one setting, not the whole board.
 */
export function parseHomePrefs(raw: string | undefined): HomePrefs {
  const [level, sort, health] = (raw ?? '').split('.')
  return {
    level: isLevel(level) ? level : HOME_DEFAULTS.level,
    sort: isSort(sort) ? sort : HOME_DEFAULTS.sort,
    health: isHealth(health) ? health : HOME_DEFAULTS.health,
  }
}

export function serialiseHomePrefs(p: HomePrefs): string {
  return `${p.level}.${p.sort}.${p.health}`
}

/**
 * What the board should show: the URL where it says, the cookie where it does
 * not.
 */
export function resolveHomePrefs(
  query: { level?: string; sort?: string; health?: string },
  cookie: string | undefined,
): HomePrefs {
  const remembered = parseHomePrefs(cookie)
  return {
    level: isLevel(query.level) ? query.level : remembered.level,
    sort: isSort(query.sort) ? query.sort : remembered.sort,
    health: isHealth(query.health) ? query.health : remembered.health,
  }
}
