'use server'

/**
 * Editing the sentence Yaara wrote.
 *
 * She writes the one-line assessment on every home page card, and she is
 * sometimes wrong in a way that is faster to fix than to explain. So anyone can
 * rewrite it in place.
 *
 * WHOSE SENTENCE IT IS
 *
 * The moment somebody edits it, it stops being her reading and becomes theirs,
 * and the card says so — their name replaces hers. That matters more than it
 * sounds: the whole value of her assessment is that a reader knows it came from
 * a machine and can weigh it accordingly, and a human correction hiding behind
 * her byline would break that in both directions.
 *
 * Her original is kept. It is not shown by default — a card carrying two
 * opinions is a card nobody reads — but it is in the observation's items and in
 * the changelog, so "what did she actually say" has an answer.
 */
import { revalidatePath } from 'next/cache'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { agentObservations } from '@/db/schema'
import { actorName } from '@/lib/auth/current-user'
import { logChange } from '@/lib/portfolio'

export interface VerdictState {
  error?: string
  ok?: boolean
}

export async function saveVerdict(_prev: VerdictState, formData: FormData): Promise<VerdictState> {
  const level = String(formData.get('level') ?? '')
  const entityId = String(formData.get('entityId') ?? '')
  const text = String(formData.get('verdict') ?? '').trim()
  const name = String(formData.get('entityName') ?? '')

  if (!level || !entityId) return { error: 'Nothing to save against.' }
  if (!text) return { error: 'The assessment cannot be empty — clear it by deleting the card instead.' }
  if (text.length > 400) return { error: 'Keep it to a sentence; the card shows it in large type.' }

  const [row] = await db
    .select()
    .from(agentObservations)
    .where(
      and(
        eq(agentObservations.entityType, level),
        eq(agentObservations.entityId, entityId),
        isNull(agentObservations.supersededAt),
      ),
    )
    .orderBy(desc(agentObservations.generatedAt))
    .limit(1)

  const who = await actorName()

  if (!row) {
    // Nothing of hers to edit yet. A person writing the first assessment is a
    // legitimate thing to do, so it is recorded as an observation authored by
    // them rather than refused.
    await db.insert(agentObservations).values({
      entityType: level,
      entityId,
      agent: who,
      items: '[]',
      evidence: '[]',
      verdict: text,
      verdictBy: who,
      verdictAt: new Date(),
      model: 'human',
    })
  } else {
    await db
      .update(agentObservations)
      .set({ verdict: text, verdictBy: who, verdictAt: new Date() })
      .where(eq(agentObservations.id, row.id))
  }

  await logChange({
    actor: who,
    kind: 'note',
    summary: `${name || entityId}: assessment edited`,
    detail: row?.verdict ? `was: ${row.verdict}\nnow: ${text}` : `set to: ${text}`,
    entityType: level,
    entityId,
  })

  revalidatePath('/')
  return { ok: true }
}

/** Put her sentence back, for when an edit turns out to be the wrong call. */
export async function restoreVerdict(_prev: VerdictState, formData: FormData): Promise<VerdictState> {
  const level = String(formData.get('level') ?? '')
  const entityId = String(formData.get('entityId') ?? '')

  const [row] = await db
    .select()
    .from(agentObservations)
    .where(
      and(
        eq(agentObservations.entityType, level),
        eq(agentObservations.entityId, entityId),
        isNull(agentObservations.supersededAt),
      ),
    )
    .orderBy(desc(agentObservations.generatedAt))
    .limit(1)

  if (!row) return { error: 'Nothing to restore.' }

  await db
    .update(agentObservations)
    .set({ verdict: null, verdictBy: null, verdictAt: null })
    .where(eq(agentObservations.id, row.id))

  revalidatePath('/')
  return { ok: true }
}
