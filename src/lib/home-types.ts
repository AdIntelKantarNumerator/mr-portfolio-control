/**
 * The board's vocabulary, with nothing behind it.
 *
 * Level, sort and health filter, and the guards that validate them. Split out
 * of lib/home.ts because the client needs them and lib/home.ts opens a
 * database connection at import time — a client component importing it pulled
 * `pg` into the browser bundle, and the page 500'd on "Can't resolve 'dns'".
 *
 * The rule this encodes: a type shared across the server/client line lives in
 * a module that imports nothing.
 */
export type Level = 'initiative' | 'project' | 'workstream'
export const LEVELS: Level[] = ['initiative', 'project', 'workstream']

export function isLevel(v: string | undefined): v is Level {
  return v === 'initiative' || v === 'project' || v === 'workstream'
}

/**
 * How the board is ordered, and what it leaves out.
 *
 * Both live in the URL so a filtered board can be sent to somebody, and both
 * are applied on the server so the page that arrives is the page that was
 * asked for — filtering after render means the first paint is a board the
 * reader did not choose.
 */
export type Sort = 'active' | 'quiet' | 'name'
export const SORTS: Sort[] = ['active', 'quiet', 'name']
export function isSort(v: string | undefined): v is Sort {
  return v === 'active' || v === 'quiet' || v === 'name'
}

/** 'all', or one of the health states a card can be in. */
export type HealthFilter = 'all' | 'good' | 'crit'
export const HEALTHS: HealthFilter[] = ['all', 'good', 'crit']
export function isHealth(v: string | undefined): v is HealthFilter {
  return v === 'all' || v === 'good' || v === 'crit'
}
