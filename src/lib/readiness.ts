/**
 * The readiness read model.
 *
 * The program team documented its lifecycle once, on an internal site, where it
 * is true but unenforceable. This module turns that document into a thing with
 * a numerator and a denominator, so "did we actually do the kick-off steps" has
 * an answer per project instead of a shrug.
 *
 * Cached per request like `getPortfolio()` — the matrix screen reads the whole
 * model once and scores every cell against it in memory.
 */
import { cache } from 'react'
import { asc } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  discoveryTopics,
  lifecycleGates,
  projectReadiness,
  readinessItems,
  templates,
} from '@/db/schema'

export type GateRow = typeof lifecycleGates.$inferSelect
export type ReadinessItem = typeof readinessItems.$inferSelect
export type ProjectReadinessRow = typeof projectReadiness.$inferSelect
export type TemplateRow = typeof templates.$inferSelect
export type DiscoveryTopicRow = typeof discoveryTopics.$inferSelect

export interface GateView extends GateRow {
  items: ReadinessItem[]
}

// ---------------------------------------------------------------------------
// Vocabulary
//
// These live here rather than in domain.ts because they describe this feature's
// own lifecycle, not the portfolio-wide vocabulary every other view shares.
// ---------------------------------------------------------------------------

export const READINESS_STATUS = ['not_started', 'in_progress', 'done', 'na'] as const
export type ReadinessStatus = (typeof READINESS_STATUS)[number]

export const READINESS_STATUS_LABEL: Record<ReadinessStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  na: 'N/A',
}

export const PHASE_LABEL: Record<string, string> = {
  pre_approval: 'Pre-approval',
  discovery: 'Discovery',
  alignment: 'Alignment',
  ongoing: 'Ongoing',
}

export const WORKSTREAM_LABEL: Record<string, string> = {
  ingestion: 'Data Ingestion',
  spend_methodology: 'Spend Methodology',
  classification: 'Attribution / Classification',
  user_experience: 'User Experience',
  launch: 'Launch Planning',
  gtm: 'Go To Market',
}

/** Order the question bank is read in — ingestion first, GTM last. */
export const WORKSTREAM_ORDER = [
  'ingestion',
  'spend_methodology',
  'classification',
  'user_experience',
  'launch',
  'gtm',
] as const

export function isReadinessStatus(v: string): v is ReadinessStatus {
  return (READINESS_STATUS as readonly string[]).includes(v)
}

export function readinessStatusLabel(v: string): string {
  return isReadinessStatus(v) ? READINESS_STATUS_LABEL[v] : v
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export interface ReadinessModel {
  gates: GateView[]
  /** Every item, in gate then sort order — the column order of the matrix. */
  items: ReadinessItem[]
  itemsById: Map<string, ReadinessItem>
  gatesByItemId: Map<string, GateRow>
  /** projectId → itemId → stored row. An absent entry means `not_started`. */
  byProject: Map<string, Map<string, ProjectReadinessRow>>
}

export const getReadiness = cache(async (): Promise<ReadinessModel> => {
  const [gateRows, itemRows, progressRows] = await Promise.all([
    db.select().from(lifecycleGates).orderBy(asc(lifecycleGates.sortOrder)),
    db.select().from(readinessItems).orderBy(asc(readinessItems.sortOrder)),
    db.select().from(projectReadiness),
  ])

  const itemsByGate = new Map<string, ReadinessItem[]>()
  for (const item of itemRows) {
    if (!itemsByGate.has(item.gateId)) itemsByGate.set(item.gateId, [])
    itemsByGate.get(item.gateId)!.push(item)
  }

  const gates: GateView[] = gateRows.map((g) => ({ ...g, items: itemsByGate.get(g.id) ?? [] }))

  const gatesById = new Map(gateRows.map((g) => [g.id, g]))
  const gatesByItemId = new Map<string, GateRow>()
  for (const item of itemRows) {
    const g = gatesById.get(item.gateId)
    if (g) gatesByItemId.set(item.id, g)
  }

  const byProject = new Map<string, Map<string, ProjectReadinessRow>>()
  for (const row of progressRows) {
    if (!byProject.has(row.projectId)) byProject.set(row.projectId, new Map())
    byProject.get(row.projectId)!.set(row.itemId, row)
  }

  // The gate order is the process order, so items come back column-ordered.
  const items = gates.flatMap((g) => g.items)

  return { gates, items, itemsById: new Map(itemRows.map((i) => [i.id, i])), gatesByItemId, byProject }
})

export function statusFor(
  model: ReadinessModel,
  projectId: string,
  itemId: string,
): ReadinessStatus {
  const raw = model.byProject.get(projectId)?.get(itemId)?.status
  return raw && isReadinessStatus(raw) ? raw : 'not_started'
}

export function progressFor(
  model: ReadinessModel,
  projectId: string,
  itemId: string,
): ProjectReadinessRow | null {
  return model.byProject.get(projectId)?.get(itemId) ?? null
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ReadinessScore {
  done: number
  total: number
  /** Whole percent, 0..100. `total === 0` scores as 100 — nothing is owed. */
  pct: number
  missingRequired: ReadinessItem[]
}

/**
 * Score a project against a set of items.
 *
 * Only required items count, and `na` counts as satisfied: someone deciding an
 * item does not apply to this project is a completed act of judgement, not an
 * outstanding obligation. Counting it as a gap would teach people to mark
 * things done instead of marking them N/A, which is how a checklist stops
 * telling the truth.
 */
export function scoreItems(
  model: ReadinessModel,
  projectId: string,
  items: ReadinessItem[],
): ReadinessScore {
  const required = items.filter((i) => i.required)
  const missingRequired: ReadinessItem[] = []
  let done = 0

  for (const item of required) {
    const status = statusFor(model, projectId, item.id)
    if (status === 'done' || status === 'na') done += 1
    else missingRequired.push(item)
  }

  const total = required.length
  return { done, total, pct: total === 0 ? 100 : Math.round((done / total) * 100), missingRequired }
}

/**
 * Readiness for one project across the whole lifecycle.
 *
 * Async so callers that only need one project do not have to hold the model;
 * `getReadiness()` is request-cached, so this stays one set of queries however
 * many times it is called.
 */
export async function readinessScore(projectId: string): Promise<ReadinessScore> {
  const model = await getReadiness()
  return scoreItems(model, projectId, model.items)
}

// ---------------------------------------------------------------------------
// Aggregation — the reason the screen exists
// ---------------------------------------------------------------------------

/** The minimum a project has to look like to be counted in the gaps roll-up. */
export interface ScorableProject {
  id: string
  key: string
  name: string
  status: string
}

/** Planned and in-progress work. Finished or abandoned projects owe nothing. */
export const ACTIVE_PROJECT_STATUS = ['in_progress', 'planned'] as const

export function isActive(p: { status: string }): boolean {
  return (ACTIVE_PROJECT_STATUS as readonly string[]).includes(p.status)
}

export interface ItemGap {
  item: ReadinessItem
  gate: GateRow | null
  /** Active projects that have not satisfied this item, in portfolio order. */
  projects: ScorableProject[]
}

/**
 * Required items rolled up by item rather than by project.
 *
 * Per project, a missing RACI is a small nag. Across the portfolio, "six active
 * projects have no Program Review slide" is a process failure with one owner
 * and one fix — and it is invisible unless something counts it this way round.
 */
export function gapsByItem(model: ReadinessModel, projects: ScorableProject[]): ItemGap[] {
  const active = projects.filter(isActive)

  return model.items
    .filter((item) => item.required)
    .map((item) => ({
      item,
      gate: model.gatesByItemId.get(item.id) ?? null,
      projects: active.filter((p) => {
        const status = statusFor(model, p.id, item.id)
        return status !== 'done' && status !== 'na'
      }),
    }))
    .filter((g) => g.projects.length > 0)
    .sort((a, b) => b.projects.length - a.projects.length)
}

// ---------------------------------------------------------------------------
// The template library and the question bank
// ---------------------------------------------------------------------------

export const getTemplates = cache(
  async (): Promise<TemplateRow[]> =>
    db.select().from(templates).orderBy(asc(templates.sortOrder), asc(templates.name)),
)

export const getDiscoveryTopics = cache(async (): Promise<Map<string, DiscoveryTopicRow[]>> => {
  const rows = await db.select().from(discoveryTopics).orderBy(asc(discoveryTopics.sortOrder))
  const byWorkstream = new Map<string, DiscoveryTopicRow[]>()
  for (const r of rows) {
    if (!byWorkstream.has(r.workstream)) byWorkstream.set(r.workstream, [])
    byWorkstream.get(r.workstream)!.push(r)
  }
  return byWorkstream
})
