/**
 * The scoring read model.
 *
 * Intake and prioritization both need the same three facts — which model is
 * active, what it measures, and every score keyed by request — so they read
 * them from here rather than writing the same queries twice and drifting.
 * Cached per request like `getPortfolio()`.
 */
import { cache } from 'react'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { scores, scoringCriteria, scoringModels } from '@/db/schema'
import { computeScore, type CriterionInput } from './domain'

export type ScoringModelRow = typeof scoringModels.$inferSelect
export type CriterionRow = typeof scoringCriteria.$inferSelect

export interface ScoringContext {
  model: ScoringModelRow | null
  criteria: CriterionRow[]
  /** requestId → (criterionId → value). Absent keys mean "nobody has scored it". */
  valuesByRequest: Map<string, Record<string, number>>
}

export const getScoringContext = cache(async (): Promise<ScoringContext> => {
  const [model] = await db
    .select()
    .from(scoringModels)
    .where(eq(scoringModels.active, true))
    .limit(1)

  if (!model) return { model: null, criteria: [], valuesByRequest: new Map() }

  const [criteriaRows, scoreRows] = await Promise.all([
    db
      .select()
      .from(scoringCriteria)
      .where(eq(scoringCriteria.modelId, model.id))
      .orderBy(asc(scoringCriteria.sortOrder)),
    // Ordered so that when two people scored the same criterion the most
    // recent judgement is the one that lands. Averaging them would invent a
    // number nobody in the room actually holds.
    db.select().from(scores).where(eq(scores.modelId, model.id)).orderBy(asc(scores.updatedAt)),
  ])

  const valuesByRequest = new Map<string, Record<string, number>>()
  for (const s of scoreRows) {
    const bucket = valuesByRequest.get(s.requestId) ?? {}
    bucket[s.criterionId] = s.value
    valuesByRequest.set(s.requestId, bucket)
  }

  return { model, criteria: criteriaRows, valuesByRequest }
})

/** Narrow the criteria rows down to what `computeScore` actually reads. */
export function criterionInputs(criteria: CriterionRow[]): CriterionInput[] {
  return criteria.map((c) => ({
    id: c.id,
    key: c.key,
    weight: c.weight,
    direction: c.direction,
    scaleMin: c.scaleMin,
    scaleMax: c.scaleMax,
  }))
}

export function scoreForRequest(ctx: ScoringContext, requestId: string) {
  return computeScore(criterionInputs(ctx.criteria), ctx.valuesByRequest.get(requestId) ?? {})
}
