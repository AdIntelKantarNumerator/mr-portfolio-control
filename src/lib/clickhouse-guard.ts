/**
 * The rule that keeps the portfolio's ClickHouse access read-only.
 *
 * WHY THREE LAYERS
 *
 * The portfolio was allowed to read ClickHouse directly on the condition that
 * it only ever reads (decided 1 October 2026). On the day that was decided,
 * the user it had been given belonged to `app_readwrite`, which carries
 * INSERT, ALTER UPDATE and ALTER DELETE on every database. So "the account is
 * read-only" was not true, and nothing in the app may lean on it.
 *
 *   1. This module: every statement is checked before it is sent. Only
 *      SELECT, WITH, SHOW, DESCRIBE, EXISTS and EXPLAIN pass, one statement at
 *      a time. The app only sends fixed queries against system tables, so
 *      this should never fire — it exists for the day somebody adds a query.
 *   2. The request: `readonly=2` goes on every call. ClickHouse then refuses
 *      any write regardless of the user's grants, and refuses a query that
 *      tries to set readonly back to 0 (verified against Dev: Code 164).
 *      2 rather than 1 because 1 also refuses max_execution_time, which the
 *      app sets so a slow read cannot hang a page.
 *   3. The account: deploy/AZURE.md asks for a dedicated user with SELECT
 *      only. That is the layer that holds if the first two are ever removed.
 *
 * WHAT THIS IS NOT
 *
 * It is not a SQL parser and does not try to be one. It refuses anything that
 * is not plainly a read, including reads it cannot be sure about, because the
 * cost of a false refusal here is a developer rewording a query and the cost
 * of a false pass is a write to a production warehouse.
 */

const READ_VERBS = ['select', 'with', 'show', 'describe', 'desc', 'exists', 'explain'] as const

/** Words that have no business in a read, wherever they appear outside a string literal. */
const WRITE_WORDS = [
  'insert',
  'alter',
  'create',
  'drop',
  'truncate',
  'rename',
  'delete',
  'update',
  'optimize',
  'attach',
  'detach',
  'grant',
  'revoke',
  'system',
  'kill',
  'set',
  'exchange',
  'undrop',
  'move',
  'backup',
  'restore',
] as const

/** The settings every request carries. See layer 2 above. */
export const READ_ONLY_PARAMS: Readonly<Record<string, string>> = {
  readonly: '2',
  max_execution_time: '20',
}

/**
 * Remove string literals, quoted identifiers and comments, so a word inside a
 * comment or a value ("WHERE name = 'drop_zone'") is not mistaken for a verb.
 */
function code(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

/** Why `sql` may not be sent, or null when it may. */
export function readOnlyProblem(sql: string): string | null {
  const stripped = code(sql).trim().replace(/;\s*$/, '')
  if (!stripped) return 'Empty query.'
  if (stripped.includes(';')) return 'One statement at a time.'
  const first = stripped.split(/[\s(]+/, 1)[0]!.toLowerCase()
  if (!(READ_VERBS as readonly string[]).includes(first)) return `"${first}" is not a read.`
  const words = new Set(stripped.toLowerCase().match(/[a-z_]+/g) ?? [])
  // `system` is both a verb (SYSTEM DROP CACHE …) and the database the app
  // reads constantly (system.tables). As a database it is always followed by
  // a dot, so that is the one form allowed.
  for (const w of WRITE_WORDS) {
    if (w === 'system') {
      if (/\bsystem\b(?!\s*\.)/i.test(stripped)) return 'SYSTEM commands are not reads.'
      continue
    }
    if (w === 'set') {
      // SETTINGS is fine; a bare SET statement is caught by the first-word
      // check, and "set" as a word inside a read has no legitimate use here.
      if (words.has('set')) return '"set" has no place in a read.'
      continue
    }
    if (words.has(w)) return `"${w}" has no place in a read.`
  }
  if (/\breadonly\s*=/i.test(stripped)) return 'A query may not change the readonly setting.'
  return null
}

export function assertReadOnly(sql: string): void {
  const problem = readOnlyProblem(sql)
  if (problem) throw new Error(`Refused to send to ClickHouse: ${problem}`)
}
