/**
 * What a history entry changed, from and to.
 *
 * WHY THIS EXISTS (8 October 2026)
 *
 * A later meeting that changed a decision overwrote it. The 10/7 search rule
 * ("one entity if only one layer exists") was recorded as decided; on 10/8 it
 * became a formal blocker with no agreed end state, and the only options were
 * to leave the old decision saying the wrong thing or to file a new item next
 * to it. Neither kept the story: what it said before, what it says now, and
 * which meeting moved it. Each history entry now carries its changes, and the
 * entry's own meeting and time say where and when.
 *
 * Stored as JSON text rather than a column per field, because the fields that
 * can change differ between decisions and action items and will grow; the
 * history popup and Yaara both read it through `describeChange` so the two
 * cannot word the same change differently.
 */

export interface ItemChange {
  field: string
  from: string | null
  to: string | null
}

/** Long enough to recognise a body, short enough to keep a history readable. */
const KEEP = 600

const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, KEEP) : null
}

/**
 * The fields that differ between before and after, for the fields named.
 *
 * A field missing from `after` is not a change: callers send only what the
 * meeting said, and silence about the owner is not the owner being removed.
 */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): ItemChange[] {
  const out: ItemChange[] = []
  for (const field of fields) {
    if (!(field in after) || after[field] === undefined) continue
    const from = clean(before[field])
    const to = clean(after[field])
    if (to === null) continue
    if ((from ?? '').toLowerCase() === to.toLowerCase()) continue
    out.push({ field, from, to })
  }
  return out
}

export function encodeChanges(changes: readonly ItemChange[]): string | null {
  return changes.length ? JSON.stringify(changes) : null
}

/** Never throws: a history entry with a mangled column still shows its note. */
export function decodeChanges(raw: string | null | undefined): ItemChange[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((c) => c && typeof c.field === 'string').map((c) => ({ field: c.field, from: c.from ?? null, to: c.to ?? null }))
      : []
  } catch {
    return []
  }
}

const LABEL: Record<string, string> = {
  title: 'Title',
  text: 'Wording',
  body: 'Detail',
  status: 'Status',
  owner: 'Owner',
  dueDate: 'Due',
  dueBy: 'Due',
  nextAction: 'Next step',
}

/** One line per change, as the popup and Yaara both say it. */
export function describeChange(c: ItemChange): string {
  const label = LABEL[c.field] ?? c.field
  if (c.from === null) return `${label} set to "${c.to}"`
  return `${label}: "${c.from}" → "${c.to}"`
}
