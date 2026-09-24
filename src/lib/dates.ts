/**
 * Date drift: what a date was when we first saw it, and what it is now.
 *
 * The comparison people actually ask for is "original commitment vs where we
 * are", and the honest version of "original" is the first date this system ever
 * observed — which is not the same as the first date anybody promised, and
 * should never be presented as though it were. `firstObservedAt` is returned so
 * a view can say "as of 14 March" rather than implying it goes back further.
 */
import { cache } from 'react'
import { asc } from 'drizzle-orm'
import { db } from '@/db/client'
import { dateObservations } from '@/db/schema'

export interface DriftRow {
  entityType: string
  entityId: string
  field: string
  original: Date | null
  current: Date | null
  /** Positive means later than first recorded — the direction people care about. */
  daysMoved: number
  /** How many times it has moved. Three small slips read differently from one big one. */
  moves: number
  firstObservedAt: Date
  lastObservedAt: Date
}

const KEY = (t: string, i: string, f: string) => `${t}:${i}:${f}`

export const getDateDrift = cache(async (): Promise<Map<string, DriftRow>> => {
  const rows = await db.select().from(dateObservations).orderBy(asc(dateObservations.observedAt))

  const out = new Map<string, DriftRow>()
  for (const r of rows) {
    const key = KEY(r.entityType, r.entityId, r.field)
    const existing = out.get(key)

    if (!existing) {
      out.set(key, {
        entityType: r.entityType,
        entityId: r.entityId,
        field: r.field,
        original: r.value,
        current: r.value,
        daysMoved: 0,
        moves: 0,
        firstObservedAt: r.observedAt,
        lastObservedAt: r.observedAt,
      })
      continue
    }

    existing.current = r.value
    existing.lastObservedAt = r.observedAt
    // The first row is the baseline, not a move. Every row after it is one.
    existing.moves += 1
    existing.daysMoved =
      existing.original && r.value
        ? Math.round((r.value.getTime() - existing.original.getTime()) / 86_400_000)
        : 0
  }

  return out
})

export function driftFor(drift: Map<string, DriftRow>, entityType: string, entityId: string) {
  return drift.get(KEY(entityType, entityId, 'target_date')) ?? null
}
