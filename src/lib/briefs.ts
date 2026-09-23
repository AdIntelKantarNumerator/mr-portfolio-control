/**
 * Read model and write paths for conversation sources, transcripts and briefs.
 *
 * Kept out of portfolio.ts because the portfolio read model is on the hot path
 * for every page, and nothing here should slow that down.
 */
import { createHash } from 'node:crypto'
import { cache } from 'react'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { briefs, conversationSources, transcripts } from '@/db/schema'
import type { BriefItem } from './domain'
import { summariseTranscripts, type TranscriptForSummary } from './summarize'

export interface SourceRow {
  id: string
  kind: string
  entityType: string
  entityId: string
  label: string
  externalId: string | null
  url: string | null
  ingestEnabled: boolean
  addedBy: string | null
  notes: string | null
  lastIngestedAt: Date | null
}

export interface TranscriptRow {
  id: string
  sourceId: string | null
  entityType: string
  entityId: string
  kind: string
  title: string
  occurredAt: Date | null
  url: string | null
  ingestedBy: string | null
  createdAt: Date
  /** Character count rather than the body: lists never need the full text. */
  length: number
}

export interface BriefRow {
  id: string
  entityType: string
  entityId: string
  items: BriefItem[]
  model: string
  transcriptCount: number
  coversThrough: Date | null
  generatedBy: string | null
  createdAt: Date
  /**
   * Whether the newest conversation behind this brief is older than the same
   * three weeks the assessments treat as stale. Computed here rather than in
   * the component: reading the clock during render is exactly the kind of
   * impurity that makes a page render differently on two passes.
   */
  stale: boolean
}

const STALE_AFTER_MS = 21 * 864e5

const key = (type: string, id: string) => `${type}:${id}`

/** Every source, grouped by the entity it is attached to. */
export const getSources = cache(async (): Promise<Map<string, SourceRow[]>> => {
  const rows = await db
    .select()
    .from(conversationSources)
    .where(eq(conversationSources.active, true))
    .orderBy(conversationSources.label)

  const byEntity = new Map<string, SourceRow[]>()
  for (const r of rows) {
    const k = key(r.entityType, r.entityId)
    const list = byEntity.get(k) ?? []
    list.push({
      id: r.id,
      kind: r.kind,
      entityType: r.entityType,
      entityId: r.entityId,
      label: r.label,
      externalId: r.externalId,
      url: r.url,
      ingestEnabled: r.ingestEnabled,
      addedBy: r.addedBy,
      notes: r.notes,
      lastIngestedAt: r.lastIngestedAt,
    })
    byEntity.set(k, list)
  }
  return byEntity
})

export const getTranscripts = cache(async (): Promise<Map<string, TranscriptRow[]>> => {
  const rows = await db
    .select({
      id: transcripts.id,
      sourceId: transcripts.sourceId,
      entityType: transcripts.entityType,
      entityId: transcripts.entityId,
      kind: transcripts.kind,
      title: transcripts.title,
      occurredAt: transcripts.occurredAt,
      url: transcripts.url,
      ingestedBy: transcripts.ingestedBy,
      createdAt: transcripts.createdAt,
      body: transcripts.body,
    })
    .from(transcripts)
    .orderBy(desc(transcripts.occurredAt), desc(transcripts.createdAt))

  const byEntity = new Map<string, TranscriptRow[]>()
  for (const r of rows) {
    const k = key(r.entityType, r.entityId)
    const list = byEntity.get(k) ?? []
    const { body, ...rest } = r
    list.push({ ...rest, length: body.length })
    byEntity.set(k, list)
  }
  return byEntity
})

/** The current brief per entity — superseded ones stay in the table. */
export const getBriefs = cache(async (): Promise<Map<string, BriefRow>> => {
  const rows = await db
    .select()
    .from(briefs)
    .where(isNull(briefs.supersededAt))
    .orderBy(desc(briefs.createdAt))

  const byEntity = new Map<string, BriefRow>()
  for (const r of rows) {
    const k = key(r.entityType, r.entityId)
    // Newest first, so the first one seen for an entity is the current one.
    if (byEntity.has(k)) continue
    let items: BriefItem[] = []
    try {
      items = JSON.parse(r.items) as BriefItem[]
    } catch {
      items = []
    }
    byEntity.set(k, {
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      items,
      model: r.model,
      transcriptCount: r.transcriptCount,
      coversThrough: r.coversThrough,
      generatedBy: r.generatedBy,
      createdAt: r.createdAt,
      stale: r.coversThrough
        ? Date.now() - r.coversThrough.getTime() > STALE_AFTER_MS
        : false,
    })
  }
  return byEntity
})

export function fingerprint(entityType: string, entityId: string, body: string): string {
  return createHash('sha256').update(`${entityType}:${entityId}:${body}`).digest('hex')
}

/**
 * Generates a brief for one entity from everything ingested against it, and
 * supersedes the previous one.
 *
 * Returns the warnings rather than swallowing them: a brief built from
 * truncated material is still useful, but the reader deserves to know.
 */
export async function generateBrief(
  entityType: string,
  entityId: string,
  actor: string,
): Promise<{ briefId: string; itemCount: number; warnings: string[] }> {
  const rows = await db
    .select()
    .from(transcripts)
    .where(and(eq(transcripts.entityType, entityType), eq(transcripts.entityId, entityId)))
    .orderBy(desc(transcripts.occurredAt))

  if (rows.length === 0) {
    throw new Error('Nothing has been ingested against this yet, so there is nothing to summarise.')
  }

  const forSummary: TranscriptForSummary[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    occurredAt: r.occurredAt,
    body: r.body,
  }))

  const result = await summariseTranscripts(forSummary)

  const coversThrough = rows
    .map((r) => r.occurredAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null

  await db
    .update(briefs)
    .set({ supersededAt: new Date() })
    .where(
      and(
        eq(briefs.entityType, entityType),
        eq(briefs.entityId, entityId),
        isNull(briefs.supersededAt),
      ),
    )

  const [created] = await db
    .insert(briefs)
    .values({
      entityType,
      entityId,
      items: JSON.stringify(result.items),
      model: result.model,
      transcriptCount: result.used.length,
      coversThrough,
      generatedBy: actor,
    })
    .returning({ id: briefs.id })

  return { briefId: created.id, itemCount: result.items.length, warnings: result.warnings }
}
