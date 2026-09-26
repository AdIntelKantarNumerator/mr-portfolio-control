/**
 * The one place that says what a sync may overwrite on a milestone.
 *
 * Three things write milestones: Linear's sync, the agent route that reads a
 * program review deck, and a person on the milestone editor. The first two
 * write the whole row on every run, which is correct for a row nobody has
 * touched and wrong the moment somebody corrects a date here — the correction
 * survives until the next sync and then silently reverts.
 *
 * So a human edit records WHICH fields it set, and a sync skips exactly
 * those. Correcting a date does not freeze the name; the sync keeps doing its
 * job on everything else, which is most of the row most of the time.
 *
 * Kept in its own module because the rule has to be identical in all three
 * writers, and the last time a rule like this lived in two places the two
 * copies disagreed within a month.
 */

/** Everything a person can set, and therefore everything a sync can be told to leave alone. */
export const MILESTONE_FIELDS = [
  'name',
  'details',
  'status',
  'targetLabel',
  'targetDate',
  'actualDate',
  'dependencies',
  'contested',
  'sortOrder',
] as const

export type MilestoneField = (typeof MILESTONE_FIELDS)[number]

export function isMilestoneField(v: string): v is MilestoneField {
  return (MILESTONE_FIELDS as readonly string[]).includes(v)
}

export function parseEditedFields(raw: string | null | undefined): Set<MilestoneField> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter(isMilestoneField),
  )
}

export function serialiseEditedFields(fields: Iterable<MilestoneField>): string | null {
  const list = [...new Set(fields)].sort()
  return list.length ? list.join(',') : null
}

/**
 * What a sync is allowed to write to a milestone somebody may have edited.
 *
 * Takes what the source wants to set and the row's `editedFields`, and
 * returns the subset that is still the source's to own. An empty result is a
 * real answer — a milestone whose every field was corrected by hand is a
 * milestone the sync has nothing left to say about — and the caller should
 * skip the update rather than writing `{}`.
 */
export function mergeFromSource<T extends Partial<Record<MilestoneField, unknown>>>(
  incoming: T,
  editedFields: string | null | undefined,
): Partial<T> {
  const locked = parseEditedFields(editedFields)
  if (locked.size === 0) return incoming
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(incoming)) {
    if (!isMilestoneField(k) || !locked.has(k)) (out as Record<string, unknown>)[k] = v
  }
  return out
}

/**
 * Which fields this edit actually changed, added to whatever was already
 * locked.
 *
 * Only genuine changes are recorded. Opening the editor, changing the date
 * and saving should lock the date — not the name, the status and everything
 * else that happened to be in the form and came back identical. Locking a
 * field nobody deliberately set is how a sync quietly stops working.
 */
export function lockedAfterEdit(
  before: Partial<Record<MilestoneField, unknown>>,
  after: Partial<Record<MilestoneField, unknown>>,
  alreadyLocked: string | null | undefined,
): { fields: string | null; changed: MilestoneField[] } {
  const locked = parseEditedFields(alreadyLocked)
  const changed: MilestoneField[] = []
  for (const f of MILESTONE_FIELDS) {
    if (!(f in after)) continue
    if (same(before[f], after[f])) continue
    changed.push(f)
    locked.add(f)
  }
  return { fields: serialiseEditedFields(locked), changed }
}

/** Dates compare by instant, everything else by value. */
function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : a == null ? null : new Date(String(a)).getTime()
    const tb = b instanceof Date ? b.getTime() : b == null ? null : new Date(String(b)).getTime()
    return ta === tb
  }
  if (a == null && b == null) return true
  return a === b
}
