/**
 * Reading the Workflow Assessment map out of the database.
 *
 * The page needs everything at once — the layout depends on every link — and
 * the map is tens of boxes, so this is three unfiltered selects and no more.
 */
import { asc } from 'drizzle-orm'
import { db } from '@/db/client'
import { workflowComponents, workflowGroups, workflowLinks } from '@/db/schema'
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
}

export interface WorkflowLinkRow {
  id: string
  from: string
  to: string
}

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
      // Crosses into a client component, so it travels as a string.
      updatedAt: (c.updatedAt instanceof Date ? c.updatedAt : new Date(c.updatedAt)).toISOString(),
    })),
    links: links.map((l) => ({ id: l.id, from: l.fromId, to: l.toId })),
  }
}
