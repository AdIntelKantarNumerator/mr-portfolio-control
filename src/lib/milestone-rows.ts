/**
 * The milestones on one entity, shaped for the editor.
 *
 * Dates are serialised on the way out: they cross into a client component,
 * where a Date would be turned into a string anyway, and doing it here keeps
 * the boundary visible instead of leaving a field whose type depends on which
 * side of the wire you read it from.
 */
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { milestones } from '@/db/schema'
import type { MilestoneRow } from '@/components/milestone-editor'

export async function milestoneRows(entityId: string): Promise<MilestoneRow[]> {
  const rows = await db
    .select()
    .from(milestones)
    .where(eq(milestones.entityId, entityId))
    .orderBy(asc(milestones.sortOrder), asc(milestones.name))

  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    details: m.details,
    status: m.status,
    targetLabel: m.targetLabel,
    targetDate: m.targetDate ? m.targetDate.toISOString() : null,
    dependencies: m.dependencies,
    contested: m.contested,
    editedFields: m.editedFields,
    editedBy: m.editedBy,
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    authoredBy: m.authoredBy,
  }))
}
