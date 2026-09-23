/**
 * Pure merge logic for the override layer.
 *
 * Split from `overrides.ts` — which owns the database reads — so these rules
 * can be imported and tested without booting a database connection. Anything
 * here must stay free of I/O.
 */

export interface OverrideRow {
  entityType: string
  entityId: string
  field: string
  value: string
  reason: string | null
  pinned: boolean
  updatedAt: Date
}

export type OverrideMap = Map<string, Map<string, OverrideRow>>

export const overrideKey = (type: string, id: string) => `${type}:${id}`

export interface Overridden<T> {
  value: T
  /** Fields whose displayed value came from a human rather than the source. */
  overridden: Set<string>
  /** The original source value for each overridden field, kept for the UI. */
  sourceValues: Record<string, unknown>
  reasons: Record<string, string | null>
}

/**
 * Lay the manual values for one entity over its synced row.
 *
 * Dates are revived from their JSON strings so callers get real `Date` objects
 * regardless of which layer a value came from — the single most common source
 * of "works on the synced record, breaks on the edited one" bugs.
 */
export function applyOverrides<T extends Record<string, unknown>>(
  row: T,
  entityType: string,
  overrides: OverrideMap,
  dateFields: readonly (keyof T & string)[] = [],
): Overridden<T> {
  const entityId = row.id as string
  const forEntity = overrides.get(overrideKey(entityType, entityId))
  if (!forEntity || forEntity.size === 0) {
    return { value: row, overridden: new Set(), sourceValues: {}, reasons: {} }
  }

  const merged: Record<string, unknown> = { ...row }
  const overridden = new Set<string>()
  const sourceValues: Record<string, unknown> = {}
  const reasons: Record<string, string | null> = {}

  for (const [field, override] of forEntity) {
    if (!(field in row)) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(override.value)
    } catch {
      // A value written before JSON encoding, or by hand. Take it literally
      // rather than dropping the correction.
      parsed = override.value
    }
    if (parsed !== null && (dateFields as readonly string[]).includes(field)) {
      parsed = new Date(parsed as string)
    }
    sourceValues[field] = row[field]
    merged[field] = parsed
    overridden.add(field)
    reasons[field] = override.reason
  }

  return { value: merged as T, overridden, sourceValues, reasons }
}

export function applyOverridesAll<T extends Record<string, unknown>>(
  rows: T[],
  entityType: string,
  overrides: OverrideMap,
  dateFields: readonly (keyof T & string)[] = [],
): Overridden<T>[] {
  return rows.map((r) => applyOverrides(r, entityType, overrides, dateFields))
}

/**
 * Decide what happens to an override when the source value changes.
 *
 * Reconciliation rule, stated once here so sync and UI agree:
 *   - a pinned override always wins, until a human unpins it;
 *   - an unpinned override yields as soon as the source value itself moves,
 *     because a fresher upstream fact beats a stale local correction;
 *   - an unpinned override survives a sync that did not touch the field.
 */
export function overrideSurvivesSourceChange(
  override: { pinned: boolean },
  sourceChanged: boolean,
): boolean {
  return override.pinned || !sourceChanged
}
