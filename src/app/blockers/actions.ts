'use server'

/**
 * Filing a blocker by hand, and moving one.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE DECISIONS REGISTER
 *
 * Almost every blocker in this system was written by Yaara out of a meeting
 * she read, and everything a person could do to one was resolve it or reopen
 * it. But a blocker somebody hits on a Tuesday is not always discussed in a
 * meeting she has the notes for, and until now the only way to record it was
 * to wait until it was — by which time it was a fortnight old.
 *
 * `decisions` carries both kinds; nothing here changes that. What is new is
 * that the page can write to it.
 */
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { decisions, initiatives, projects, workstreams } from '@/db/schema'
import { actorName } from '@/lib/auth/current-user'
import { logChange } from '@/lib/portfolio'

export interface BlockerState {
  ok?: boolean
  error?: string
  message?: string
  stamp?: number
}

const STATUSES = new Set(['open', 'watch', 'decided', 'dropped'])
const LEVELS = { initiative: initiatives, project: projects, workstream: workstreams } as const

function refresh() {
  revalidatePath('/')
  revalidatePath('/blockers')
  revalidatePath('/changes')
}

/** A short handle people can say out loud. Collisions resolve by suffix. */
async function nextRef(): Promise<string> {
  const rows = await db.select({ ref: decisions.ref }).from(decisions)
  const used = new Set(rows.map((r) => r.ref))
  for (let n = 1; n < 10_000; n++) {
    const ref = `B${n}`
    if (!used.has(ref)) return ref
  }
  return `B-${Date.now()}`
}

export async function createBlocker(_prev: BlockerState, formData: FormData): Promise<BlockerState> {
  const title = String(formData.get('title') ?? '').trim()
  const body = String(formData.get('body') ?? '').trim()
  const at = String(formData.get('at') ?? '').trim()
  const ownerId = String(formData.get('ownerId') ?? '').trim()
  const dueBy = String(formData.get('dueBy') ?? '').trim()
  const category = String(formData.get('category') ?? 'delivery')

  if (title.length < 3) return { error: 'Say what is blocked, in a few words.' }
  // The body is what somebody reads in three weeks when the title has stopped
  // meaning anything to them.
  if (body.length < 3) return { error: 'Say what is actually in the way.' }

  let entityType: string | null = null
  let entityId: string | null = null
  if (at) {
    const [level, id] = at.split(':')
    if (!level || !id || !(level in LEVELS)) return { error: 'That is not a record this portfolio has.' }
    const table = LEVELS[level as keyof typeof LEVELS]
    const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1)
    if (!row) return { error: 'That record no longer exists — reload the page.' }
    entityType = level
    entityId = id
  }

  const ref = await nextRef()
  const who = await actorName()
  await db.insert(decisions).values({
    ref,
    kind: 'blocker',
    category: ['strategic', 'delivery', 'risk'].includes(category) ? category : 'delivery',
    title,
    body,
    status: 'open',
    ownerId: ownerId || null,
    dueBy: dueBy || null,
    entityType,
    entityId,
    raisedAt: new Date(),
    raisedByText: who,
  })

  await logChange({
    actor: who,
    kind: 'change',
    summary: `${ref}: blocker raised — ${title.slice(0, 80)}`,
    detail: body.slice(0, 400),
    entityType,
    entityId,
  })

  refresh()
  return { ok: true, stamp: Date.now(), message: `Raised as ${ref}.` }
}

export async function setBlockerStatus(id: string, status: string): Promise<BlockerState> {
  if (!STATUSES.has(status)) return { error: 'Unknown status.' }
  const [row] = await db.select().from(decisions).where(eq(decisions.id, id)).limit(1)
  if (!row) return { error: 'That entry no longer exists.' }
  if (row.status === status) return { ok: true, stamp: Date.now(), message: 'Already there.' }

  const closing = status === 'decided' || status === 'dropped'
  await db
    .update(decisions)
    .set({ status, resolvedAt: closing ? new Date() : null })
    .where(eq(decisions.id, id))

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `${row.ref}: ${row.status} → ${status}`,
    detail: row.title,
    entityType: row.entityType,
    entityId: row.entityId,
  })

  refresh()
  return { ok: true, stamp: Date.now() }
}

/** Move a blocker onto the right piece of work, or off everything. */
export async function fileBlockerAt(id: string, level: string, entityId: string): Promise<BlockerState> {
  if (!(level in LEVELS)) return { error: 'Unknown level.' }
  const [row] = await db.select().from(decisions).where(eq(decisions.id, id)).limit(1)
  if (!row) return { error: 'That entry no longer exists.' }

  let name = 'nothing'
  if (entityId) {
    const table = LEVELS[level as keyof typeof LEVELS]
    const [found] = await db.select({ name: table.name }).from(table).where(eq(table.id, entityId)).limit(1)
    if (!found) return { error: 'That record no longer exists — reload the page.' }
    name = found.name
  }

  await db
    .update(decisions)
    .set({ entityType: entityId ? level : null, entityId: entityId || null })
    .where(eq(decisions.id, id))

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `${row.ref}: filed against ${name}`,
    detail: row.title,
    entityType: entityId ? level : null,
    entityId: entityId || null,
  })

  refresh()
  return { ok: true, stamp: Date.now() }
}
