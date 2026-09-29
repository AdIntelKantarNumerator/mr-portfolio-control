'use server'

/**
 * Closing, reopening and dropping an action item.
 *
 * Three states rather than two. `done` means it happened; `dropped` means the
 * commitment was abandoned, which is a different and much more useful thing to
 * know six weeks later than a row that quietly disappeared. Deleting is not
 * offered: the whole point of writing down what people said they would do is
 * that the record survives changing one's mind about it.
 *
 * Dropping takes a note. Closing does not — "it is done" needs no
 * explanation, and demanding one is how a register stops being kept current.
 */
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { actionItemLinks, actionItems, objectives, people, initiatives, projects } from '@/db/schema'
import { actorName } from '@/lib/auth/current-user'
import { logChange } from '@/lib/portfolio'

export interface ActionState {
  ok?: boolean
  error?: string
  message?: string
  stamp?: number
}

const STATES = new Set(['open', 'done', 'dropped'])

function refresh() {
  revalidatePath('/')
  revalidatePath('/actions')
  revalidatePath('/changes')
}

export async function setActionStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (!STATES.has(status)) return { error: 'Unknown status.' }

  const [row] = await db.select().from(actionItems).where(eq(actionItems.id, id)).limit(1)
  if (!row) return { error: 'That action item no longer exists.' }
  if (row.status === status) return { ok: true, stamp: Date.now(), message: 'Already there.' }

  if (status === 'dropped' && note.length < 3) {
    return { error: 'Say why it is being dropped — that is the part somebody needs in six weeks.' }
  }

  const who = await actorName()
  await db
    .update(actionItems)
    .set({
      status,
      completedAt: status === 'done' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(actionItems.id, id))

  const [link] = await db.select().from(actionItemLinks).where(eq(actionItemLinks.actionItemId, id)).limit(1)

  await logChange({
    actor: who,
    kind: 'note',
    summary: `${row.ref ?? id}: ${status === 'done' ? 'done' : status === 'dropped' ? 'dropped' : 'reopened'} — ${row.text.slice(0, 80)}`,
    detail: note || null,
    entityType: link?.level ?? null,
    entityId: link?.entityId ?? null,
  })

  refresh()
  return {
    ok: true,
    stamp: Date.now(),
    message: status === 'done' ? 'Closed.' : status === 'dropped' ? 'Dropped.' : 'Reopened.',
  }
}

/**
 * Putting a name on an unowned commitment.
 *
 * The most common repair on this page. Yaara records an action item with
 * nobody named when the notes name nobody, which is correct and also the state
 * most likely to need fixing by whoever was actually in the room.
 */
export async function claimAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '')
  const ownerId = String(formData.get('ownerId') ?? '')
  const due = String(formData.get('dueDate') ?? '').trim()

  const [row] = await db.select().from(actionItems).where(eq(actionItems.id, id)).limit(1)
  if (!row) return { error: 'That action item no longer exists.' }

  const changes: string[] = []
  const patch: Record<string, unknown> = { updatedAt: new Date() }

  if (ownerId !== (row.ownerId ?? '')) {
    if (ownerId) {
      const [person] = await db.select().from(people).where(eq(people.id, ownerId)).limit(1)
      if (!person) return { error: 'That person is not in the portfolio.' }
      patch.ownerId = person.id
      // The raw name from the notes is cleared once a real person is on it,
      // so the row does not carry two owners that can disagree.
      patch.ownerName = null
      changes.push(`owner: ${row.ownerName ?? 'nobody'} → ${person.name}`)
    } else {
      patch.ownerId = null
      changes.push('owner cleared')
    }
  }

  if (due !== (row.dueDate ? row.dueDate.toISOString().slice(0, 10) : '')) {
    if (due) {
      const d = new Date(`${due}T00:00:00Z`)
      if (Number.isNaN(d.getTime())) return { error: 'That is not a date.' }
      patch.dueDate = d
      changes.push(`due: ${row.dueDate ? row.dueDate.toISOString().slice(0, 10) : 'none'} → ${due}`)
    } else {
      patch.dueDate = null
      changes.push('date cleared')
    }
  }

  if (changes.length === 0) return { ok: true, stamp: Date.now(), message: 'Nothing changed.' }

  await db.update(actionItems).set(patch).where(eq(actionItems.id, id))

  const who = await actorName()
  const [link] = await db.select().from(actionItemLinks).where(eq(actionItemLinks.actionItemId, id)).limit(1)
  await logChange({
    actor: who,
    kind: 'change',
    summary: `${row.ref ?? id}: action item updated`,
    detail: changes.join('\n'),
    entityType: link?.level ?? null,
    entityId: link?.entityId ?? null,
  })

  refresh()
  return { ok: true, stamp: Date.now(), message: 'Saved.' }
}

/**
 * Filing an action item against a piece of work.
 *
 * WHY THIS IS THREE SEPARATE ASSIGNMENTS AND NOT ONE
 *
 * The list shows objective, initiative and project as three columns, and a
 * commitment can legitimately be known at one level and not the others: "the
 * GPC objective" is all anybody said in the meeting, and pretending to know
 * which project would be inventing a fact. So each level is set on its own
 * and "Unknown" is a real, reportable state rather than a gap to be filled in
 * by guessing.
 *
 * Links are stored one row per level in `action_item_links`, which the table
 * already allowed — nothing here changes shape, it is just now reachable from
 * the page instead of only from Yaara.
 */
export async function assignAction(
  id: string,
  level: string,
  entityId: string,
): Promise<ActionState> {
  if (!['objective', 'initiative', 'project'].includes(level)) return { error: 'Unknown level.' }

  const [row] = await db.select().from(actionItems).where(eq(actionItems.id, id)).limit(1)
  if (!row) return { error: 'That action item no longer exists.' }

  const table = level === 'objective' ? objectives : level === 'initiative' ? initiatives : projects
  let name = 'Unknown'
  if (entityId) {
    const [found] = await db.select({ name: table.name }).from(table).where(eq(table.id, entityId)).limit(1)
    if (!found) return { error: 'That record no longer exists — reload the page.' }
    name = found.name
  }

  const [existing] = await db
    .select()
    .from(actionItemLinks)
    .where(and(eq(actionItemLinks.actionItemId, id), eq(actionItemLinks.level, level)))
    .limit(1)

  if (existing?.entityId === entityId) return { ok: true, stamp: Date.now(), message: 'Already there.' }

  // One link per level: replaced rather than added to, because the column
  // shows one value and a second row would make the page disagree with itself.
  if (existing) await db.delete(actionItemLinks).where(eq(actionItemLinks.id, existing.id))
  if (entityId) await db.insert(actionItemLinks).values({ actionItemId: id, level, entityId })

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `${row.ref ?? id}: ${level} set to ${entityId ? name : 'unknown'}`,
    detail: row.text.slice(0, 160),
    entityType: entityId ? level : null,
    entityId: entityId || null,
  })

  refresh()
  return { ok: true, stamp: Date.now(), message: entityId ? `Filed under ${name}.` : 'Cleared.' }
}
