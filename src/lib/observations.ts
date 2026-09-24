/**
 * Read model for what Yaara (or any agent) has observed.
 *
 * Two jobs. One is the obvious one: load the newest observation per entity so a
 * page can render it. The other is the one that matters — every row that comes
 * out of here carries who wrote it and whether a person has since stood behind
 * it, so no caller can render a machine's judgement without knowing it is one.
 */
import { cache } from 'react'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { agentObservations, assessments, people } from '@/db/schema'

export interface ObservationItem {
  kind: string
  audience: 'engineering' | 'stakeholder'
  text: string
  citations: string[]
}

export interface ObservationEvidence {
  id: string
  source: string
  title: string
  url: string | null
  occurredAt: string | null
}

export interface ObservationRow {
  id: string
  entityType: string
  entityId: string
  agent: string
  items: ObservationItem[]
  evidence: ObservationEvidence[]
  model: string
  servedBy: string | null
  generatedAt: Date
  /** Hours since it was written — staleness computed here, never during render. */
  ageHours: number
}

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const KEY = (t: string, i: string) => `${t}:${i}`

/** Newest live observation per entity, keyed `type:id`. */
export const getObservations = cache(async (): Promise<Map<string, ObservationRow>> => {
  const rows = await db
    .select()
    .from(agentObservations)
    .where(isNull(agentObservations.supersededAt))
    .orderBy(desc(agentObservations.generatedAt))

  const now = Date.now()
  const out = new Map<string, ObservationRow>()
  for (const r of rows) {
    const key = KEY(r.entityType, r.entityId)
    if (out.has(key)) continue // ordered newest first
    out.set(key, {
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      agent: r.agent,
      items: parse<ObservationItem[]>(r.items, []),
      evidence: parse<ObservationEvidence[]>(r.evidence, []),
      model: r.model,
      servedBy: r.servedBy,
      generatedAt: r.generatedAt,
      ageHours: Math.round((now - r.generatedAt.getTime()) / 3_600_000),
    })
  }
  return out
})

export interface AgentAssessmentRow {
  id: string
  entityType: string
  entityId: string
  rag: string
  confidence: string
  rationale: string
  asOf: Date
  authoredBy: string
  reviewedBy: string | null
  reviewerName: string | null
  reviewedAt: Date | null
}

/**
 * Current assessments that an agent wrote, keyed `type:id`.
 *
 * Separate from the portfolio read model on purpose: a caller has to ask for
 * these by name, which makes it hard to accidentally blend a machine's rating
 * into a list of people's ratings.
 */
export const getAgentAssessments = cache(async (): Promise<Map<string, AgentAssessmentRow>> => {
  const rows = await db
    .select({
      id: assessments.id,
      entityType: assessments.entityType,
      entityId: assessments.entityId,
      rag: assessments.rag,
      confidence: assessments.confidence,
      rationale: assessments.rationale,
      asOf: assessments.asOf,
      authoredBy: assessments.authoredBy,
      reviewedBy: assessments.reviewedBy,
      reviewedAt: assessments.reviewedAt,
      reviewerName: people.name,
    })
    .from(assessments)
    .leftJoin(people, eq(assessments.reviewedBy, people.id))
    .where(eq(assessments.current, true))
    .orderBy(desc(assessments.asOf))

  const out = new Map<string, AgentAssessmentRow>()
  for (const r of rows) {
    if (r.authoredBy === 'human') continue
    const key = KEY(r.entityType, r.entityId)
    if (out.has(key)) continue
    out.set(key, { ...r, reviewerName: r.reviewerName ?? null })
  }
  return out
})

/**
 * Record that a person has read a machine-written assessment and stands behind
 * it. Reviewing does not change the rating — if someone disagrees with it they
 * enter their own assessment, which is a different act and reads differently.
 */
export async function markAssessmentReviewed(assessmentId: string, personId: string) {
  await db
    .update(assessments)
    .set({ reviewedBy: personId, reviewedAt: new Date() })
    .where(and(eq(assessments.id, assessmentId), eq(assessments.current, true)))
}
