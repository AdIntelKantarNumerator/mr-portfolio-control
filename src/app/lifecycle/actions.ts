'use server'

/**
 * Closing, withdrawing and reopening a project, an initiative or a Strategic
 * Objective.
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
import { initiatives, objectives, projects } from '@/db/schema'
import { INITIATIVE_STATUS, OBJECTIVE_STATUS, PROJECT_STATUS_SET, isEnded, reopenedStatus, tierStatusLabel } from '@/lib/domain'
import { logChange } from '@/lib/portfolio'
import { actorName } from '@/lib/auth/current-user'

export interface LifecycleState {
  ok?: boolean
  error?: string
}

const MIN_NOTE = 4
const MAX_NOTE = 1000

type Kind = 'project' | 'initiative' | 'objective'

const TABLE = { project: projects, initiative: initiatives, objective: objectives } as const
const ALLOWED: Record<Kind, readonly string[]> = {
  project: PROJECT_STATUS_SET,
  initiative: INITIATIVE_STATUS,
  objective: OBJECTIVE_STATUS,
}

function refresh(kind: Kind, id: string) {
  try {
    revalidatePath(`/${kind}s/${id}`)
    revalidatePath('/objectives')
    revalidatePath('/projects')
    revalidatePath('/initiatives')
    revalidatePath('/applications')
    revalidatePath('/')
    revalidatePath('/changes')
  } catch (err) {
    // Only the no-request invariant is swallowed, for the same reason as in
    // objectives/actions.ts: scripts/check-objective-lifecycle.ts calls this
    // with no request, to test what reaches the database.
    if (!(err instanceof Error) || !/static generation store/i.test(err.message)) throw err
  }
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

  if (kind !== 'project' && kind !== 'initiative' && kind !== 'objective') return { error: 'Unknown kind of work.' }

  if (!ALLOWED[kind].includes(status)) return { error: 'That is not a status this can be set to.' }

  const table = TABLE[kind]
  const [row] = await db
    .select({ name: table.name, status: table.status })
    .from(table)
    .where(eq(table.id, id))
    .limit(1)
  if (!row) return { error: `That ${kind} no longer exists.` }

  if (row.status === status) return { error: `It is already ${tierStatusLabel(kind, status)}.` }

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

  // One statement per table rather than through `table`: the three are
  // different Drizzle types and a union of them has no callable `update`.
  const at = new Date()
  if (kind === 'objective') await db.update(objectives).set({ status, updatedAt: at }).where(eq(objectives.id, id))
  else if (kind === 'initiative') await db.update(initiatives).set({ status, updatedAt: at }).where(eq(initiatives.id, id))
  else await db.update(projects).set({ status, updatedAt: at }).where(eq(projects.id, id))

  const who = await actorName()
  await logChange({
    actor: who,
    kind: 'change',
    summary: `${row.name} moved ${tierStatusLabel(kind, row.status)} → ${tierStatusLabel(kind, status)}`,
    detail: note ? note.slice(0, MAX_NOTE) : null,
    entityType: kind,
    entityId: id,
  })

  refresh(kind, id)
  return { ok: true }
}

/** What reopening means for this kind, so the button can say it. */
export async function reopenTarget(kind: Kind): Promise<string> {
  return reopenedStatus(kind)
}
