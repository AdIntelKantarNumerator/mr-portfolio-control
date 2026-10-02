'use server'

/**
 * Editing the Workflow Assessment map: components and the links between them.
 *
 * Every write is logged to Activity with the editor's name, the same as an
 * edit anywhere else in the app, because a map people consult to judge the
 * reach of a change is only trusted if "who drew that arrow" has an answer.
 *
 * Validation lives in lib/workflow-map.ts so it is testable; this file reads
 * the form, checks the caller, writes, logs and revalidates.
 */
import { revalidatePath } from 'next/cache'
import { and, eq, or } from 'drizzle-orm'
import { db } from '@/db/client'
import { workflowComponents, workflowGroups, workflowLinks } from '@/db/schema'
import { editor } from '@/lib/auth/editor'
import { logChange } from '@/lib/portfolio'
import { GROUP_KINDS, groupKeyFor, groupNameProblem, linkProblem, newGroupProblem, readComponentInput, removeGroupProblem } from '@/lib/workflow-map'

export interface ComponentState {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
  /** The id saved, so a freshly created component can be selected. */
  id?: string
  stamp?: number
}

export interface LinkState {
  ok?: boolean
  error?: string
}

function refresh() {
  revalidatePath('/workflow')
  revalidatePath('/changes')
}

const FIELD_LABEL: Record<string, string> = {
  name: 'name',
  kind: 'kind',
  groupKey: 'group',
  owner: 'owner',
  description: 'description',
  detail: 'detail line',
  aliases: 'aliases',
}

export async function saveComponent(_prev: ComponentState, formData: FormData): Promise<ComponentState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }

  const groups = await db.select({ key: workflowGroups.key }).from(workflowGroups)
  const parsed = readComponentInput(Object.fromEntries(formData), new Set(groups.map((g) => g.key)))
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors }
  const value = parsed.value

  const id = String(formData.get('id') ?? '').trim()
  if (!id) {
    const [row] = await db
      .insert(workflowComponents)
      .values({ ...value, createdBy: who.name, updatedBy: who.name })
      .returning({ id: workflowComponents.id })
    await logChange({
      actor: who.name,
      summary: `Workflow map: added ${value.name}`,
      detail: value.description,
      entityType: 'component',
      entityId: row!.id,
    })
    refresh()
    return { ok: true, id: row!.id, stamp: Date.now() }
  }

  const [before] = await db.select().from(workflowComponents).where(eq(workflowComponents.id, id)).limit(1)
  if (!before) return { error: 'That component no longer exists. Reload the page.' }

  const changed = (Object.keys(value) as (keyof typeof value)[]).filter((k) => (before[k] ?? null) !== (value[k] ?? null))
  if (!changed.length) return { ok: true, id, stamp: Date.now() }

  await db
    .update(workflowComponents)
    .set({ ...value, updatedBy: who.name, updatedAt: new Date() })
    .where(eq(workflowComponents.id, id))
  await logChange({
    actor: who.name,
    summary: `Workflow map: ${before.name} edited`,
    detail: `Changed ${changed.map((k) => FIELD_LABEL[k] ?? k).join(', ')}`,
    entityType: 'component',
    entityId: id,
  })
  refresh()
  return { ok: true, id, stamp: Date.now() }
}

/** Add a group. It appears on the map once something is put in it. */
export async function addGroup(rawName: string, rawKind: string): Promise<LinkState & { key?: string }> {
  const who = await editor()
  if (!who.ok) return { error: who.error }

  const name = rawName.replace(/\s+/g, ' ').trim()
  const kind = (GROUP_KINDS as readonly string[]).includes(rawKind) ? rawKind : 'software'
  const groups = await db.select().from(workflowGroups)
  const problem = newGroupProblem(name, groups)
  if (problem) return { error: problem }

  const key = groupKeyFor(name, groups.map((g) => g.key))
  // Last in the order. The map lays groups out from their connections, so
  // this only decides which goes first when two land in the same column.
  const sortOrder = groups.reduce((n, g) => Math.max(n, g.sortOrder), 0) + 1
  await db.insert(workflowGroups).values({ key, name, kind, sortOrder })
  await logChange({ actor: who.name, summary: `Workflow map: added group "${name}"`, entityType: 'workflow_group', entityId: key })
  refresh()
  return { ok: true, key }
}

/**
 * Remove a group, moving any components in it to another group first.
 * Both happen together or not at all, so no component is ever left
 * pointing at a group that is gone (the database refuses that anyway).
 */
export async function removeGroup(key: string, moveTo: string | null): Promise<LinkState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }

  const groups = await db.select({ key: workflowGroups.key, name: workflowGroups.name }).from(workflowGroups)
  const members = await db.select({ id: workflowComponents.id }).from(workflowComponents).where(eq(workflowComponents.groupKey, key))
  const problem = removeGroupProblem(key, moveTo, groups, members.length)
  if (problem) return { error: problem }

  const name = groups.find((g) => g.key === key)!.name
  const target = moveTo ? groups.find((g) => g.key === moveTo)?.name : null
  await db.transaction(async (tx) => {
    if (members.length && moveTo) {
      await tx.update(workflowComponents).set({ groupKey: moveTo, updatedBy: who.name, updatedAt: new Date() }).where(eq(workflowComponents.groupKey, key))
    }
    await tx.delete(workflowGroups).where(eq(workflowGroups.key, key))
  })
  await logChange({
    actor: who.name,
    summary: `Workflow map: removed group "${name}"`,
    detail: members.length ? `${members.length} component${members.length === 1 ? '' : 's'} moved to "${target}"` : null,
    entityType: 'workflow_group',
    entityId: key,
  })
  refresh()
  return { ok: true }
}

/** Put one component in a different group, without opening its editor. */
export async function moveComponent(id: string, groupKey: string): Promise<LinkState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }

  const [row] = await db.select().from(workflowComponents).where(eq(workflowComponents.id, id)).limit(1)
  if (!row) return { error: 'That component no longer exists. Reload the page.' }
  if (row.groupKey === groupKey) return { ok: true }
  const groups = await db.select({ key: workflowGroups.key, name: workflowGroups.name }).from(workflowGroups)
  const from = groups.find((g) => g.key === row.groupKey)?.name ?? row.groupKey
  const to = groups.find((g) => g.key === groupKey)?.name
  if (!to) return { error: 'That group no longer exists. Reload the page.' }

  await db.update(workflowComponents).set({ groupKey, updatedBy: who.name, updatedAt: new Date() }).where(eq(workflowComponents.id, id))
  await logChange({
    actor: who.name,
    summary: `Workflow map: moved ${row.name} from "${from}" to "${to}"`,
    entityType: 'component',
    entityId: id,
  })
  refresh()
  return { ok: true }
}

/** Rename a group. Its key, and so every component in it, stays the same. */
export async function renameGroup(key: string, rawName: string): Promise<LinkState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }

  const name = rawName.replace(/\s+/g, ' ').trim()
  const groups = await db.select({ key: workflowGroups.key, name: workflowGroups.name }).from(workflowGroups)
  const problem = groupNameProblem(name, key, groups)
  if (problem) return { error: problem }
  const before = groups.find((g) => g.key === key)!.name
  if (before === name) return { ok: true }

  await db.update(workflowGroups).set({ name }).where(eq(workflowGroups.key, key))
  await logChange({
    actor: who.name,
    summary: `Workflow map: group "${before}" renamed "${name}"`,
    entityType: 'workflow_group',
    entityId: key,
  })
  refresh()
  return { ok: true }
}

export async function deleteComponent(id: string): Promise<LinkState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }

  const [row] = await db.select().from(workflowComponents).where(eq(workflowComponents.id, id)).limit(1)
  if (!row) return { ok: true }
  const links = await db
    .select({ id: workflowLinks.id })
    .from(workflowLinks)
    .where(or(eq(workflowLinks.fromId, id), eq(workflowLinks.toId, id)))

  // Its links go with it (ON DELETE CASCADE). The log line says how many, so
  // a deletion that took a dozen arrows with it is visible as such.
  await db.delete(workflowComponents).where(eq(workflowComponents.id, id))
  await logChange({
    actor: who.name,
    summary: `Workflow map: removed ${row.name}`,
    detail: `${links.length} connection${links.length === 1 ? '' : 's'} removed with it`,
    entityType: 'component',
    entityId: id,
  })
  refresh()
  return { ok: true }
}

async function names(ids: string[]) {
  const rows = await db
    .select({ id: workflowComponents.id, name: workflowComponents.name })
    .from(workflowComponents)
    .where(or(...ids.map((i) => eq(workflowComponents.id, i))))
  return new Map(rows.map((r) => [r.id, r.name]))
}

export async function addLink(fromId: string, toId: string): Promise<LinkState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }

  const nameOf = await names([fromId, toId])
  const existing = await db
    .select({ from: workflowLinks.fromId, to: workflowLinks.toId })
    .from(workflowLinks)
    .where(and(eq(workflowLinks.fromId, fromId), eq(workflowLinks.toId, toId)))
  const problem = linkProblem(fromId, toId, existing, new Set(nameOf.keys()))
  if (problem) return { error: problem }

  await db.insert(workflowLinks).values({ fromId, toId, createdBy: who.name })
  await logChange({
    actor: who.name,
    summary: `Workflow map: ${nameOf.get(fromId)} now feeds ${nameOf.get(toId)}`,
    entityType: 'component',
    entityId: fromId,
  })
  refresh()
  return { ok: true }
}

export async function removeLink(fromId: string, toId: string): Promise<LinkState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }

  const nameOf = await names([fromId, toId])
  const gone = await db
    .delete(workflowLinks)
    .where(and(eq(workflowLinks.fromId, fromId), eq(workflowLinks.toId, toId)))
    .returning({ id: workflowLinks.id })
  if (!gone.length) return { ok: true }

  await logChange({
    actor: who.name,
    summary: `Workflow map: ${nameOf.get(fromId) ?? 'a component'} no longer feeds ${nameOf.get(toId) ?? 'a component'}`,
    entityType: 'component',
    entityId: fromId,
  })
  refresh()
  return { ok: true }
}
