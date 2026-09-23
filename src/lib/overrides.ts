/**
 * Database access for the override layer.
 *
 * The contract, in full:
 *
 *   - Sync only ever writes an entity's own columns. It never reads or
 *     respects overrides, which keeps sync code simple and idempotent.
 *   - Humans only ever write `field_overrides`. They never write the columns.
 *   - Every read merges the two through `applyOverrides`.
 *
 * The payoff is that a correction typed into this tool is never silently eaten
 * by the next sync, and both values stay visible — what the source says and
 * what the program team says — rather than one having quietly won.
 *
 * The merge rules themselves live in `merge.ts`, which imports nothing, so
 * they can be tested without a database.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { fieldOverrides } from '@/db/schema'
import type { EntityType } from './domain'
import { overrideKey, type OverrideMap, type OverrideRow } from './merge'

export {
  applyOverrides,
  applyOverridesAll,
  overrideSurvivesSourceChange,
  overrideKey,
} from './merge'
export type { OverrideMap, OverrideRow, Overridden } from './merge'

/** Fetch every active override for a set of entities, in one query. */
export async function loadOverrides(
  entityType: EntityType,
  entityIds: string[],
): Promise<OverrideMap> {
  const map: OverrideMap = new Map()
  if (entityIds.length === 0) return map

  const rows = await db
    .select()
    .from(fieldOverrides)
    .where(
      and(
        eq(fieldOverrides.entityType, entityType),
        inArray(fieldOverrides.entityId, entityIds),
        eq(fieldOverrides.active, true),
      ),
    )

  for (const row of rows) {
    const k = overrideKey(row.entityType, row.entityId)
    if (!map.has(k)) map.set(k, new Map())
    map.get(k)!.set(row.field, row as OverrideRow)
  }
  return map
}
