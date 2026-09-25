'use server'

/**
 * Closing, withdrawing and reopening a project or an initiative.
 *
 * The status column has always existed and nothing in the UI could set it —
 * everything arrived from the tracker sync, which works right up until a piece
 * of work only lives here, as everything converted from intake does. A project
 * you cannot close is a project that stays on the list forever.
 *
 * A note is required to end something and to reopen it, for the same reason the
 * register requires one: six months later, "why was this cancelled" is asked by
 * somebody who was not in the room, and the status alone cannot answer it. It
 * goes to the changelog, which is the one place in this app that already
 * answers "what happened and who did it".
 *
 * Reopening is deliberately a first-class action rather than just setting the
 * status back. It is the operation people are most afraid of not having, and
 * the reason they otherwise leave dead work on the list.
 */
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { initiatives, projects } from '@/db/schema'
import { INITIATIVE_STATUS, PROJECT_STATUS, isEnded, label, reopenedStatus } from '@/lib/domain'
import { logChange } from '@/lib/portfolio'
import { actorName } from '@/lib/auth/current-user'

export interface LifecycleState {
  ok?: boolean
  error?: string
}

const MIN_NOTE = 4
const MAX_NOTE = 1000

function refresh(kind: 'project' | 'initiative', id: string) {
  revalidatePath(`/${kind}s/${id}`)
  revalidatePath('/projects')
  revalidatePath('/initiatives')
  revalidatePath('/applications')
  revalidatePath('/')
  revalidatePath('/changes')
}

/**
 * Set the status, with a reason.
 *
 * One action for both kinds and every status rather than a close button, a
 * withdraw button and a reopen button: they differ only in the value written
 * and the sentence recorded, and three near-identical actions is three places
 * for the changelog line to drift.
 */
export async function setLifecycle(
  _prev: LifecycleState,
  formData: FormData,
): Promise<LifecycleState> {
  const kind = String(formData.get('kind') ?? '')
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (kind !== 'project' && kind !== 'initiative') return { error: 'Unknown kind of work.' }

  const allowed: readonly string[] = kind === 'project' ? PROJECT_STATUS : INITIATIVE_STATUS
  if (!allowed.includes(status)) return { error: 'That is not a status this can be set to.' }

  const table = kind === 'project' ? projects : initiatives
  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1)
  if (!row) return { error: `That ${kind} no longer exists.` }

  if (row.status === status) return { error: `It is already ${label(`${kind}Status`, status)}.` }

  // Ending something and bringing it back are both decisions somebody should
  // be able to explain later. Moving between two live states is routine and is
  // not worth a sentence every time.
  const ending = isEnded(status)
  const reviving = isEnded(row.status) && !ending
  if ((ending || reviving) && note.length < MIN_NOTE) {
    return {
      error: ending
        ? 'Say why it is ending. "Why was this cancelled" gets asked by someone who was not in the room.'
        : 'Say why it is coming back.',
    }
  }

  await db.update(table).set({ status, updatedAt: new Date() }).where(eq(table.id, id))

  const who = await actorName()
  await logChange({
    actor: who,
    kind: 'change',
    summary: `${row.name} moved ${label(`${kind}Status`, row.status)} → ${label(`${kind}Status`, status)}`,
    detail: note ? note.slice(0, MAX_NOTE) : null,
    entityType: kind,
    entityId: id,
  })

  refresh(kind, id)
  return { ok: true }
}

/** What reopening means for this kind, so the button can say it. */
export async function reopenTarget(kind: 'project' | 'initiative'): Promise<string> {
  return reopenedStatus(kind)
}
