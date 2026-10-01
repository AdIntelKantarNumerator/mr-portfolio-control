/**
 * Reading the Workflow Assessment map, and the questions asked of it, out of
 * the database.
 *
 * The page needs everything at once — the layout depends on every link — and
 * the map is tens of boxes, so this is a few unfiltered selects and no more.
 */
import { asc, desc } from 'drizzle-orm'
import { db } from '@/db/client'
import { workflowAssessments, workflowComponents, workflowGroups, workflowLinks } from '@/db/schema'
import { readAnswer, readRelied, type Answer, type AssessComponent, type AssessGroup, type AssessLink, type Relied } from './assessment'
import type { ComponentKind, GroupKind } from './workflow-map'

export interface WorkflowGroupRow {
  key: string
  name: string
  kind: GroupKind
  sortOrder: number
}

export interface WorkflowComponentRow {
  id: string
  name: string
  kind: ComponentKind
  groupKey: string
  owner: string | null
  description: string | null
  detail: string | null
  aliases: string | null
  isData: boolean
  updatedBy: string | null
  updatedAt: string
  createdAt: string
}

export interface WorkflowLinkRow {
  id: string
  from: string
  to: string
}

export interface AssessmentView {
  id: string
  question: string
  askedBy: string | null
  askedAt: string
  method: 'model' | 'keywords'
  model: string | null
  answer: Answer
  relied: Relied
}

// Everything that crosses into a client component travels as a string.
const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString()

export async function readWorkflowMap(): Promise<{
  groups: WorkflowGroupRow[]
  components: WorkflowComponentRow[]
  links: WorkflowLinkRow[]
}> {
  const [groups, components, links] = await Promise.all([
    db.select().from(workflowGroups).orderBy(asc(workflowGroups.sortOrder), asc(workflowGroups.name)),
    db.select().from(workflowComponents).orderBy(asc(workflowComponents.name)),
    db.select().from(workflowLinks),
  ])
  return {
    groups: groups.map((g) => ({ key: g.key, name: g.name, kind: g.kind as GroupKind, sortOrder: g.sortOrder })),
    components: components.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind as ComponentKind,
      groupKey: c.groupKey,
      owner: c.owner,
      description: c.description,
      detail: c.detail,
      aliases: c.aliases,
      isData: c.isData,
      updatedBy: c.updatedBy,
      updatedAt: iso(c.updatedAt),
      createdAt: iso(c.createdAt),
    })),
    links: links.map((l) => ({ id: l.id, from: l.fromId, to: l.toId })),
  }
}

/** The map in the shape the assessment reads: every component with its group's name. */
export async function readAssessmentInputs(): Promise<{
  components: AssessComponent[]
  links: AssessLink[]
  groups: AssessGroup[]
}> {
  const map = await readWorkflowMap()
  const groupName = new Map(map.groups.map((g) => [g.key, g.name]))
  return {
    components: map.components.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      groupKey: c.groupKey,
      groupName: groupName.get(c.groupKey) ?? c.groupKey,
      owner: c.owner,
      description: c.description,
      detail: c.detail,
      aliases: c.aliases,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
    })),
    links: map.links.map((l) => ({ from: l.from, to: l.to })),
    groups: map.groups.map((g) => ({ key: g.key, name: g.name })),
  }
}

export function toAssessmentView(row: typeof workflowAssessments.$inferSelect): AssessmentView {
  return {
    id: row.id,
    question: row.question,
    askedBy: row.askedBy,
    askedAt: iso(row.askedAt),
    method: row.method === 'model' ? 'model' : 'keywords',
    model: row.model,
    answer: readAnswer(row.answer),
    relied: readRelied(row.relied),
  }
}

/** The most recent questions anybody asked, newest first. */
export async function readAssessments(limit = 20): Promise<AssessmentView[]> {
  const rows = await db.select().from(workflowAssessments).orderBy(desc(workflowAssessments.askedAt)).limit(limit)
  return rows.map(toAssessmentView)
}
