'use server'

/**
 * Filing a register entry against the work you are looking at.
 *
 * WHY THIS IS ON THE DETAIL PAGE AND NOT ONLY ON THE REGISTER PAGES
 *
 * Almost everything in these four registers was written by Yaara out of a
 * meeting she read, and everything a person could do was correct what she
 * wrote. But a blocker somebody hits on a Tuesday, a decision taken in a
 * corridor, an action agreed on a call she does not have the notes for — none
 * of those existed until she happened to read about them, and the place
 * somebody knows about one is the page for the work it concerns.
 *
 * Each function takes the entity as the page knows it, so nothing has to be
 * picked from a list of three hundred to record something about the thing
 * already on screen.
 */
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { actionItemLinks, actionItems, decisions, dependencies, initiatives, projects, workstreams } from '@/db/schema'
import { actorName } from '@/lib/auth/current-user'
import { logChange } from '@/lib/portfolio'

export interface RegisterState {
  ok?: boolean
  error?: string
  message?: string
  stamp?: number
}

const LEVELS = { initiative: initiatives, project: projects, workstream: workstreams } as const
type Level = keyof typeof LEVELS
const isLevel = (v: string): v is Level => v === 'initiative' || v === 'project' || v === 'workstream'

function refresh(level: string, id: string) {
  try {
    revalidatePath('/')
    revalidatePath(`/${level}s/${id}`)
    revalidatePath('/blockers')
    revalidatePath('/actions')
    revalidatePath('/dependencies')
    revalidatePath('/changes')
  } catch (err) {
    // Needs a request context; the check scripts have none. Same guard, and
    // the same reasoning, as initiatives/actions.ts.
    if (!(err instanceof Error) || !/static generation store/i.test(err.message)) throw err
  }
}

/** A handle people can say out loud. Collisions resolve by suffix, never by failing. */
async function nextRef(prefix: string): Promise<string> {
  const rows = await db.select({ ref: decisions.ref }).from(decisions)
  const used = new Set(rows.map((r) => r.ref))
  for (let n = 1; n < 10_000; n++) {
    const ref = `${prefix}${n}`
    if (!used.has(ref)) return ref
  }
  return `${prefix}-${Date.now()}`
}

async function entityExists(level: Level, id: string): Promise<boolean> {
  const table = LEVELS[level]
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1)
  return Boolean(row)
}

/**
 * A blocker or a decision. One function because they are one table and one
 * shape — what differs is which word the page used, and which prefix the
 * reference gets.
 */
export async function addRegisterEntry(input: {
  kind: 'blocker' | 'decision'
  level: string
  entityId: string
  title: string
  body: string
  ownerId?: string | null
  dueBy?: string | null
}): Promise<RegisterState> {
  if (!isLevel(input.level)) return { error: 'Unknown kind of record.' }
  if (!(await entityExists(input.level, input.entityId))) return { error: 'That record no longer exists — reload the page.' }

  const title = input.title.trim()
  const body = input.body.trim()
  if (title.length < 3) return { error: input.kind === 'blocker' ? 'Say what is blocked.' : 'Say what has to be decided.' }
  // The body is what somebody reads in three weeks when the title has stopped
  // meaning anything to them.
  if (body.length < 3) return { error: 'Say a little more — one line is what makes this readable later.' }

  const ref = await nextRef(input.kind === 'blocker' ? 'B' : 'D')
  const who = await actorName()
  await db.insert(decisions).values({
    ref,
    kind: input.kind,
    category: 'delivery',
    title,
    body,
    status: 'open',
    ownerId: input.ownerId || null,
    dueBy: input.dueBy?.trim() || null,
    entityType: input.level,
    entityId: input.entityId,
    raisedAt: new Date(),
    raisedByText: who,
  })

  await logChange({
    actor: who,
    kind: 'change',
    summary: `${ref}: ${input.kind} raised — ${title.slice(0, 80)}`,
    detail: body.slice(0, 400),
    entityType: input.level,
    entityId: input.entityId,
  })

  refresh(input.level, input.entityId)
  return { ok: true, stamp: Date.now(), message: `Raised as ${ref}.` }
}

/** An action item, filed against the work it came up on. */
export async function addActionItem(input: {
  level: string
  entityId: string
  text: string
  ownerId?: string | null
  dueDate?: string | null
}): Promise<RegisterState> {
  if (!isLevel(input.level)) return { error: 'Unknown kind of record.' }
  if (!(await entityExists(input.level, input.entityId))) return { error: 'That record no longer exists — reload the page.' }

  const text = input.text.trim()
  if (text.length < 3) return { error: 'Say what somebody is going to do.' }

  let due: Date | null = null
  if (input.dueDate?.trim()) {
    due = new Date(`${input.dueDate.trim()}T00:00:00Z`)
    if (Number.isNaN(due.getTime())) return { error: 'That is not a date.' }
  }

  const existing = await db.select({ ref: actionItems.ref }).from(actionItems)
  const used = new Set(existing.map((r) => r.ref).filter(Boolean) as string[])
  let ref = `AI-${used.size + 1}`
  for (let n = used.size + 1; used.has(ref) && n < 100_000; n++) ref = `AI-${n}`

  const who = await actorName()
  const [created] = await db
    .insert(actionItems)
    .values({
      ref,
      text,
      status: 'open',
      ownerId: input.ownerId || null,
      dueDate: due,
      sourceTitle: `Added on the ${input.level} page`,
      authoredBy: who,
    })
    .returning({ id: actionItems.id })

  await db.insert(actionItemLinks).values({ actionItemId: created.id, level: input.level, entityId: input.entityId })

  await logChange({
    actor: who,
    kind: 'change',
    summary: `${ref}: action item added — ${text.slice(0, 80)}`,
    entityType: input.level,
    entityId: input.entityId,
  })

  refresh(input.level, input.entityId)
  return { ok: true, stamp: Date.now(), message: `Added as ${ref}.` }
}

/**
 * A dependency, with this page's work at one end.
 *
 * `direction` says which end: "delivering" when this work is what has to land,
 * "waiting" when it is what cannot move until something else does. Both are
 * things people file from here, and guessing would put half of them backwards.
 */
export async function addDependency(input: {
  level: string
  entityId: string
  direction: 'delivering' | 'waiting'
  other: string
  requiredBy?: string | null
  criticality?: string
  description?: string | null
}): Promise<RegisterState> {
  if (!isLevel(input.level)) return { error: 'Unknown kind of record.' }
  if (!(await entityExists(input.level, input.entityId))) return { error: 'That record no longer exists — reload the page.' }

  const [otherType, ...rest] = input.other.split(':')
  const otherId = rest.join(':')
  if (!otherType || !otherId) return { error: 'Pick what this depends on.' }
  if (otherType === input.level && otherId === input.entityId) return { error: 'Something cannot depend on itself.' }

  let due: Date | null = null
  if (input.requiredBy?.trim()) {
    due = new Date(`${input.requiredBy.trim()}T00:00:00Z`)
    if (Number.isNaN(due.getTime())) return { error: 'That is not a date.' }
  }

  const here = { type: input.level, id: input.entityId }
  const there = { type: otherType, id: otherId }
  const from = input.direction === 'delivering' ? here : there
  const to = input.direction === 'delivering' ? there : here

  await db.insert(dependencies).values({
    fromType: from.type,
    fromId: from.id,
    toType: to.type,
    toId: to.id,
    kind: 'blocks',
    status: 'open',
    criticality: ['normal', 'high', 'critical'].includes(input.criticality ?? '') ? input.criticality! : 'normal',
    description: input.description?.trim() || null,
    dueDate: due,
  })

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: 'Dependency added',
    detail: input.description?.trim() || null,
    entityType: input.level,
    entityId: input.entityId,
  })

  refresh(input.level, input.entityId)
  return { ok: true, stamp: Date.now(), message: 'Recorded.' }
}
