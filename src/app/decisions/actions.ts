'use server'

/**
 * Closing and reopening entries in the register, from the page.
 *
 * Three things these enforce, and each one exists because the alternative is a
 * register people stop trusting.
 *
 * A COMMENT IS REQUIRED, BOTH WAYS. Closing a blocker silently leaves the next
 * person with "it says resolved" and no way to find out what actually happened.
 * Reopening one silently is worse: it looks like the closure never happened.
 * The comment is short and it is not optional.
 *
 * WHO IS THE SIGNED-IN USER, NOT A FIELD. The one thing worth being certain of
 * about a closure is who is standing behind it, and a name typed into a box is
 * exactly the thing that gets filled in wrong or left as somebody else's.
 *
 * NOTHING IS OVERWRITTEN. A closure and a reopening are both events appended to
 * the trail. Reopening clears the resolution from the row — the row is the
 * current state — but the event that closed it, who closed it and why, stays
 * where anyone can read it.
 */
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { decisionEvents, decisions, initiatives, projects } from '@/db/schema'
import { logChange } from '@/lib/portfolio'
import { actorName, actorPersonId } from '@/lib/auth/current-user'
import { parseEntityTarget } from '@/lib/register'

export interface ActionState {
  ok?: boolean
  error?: string
  /** Which entry this result belongs to, so one card's error is not shown on all of them. */
  ref?: string
}

/** Long enough to say what happened, short enough that nobody writes an essay. */
const MIN_COMMENT = 4
const MAX_COMMENT = 1000

function refresh() {
  revalidatePath('/decisions')
  revalidatePath('/')
  revalidatePath('/changes')
}

async function load(id: string) {
  if (!id) return null
  const [row] = await db.select().from(decisions).where(eq(decisions.id, id)).limit(1)
  return row ?? null
}

export async function resolveEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '')
  const comment = String(formData.get('comment') ?? '').trim()

  const entry = await load(id)
  if (!entry) return { error: 'That entry no longer exists.' }

  if (comment.length < MIN_COMMENT) {
    return {
      ref: entry.ref,
      error:
        entry.kind === 'blocker'
          ? 'Say what unblocked it. Someone reading this in a month needs to know what actually changed.'
          : 'Say what was decided, and by whom if it matters.',
    }
  }

  // Already closed. Not an error worth shouting about — two people clicking the
  // same button is a normal thing to happen in a review — but it must not
  // overwrite the first closure's date and author.
  if (entry.resolvedAt) {
    return { ref: entry.ref, error: `${entry.ref} was already closed on ${entry.resolvedAt.toISOString().slice(0, 10)}.` }
  }

  const [who, name] = await Promise.all([actorPersonId(), actorName()])
  const now = new Date()

  await db
    .update(decisions)
    .set({
      status: entry.kind === 'blocker' ? 'decided' : 'decided',
      resolvedAt: now,
      resolvedById: who,
      // Deliberately null: this was closed on the page, not in a meeting, and
      // writing the person's name into the "which meeting" field would make
      // the card claim a conversation that never happened.
      resolvedAtMeeting: null,
      resolvedDocumentId: null,
      updatedAt: now,
    })
    .where(eq(decisions.id, id))

  await db.insert(decisionEvents).values({
    decisionId: id,
    kind: 'resolved',
    occurredAt: now,
    meeting: null,
    actor: name,
    note: comment.slice(0, MAX_COMMENT),
    recordedBy: name,
  })

  await logChange({
    actor: name,
    kind: 'change',
    summary: `${entry.ref} closed: ${entry.title}`,
    detail: comment.slice(0, MAX_COMMENT),
    entityType: entry.entityType,
    entityId: entry.entityId,
  })

  refresh()
  return { ok: true, ref: entry.ref }
}

export async function reopenEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '')
  const comment = String(formData.get('comment') ?? '').trim()

  const entry = await load(id)
  if (!entry) return { error: 'That entry no longer exists.' }

  if (comment.length < MIN_COMMENT) {
    return {
      ref: entry.ref,
      error: 'Say why it is open again. A closure that silently reverses is worse than one that never happened.',
    }
  }

  const name = await actorName()
  const now = new Date()

  await db
    .update(decisions)
    .set({
      status: 'open',
      // The row carries current state, so the resolution comes off it. The
      // event that closed it - who, when, and why - stays in the trail.
      resolvedAt: null,
      resolvedById: null,
      resolvedAtMeeting: null,
      resolvedDocumentId: null,
      updatedAt: now,
    })
    .where(eq(decisions.id, id))

  await db.insert(decisionEvents).values({
    decisionId: id,
    kind: 'reopened',
    occurredAt: now,
    meeting: null,
    actor: name,
    note: comment.slice(0, MAX_COMMENT),
    recordedBy: name,
  })

  await logChange({
    actor: name,
    kind: 'change',
    summary: `${entry.ref} reopened: ${entry.title}`,
    detail: comment.slice(0, MAX_COMMENT),
    entityType: entry.entityType,
    entityId: entry.entityId,
  })

  refresh()
  return { ok: true, ref: entry.ref }
}

/**
 * Move an entry to the piece of work it actually belongs to.
 *
 * This exists because entries arrive misfiled. Yaara reads a meeting and has to
 * decide which project it is about; she now refuses to guess, but a wrong
 * attachment made before that guard — or by a person picking the wrong row —
 * has to be fixable, and it was not. A register you cannot correct is one
 * people work around.
 *
 * The move is recorded as an event rather than done quietly. "This was on
 * Delivery TEST until Thursday" is exactly the kind of thing somebody needs
 * when they are trying to work out why they never saw it.
 *
 * A reason is optional here, unlike closing. From-and-to IS the record, and the
 * honest answer is almost always "it was filed wrong" — making someone type
 * that on every correction is ceremony that would get in the way of fixing a
 * batch of them.
 */
export async function moveEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '')
  const target = parseEntityTarget(String(formData.get('target') ?? ''))
  const reason = String(formData.get('reason') ?? '').trim()

  const entry = await load(id)
  if (!entry) return { error: 'That entry no longer exists.' }
  if (!target) return { ref: entry.ref, error: 'Pick the initiative or project it belongs to.' }

  if (entry.entityType === target.type && entry.entityId === target.id) {
    return { ref: entry.ref, error: 'It is already there.' }
  }

  // The target has to be real. A form can be posted with anything in it, and an
  // entry pointed at an id that does not exist is invisible everywhere.
  const [initiative, project] = await Promise.all([
    target.type === 'initiative'
      ? db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives).where(eq(initiatives.id, target.id)).limit(1)
      : Promise.resolve([]),
    target.type === 'project'
      ? db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, target.id)).limit(1)
      : Promise.resolve([]),
  ])
  const found = initiative[0] ?? project[0]
  if (!found) return { ref: entry.ref, error: 'That initiative or project no longer exists.' }

  // The name it is leaving, for the event. Looked up before the update, since
  // afterwards there is nothing to look it up from.
  const fromName = await nameOfEntity(entry.entityType, entry.entityId)

  const name = await actorName()
  const now = new Date()

  await db
    .update(decisions)
    .set({ entityType: target.type, entityId: target.id, updatedAt: now })
    .where(eq(decisions.id, id))

  await db.insert(decisionEvents).values({
    decisionId: id,
    kind: 'updated',
    occurredAt: now,
    meeting: null,
    actor: name,
    note: `Moved from ${fromName ?? 'nothing'} to ${found.name}.${reason ? ` ${reason}` : ''}`,
    recordedBy: name,
  })

  await logChange({
    actor: name,
    kind: 'change',
    summary: `${entry.ref} moved to ${found.name}`,
    detail: `${entry.title}${reason ? ` — ${reason}` : ''}`,
    entityType: target.type,
    entityId: target.id,
  })

  refresh()
  return { ok: true, ref: entry.ref }
}

/** What a piece of work is called, for the record of a move away from it. */
async function nameOfEntity(type: string | null, id: string | null): Promise<string | null> {
  if (!type || !id) return null
  if (type === 'initiative') {
    const [row] = await db.select({ name: initiatives.name }).from(initiatives).where(eq(initiatives.id, id)).limit(1)
    return row?.name ?? null
  }
  if (type === 'project') {
    const [row] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, id)).limit(1)
    return row?.name ?? null
  }
  return null
}
