/**
 * Ordering a register by one of its columns.
 *
 * The four registers each arrive in a deliberate order — overdue first on
 * Action items, open-then-oldest on Blockers — and those defaults answer the
 * question most people came with. They do not answer everybody's: "what is due
 * next" and "what does Priya owe" are different questions about the same
 * fifty rows, and re-reading the whole list to answer one of them is the work
 * the column headings should be doing.
 *
 * Three rules, which are the whole of this file:
 *
 * BLANK SORTS LAST, IN BOTH DIRECTIONS. An action with no due date is not due
 * first and it is not due last — it is not dated, and a sort by date has
 * nothing to say about it. Sending it to the bottom either way keeps the top
 * of the list meaning what it says. Treating blank as a value (an empty string
 * sorts before everything, and to the top the moment you reverse) fills the
 * first screen with exactly the rows the reader was not asking about.
 *
 * A DATE COLUMN IS NOT ALWAYS A DATE. `Needed by` on the register is free
 * text: most rows hold a date, some hold "ASAP" or "before the board". Real
 * dates order among themselves chronologically and come first; the words
 * follow, alphabetically. Sorting the lot as text would file 2026-10-01 after
 * "ASAP" and call it done.
 *
 * TIES KEEP THE ORDER THEY CAME IN. Array.prototype.sort has been stable since
 * ES2019, so sorting by Owner leaves each owner's rows in the page's own
 * order — which is to say still overdue-first underneath. A sort you apply on
 * top of a considered default should not discard it.
 */

export type SortKind = 'text' | 'date' | 'number'

/** What a column contributes to the order. Null and '' both count as blank. */
export type SortValue = string | number | null | undefined

export interface Order {
  key: string
  dir: 1 | -1
}

function blank(v: SortValue): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

/**
 * A date, as a number, or null when this is not one.
 *
 * Deliberately strict: `Date.parse` accepts a great deal that is not a date,
 * and reading "March" or "4" as one would scatter the words among the real
 * dates instead of keeping them together after them.
 */
function asDate(v: SortValue): number | null {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  const t = Date.parse(s.slice(0, 10))
  return Number.isNaN(t) ? null : t
}

function asNumber(v: SortValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Ascending comparison of two present values. Blanks are handled above this. */
function rank(a: SortValue, b: SortValue, kind: SortKind): number {
  if (kind === 'number') {
    const x = asNumber(a)
    const y = asNumber(b)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    return x - y
  }

  if (kind === 'date') {
    const x = asDate(a)
    const y = asDate(b)
    if (x !== null && y !== null) return x - y
    // A real date before a word, so the dated rows stay together at the top.
    if (x !== null) return -1
    if (y !== null) return 1
  }

  // numeric: true so B2 comes before B10, which is the whole reason a Ref
  // column is worth sorting.
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * The comparator for one column and one direction.
 *
 * It takes the direction itself rather than letting the caller negate the
 * result, because the blank rule must not be reversed along with everything
 * else.
 */
export function comparing<T>(
  keyOf: (row: T) => SortValue,
  kind: SortKind,
  dir: 1 | -1,
): (a: T, b: T) => number {
  return (a, b) => {
    const x = keyOf(a)
    const y = keyOf(b)
    const bx = blank(x)
    const by = blank(y)
    if (bx && by) return 0
    if (bx) return 1
    if (by) return -1
    return dir * rank(x, y, kind)
  }
}

/** The rows in the asked-for order, leaving the given array alone. */
export function sortRows<T>(
  rows: readonly T[],
  keyOf: (row: T) => SortValue,
  kind: SortKind,
  dir: 1 | -1,
): T[] {
  return [...rows].sort(comparing(keyOf, kind, dir))
}

/**
 * What clicking a heading does next.
 *
 * Ascending, then descending, then back to the order the page itself chose.
 * That third state is the point: every one of these lists arrives sorted the
 * way somebody thought about, and a table you can only ever leave sorted by a
 * column is a table that has thrown that away.
 */
export function nextOrder(current: Order | null, key: string): Order | null {
  if (!current || current.key !== key) return { key, dir: 1 }
  if (current.dir === 1) return { key, dir: -1 }
  return null
}
