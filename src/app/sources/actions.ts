'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { conversationSources, transcripts } from '@/db/schema'
import { conversationSourceInput, transcriptInput } from '@/lib/domain'
import { fingerprint, generateBrief } from '@/lib/briefs'
import { logChange } from '@/lib/portfolio'
import { actorName } from '@/lib/auth/current-user'

export interface ActionState {
  ok?: boolean
  error?: string
  note?: string
  fieldErrors?: Record<string, string>
}

function refresh() {
  revalidatePath('/sources')
  revalidatePath('/initiatives')
  revalidatePath('/changes')
}

function parseEntity(raw: string): { type: string; id: string } | null {
  const [type, ...rest] = raw.split(':')
  const id = rest.join(':')
  if (!type || !id) return null
  return { type, id }
}

/**
 * Attaches a Slack channel, meeting series or document to an initiative or
 * project. Ingestion is off unless the person ticked the box — see the note on
 * the table for why that default is not negotiable.
 */
export async function addSource(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const entity = parseEntity(String(formData.get('entity') ?? ''))
  if (!entity) return { error: 'Pick what this source belongs to.' }

  const parsed = conversationSourceInput.safeParse({
    kind: String(formData.get('kind') ?? ''),
    entityType: entity.type,
    entityId: entity.id,
    label: String(formData.get('label') ?? '').trim(),
    externalId: String(formData.get('externalId') ?? '').trim() || null,
    url: String(formData.get('url') ?? '').trim() || null,
    ingestEnabled: formData.get('ingestEnabled') === 'on',
    notes: String(formData.get('notes') ?? '').trim() || null,
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? 'form')] = issue.message
    }
    return { fieldErrors, error: 'Check the highlighted fields.' }
  }

  const actor = await actorName()

  try {
    await db.insert(conversationSources).values({ ...parsed.data, addedBy: actor })
  } catch {
    return { error: 'That source is already attached to something.' }
  }

  await logChange({
    actor,
    kind: 'source',
    summary: `Attached ${parsed.data.label} to ${entity.type}`,
    detail: parsed.data.ingestEnabled
      ? 'Ingestion enabled at creation.'
      : 'Ingestion off — nothing will be read until it is turned on.',
  })

  refresh()
  return { ok: true }
}

export async function setIngestEnabled(sourceId: string, enabled: boolean): Promise<ActionState> {
  const actor = await actorName()
  const [row] = await db
    .select()
    .from(conversationSources)
    .where(eq(conversationSources.id, sourceId))
    .limit(1)
  if (!row) return { error: 'That source no longer exists.' }

  await db
    .update(conversationSources)
    .set({ ingestEnabled: enabled })
    .where(eq(conversationSources.id, sourceId))

  await logChange({
    actor,
    kind: 'source',
    summary: `${enabled ? 'Enabled' : 'Disabled'} ingestion for ${row.label}`,
    detail: enabled
      ? 'Conversations from this source can now be read and summarised.'
      : 'Nothing further will be read from this source.',
  })

  refresh()
  return { ok: true }
}

export async function removeSource(sourceId: string): Promise<ActionState> {
  const actor = await actorName()
  const [row] = await db
    .select()
    .from(conversationSources)
    .where(eq(conversationSources.id, sourceId))
    .limit(1)
  if (!row) return { ok: true }

  // Deactivated, not deleted: transcripts already ingested keep their link, and
  // "this used to be attached" is itself worth knowing.
  await db
    .update(conversationSources)
    .set({ active: false, ingestEnabled: false })
    .where(eq(conversationSources.id, sourceId))

  await logChange({ actor, kind: 'source', summary: `Detached ${row.label}` })
  refresh()
  return { ok: true }
}

/**
 * Takes a pasted or uploaded transcript.
 *
 * This is the path that works with no admin anywhere — no Workspace consent,
 * no Slack app approval. Whoever pastes it has decided the conversation is
 * relevant and is recorded as having decided that.
 */
export async function addTranscript(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const entity = parseEntity(String(formData.get('entity') ?? ''))
  if (!entity) return { error: 'Pick what this conversation is about.' }

  const rawBody = String(formData.get('body') ?? '').trim()
  const occurred = String(formData.get('occurredAt') ?? '').trim()

  const parsed = transcriptInput.safeParse({
    entityType: entity.type,
    entityId: entity.id,
    kind: String(formData.get('kind') ?? 'document'),
    title: String(formData.get('title') ?? '').trim(),
    occurredAt: occurred || null,
    url: String(formData.get('url') ?? '').trim() || null,
    body: rawBody,
    sourceId: String(formData.get('sourceId') ?? '').trim() || null,
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? 'form')] = issue.message
    }
    return { fieldErrors, error: 'Check the highlighted fields.' }
  }

  const actor = await actorName()
  const fp = fingerprint(entity.type, entity.id, parsed.data.body)

  const [existing] = await db
    .select({ id: transcripts.id })
    .from(transcripts)
    .where(eq(transcripts.fingerprint, fp))
    .limit(1)

  if (existing) {
    return { note: 'That exact transcript is already here — nothing added.' }
  }

  await db.insert(transcripts).values({
    ...parsed.data,
    sourceId: parsed.data.sourceId || null,
    fingerprint: fp,
    ingestedBy: actor,
  })

  if (parsed.data.sourceId) {
    await db
      .update(conversationSources)
      .set({ lastIngestedAt: new Date() })
      .where(eq(conversationSources.id, parsed.data.sourceId))
  }

  await logChange({
    actor,
    kind: 'transcript',
    summary: `Added "${parsed.data.title}" to ${entity.type}`,
    detail: `${parsed.data.body.length.toLocaleString()} characters.`,
  })

  refresh()
  return { ok: true, note: 'Added. Generate a brief to see it summarised.' }
}

export async function removeTranscript(transcriptId: string): Promise<ActionState> {
  const actor = await actorName()
  const [row] = await db
    .select({ title: transcripts.title })
    .from(transcripts)
    .where(eq(transcripts.id, transcriptId))
    .limit(1)
  if (!row) return { ok: true }

  await db.delete(transcripts).where(eq(transcripts.id, transcriptId))
  await logChange({ actor, kind: 'transcript', summary: `Removed "${row.title}"` })
  refresh()
  return { ok: true }
}

export async function regenerateBrief(
  entityType: string,
  entityId: string,
): Promise<ActionState> {
  const actor = await actorName()
  try {
    const { itemCount, warnings } = await generateBrief(entityType, entityId, actor)
    await logChange({
      actor,
      kind: 'brief',
      summary: `Generated a brief for ${entityType} (${itemCount} points)`,
      detail: warnings.join(' | ') || null,
    })
    refresh()
    return {
      ok: true,
      note:
        itemCount === 0
          ? 'Nothing worth reporting was found in the material. That is a real answer.'
          : `${itemCount} point(s).${warnings.length ? ` ${warnings.join(' ')}` : ''}`,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not generate a brief.' }
  }
}

/** Used by the page to decide whether to offer the button at all. */
export async function countTranscriptsFor(entityType: string, entityId: string) {
  const rows = await db
    .select({ id: transcripts.id })
    .from(transcripts)
    .where(and(eq(transcripts.entityType, entityType), eq(transcripts.entityId, entityId)))
  return rows.length
}
