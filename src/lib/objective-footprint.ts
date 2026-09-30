/**
 * Everything filed directly against one Strategic Objective.
 *
 * Nothing references an objective by foreign key except `initiatives`: the
 * rest of the schema attaches to any tier through an `(entityType, entityId)`
 * or `(level, entityId)` pair. So deleting an objective row leaves those rows
 * pointing at nothing unless they are named here. This list is the one place
 * that knows them; when a new table gains an entity pair, it belongs here too.
 */
import { and, count, eq } from 'drizzle-orm'
import { db, type Database } from '@/db/client'
import {
  actionItemLinks,
  agentObservations,
  assessments,
  briefs,
  conversationSources,
  dateObservations,
  decisions,
  entityThemes,
  fieldOverrides,
  groupingSuggestions,
  initiatives,
  milestones,
  sourceRecords,
  statusUpdates,
  transcripts,
} from '@/db/schema'
import type { RemovalCounts } from './objective-delete'

const OBJ = 'objective'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

async function n(q: Promise<{ n: number }[]>): Promise<number> {
  const [row] = await q
  return Number(row?.n ?? 0)
}

export async function objectiveFootprint(id: string): Promise<RemovalCounts & { initiatives: number }> {
  const [inits, ms, links, assess, obs, updates, sources, decs] = await Promise.all([
    n(db.select({ n: count() }).from(initiatives).where(eq(initiatives.objectiveId, id))),
    n(db.select({ n: count() }).from(milestones).where(and(eq(milestones.level, OBJ), eq(milestones.entityId, id)))),
    n(
      db
        .select({ n: count() })
        .from(actionItemLinks)
        .where(and(eq(actionItemLinks.level, OBJ), eq(actionItemLinks.entityId, id))),
    ),
    n(db.select({ n: count() }).from(assessments).where(and(eq(assessments.entityType, OBJ), eq(assessments.entityId, id)))),
    n(
      db
        .select({ n: count() })
        .from(agentObservations)
        .where(and(eq(agentObservations.entityType, OBJ), eq(agentObservations.entityId, id))),
    ),
    n(db.select({ n: count() }).from(statusUpdates).where(and(eq(statusUpdates.entityType, OBJ), eq(statusUpdates.entityId, id)))),
    n(
      db
        .select({ n: count() })
        .from(conversationSources)
        .where(and(eq(conversationSources.entityType, OBJ), eq(conversationSources.entityId, id))),
    ),
    n(db.select({ n: count() }).from(decisions).where(and(eq(decisions.entityType, OBJ), eq(decisions.entityId, id)))),
  ])
  return {
    initiatives: inits,
    milestones: ms,
    actionLinks: links,
    assessments: assess,
    observations: obs,
    updates,
    sources,
    decisions: decs,
  }
}

/**
 * Remove the objective's own records, inside the caller's transaction.
 *
 * Decisions and blockers are unfiled rather than deleted: the register is a
 * record of what was decided, with refs people quote in meetings ("D14"), and
 * an unfiled entry is a state the register already has. The changelog is
 * never touched, because it is how anyone finds out this objective existed.
 */
export async function removeObjectiveRecords(tx: Tx, id: string): Promise<void> {
  await tx.delete(milestones).where(and(eq(milestones.level, OBJ), eq(milestones.entityId, id)))
  await tx.delete(actionItemLinks).where(and(eq(actionItemLinks.level, OBJ), eq(actionItemLinks.entityId, id)))
  await tx.delete(assessments).where(and(eq(assessments.entityType, OBJ), eq(assessments.entityId, id)))
  await tx.delete(agentObservations).where(and(eq(agentObservations.entityType, OBJ), eq(agentObservations.entityId, id)))
  await tx.delete(statusUpdates).where(and(eq(statusUpdates.entityType, OBJ), eq(statusUpdates.entityId, id)))
  await tx.delete(fieldOverrides).where(and(eq(fieldOverrides.entityType, OBJ), eq(fieldOverrides.entityId, id)))
  await tx.delete(entityThemes).where(and(eq(entityThemes.entityType, OBJ), eq(entityThemes.entityId, id)))
  await tx.delete(sourceRecords).where(and(eq(sourceRecords.entityType, OBJ), eq(sourceRecords.entityId, id)))
  await tx.delete(transcripts).where(and(eq(transcripts.entityType, OBJ), eq(transcripts.entityId, id)))
  await tx.delete(conversationSources).where(and(eq(conversationSources.entityType, OBJ), eq(conversationSources.entityId, id)))
  await tx.delete(briefs).where(and(eq(briefs.entityType, OBJ), eq(briefs.entityId, id)))
  await tx.delete(dateObservations).where(and(eq(dateObservations.entityType, OBJ), eq(dateObservations.entityId, id)))
  await tx
    .update(decisions)
    .set({ entityType: null, entityId: null, updatedAt: new Date() })
    .where(and(eq(decisions.entityType, OBJ), eq(decisions.entityId, id)))
  // The suggestion keeps its history; it just no longer points at something gone.
  await tx.update(groupingSuggestions).set({ objectiveId: null }).where(eq(groupingSuggestions.objectiveId, id))
}
