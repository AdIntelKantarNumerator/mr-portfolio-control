/**
 * The "Reassess now" queue: requests from the home page, collected by Yaara.
 * The rules are in reassess-rules.ts; this is the database half.
 */
import { and, asc, desc, eq, lt } from 'drizzle-orm'
import { db } from '@/db/client'
import { reassessRequests } from '@/db/schema'
import { KEEP_FOR_MS, stillGoing, UNCLAIMED_AFTER_MS, type Level } from './reassess-rules'

export type ReassessRow = typeof reassessRequests.$inferSelect

/**
 * Queue a reassessment, or join the one already going for the same item.
 * Returns the request's id either way.
 */
export async function requestReassessment(level: Level, entityId: string, requestedBy: string): Promise<{ id: string; joined: boolean }> {
  // Housekeeping on the way in, the way the chat relay does it: nothing reads
  // a request once its card has refreshed.
  await db.delete(reassessRequests).where(lt(reassessRequests.requestedAt, new Date(Date.now() - KEEP_FOR_MS)))

  const [latest] = await db
    .select()
    .from(reassessRequests)
    .where(and(eq(reassessRequests.entityType, level), eq(reassessRequests.entityId, entityId)))
    .orderBy(desc(reassessRequests.requestedAt))
    .limit(1)
  if (latest && stillGoing(latest)) return { id: latest.id, joined: true }

  const [row] = await db
    .insert(reassessRequests)
    .values({ entityType: level, entityId, requestedBy })
    .returning({ id: reassessRequests.id })
  return { id: row!.id, joined: false }
}

export interface ClaimedReassessment {
  id: string
  entityType: string
  entityId: string
  requestedBy: string
}

async function claimOne(): Promise<ClaimedReassessment | null> {
  const fresh = new Date(Date.now() - UNCLAIMED_AFTER_MS)
  const waiting = await db
    .select()
    .from(reassessRequests)
    .where(eq(reassessRequests.status, 'queued'))
    .orderBy(asc(reassessRequests.requestedAt))
    .limit(5)
  for (const next of waiting) {
    // The person has already been told it was not picked up; doing it now
    // would change their card long after they stopped watching.
    if (next.requestedAt < fresh) {
      await db
        .update(reassessRequests)
        .set({ status: 'failed', error: 'Not collected in time.', finishedAt: new Date() })
        .where(and(eq(reassessRequests.id, next.id), eq(reassessRequests.status, 'queued')))
      continue
    }
    const [row] = await db
      .update(reassessRequests)
      .set({ status: 'working', claimedAt: new Date() })
      .where(and(eq(reassessRequests.id, next.id), eq(reassessRequests.status, 'queued')))
      .returning()
    if (row) return { id: row.id, entityType: row.entityType, entityId: row.entityId, requestedBy: row.requestedBy }
    // Claimed by someone else between the read and the update. Try the next.
  }
  return null
}

/** The oldest waiting request, waiting up to `ms` for one to arrive. */
export async function claimNextReassessment(ms: number, signal?: AbortSignal): Promise<ClaimedReassessment | null> {
  const deadline = Date.now() + ms
  for (;;) {
    const claimed = await claimOne()
    if (claimed) return claimed
    const left = deadline - Date.now()
    if (left <= 0 || signal?.aborted) return null
    // A short sleep rather than an event bus: requests are rare (a person
    // clicking a button), and a second of latency on one is invisible.
    await new Promise((r) => setTimeout(r, Math.min(left, 1_000)))
  }
}

export async function finishReassessment(id: string, outcome: { note: string | null } | { error: string }): Promise<boolean> {
  const set =
    'error' in outcome
      ? { status: 'failed', error: outcome.error.slice(0, 500), finishedAt: new Date() }
      : { status: 'done', note: outcome.note?.slice(0, 500) ?? null, finishedAt: new Date() }
  const rows = await db
    .update(reassessRequests)
    .set(set)
    .where(and(eq(reassessRequests.id, id), eq(reassessRequests.status, 'working')))
    .returning({ id: reassessRequests.id })
  return rows.length > 0
}

export async function readReassessment(id: string): Promise<ReassessRow | null> {
  const [row] = await db.select().from(reassessRequests).where(eq(reassessRequests.id, id))
  return row ?? null
}
