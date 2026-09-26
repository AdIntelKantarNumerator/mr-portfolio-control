'use server'

/**
 * Readiness mutations.
 *
 * One action for the whole row — status, link and note move together, because
 * "done" without a link to the artifact is the claim this feature exists to
 * stop people making.
 */
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/db/client'
import { projectReadiness, workstreams, readinessItems } from '@/db/schema'
import { logChange } from '@/lib/portfolio'
import { actorName } from '@/lib/auth/current-user'
import { isReadinessStatus, readinessStatusLabel } from '@/lib/readiness'

/** There is no auth layer yet, so the changelog records the surface, not a person. */

function blankToNull(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '' ? null : s
}

export async function updateReadiness(formData: FormData) {
  const workstreamId = String(formData.get('workstreamId') ?? '')
  const itemId = String(formData.get('itemId') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!workstreamId || !itemId || !isReadinessStatus(status)) return

  const link = blankToNull(formData.get('link'))
  const note = blankToNull(formData.get('note'))

  const [[workstream], [item]] = await Promise.all([
    db.select({ name: workstreams.name }).from(workstreams).where(eq(workstreams.id, workstreamId)).limit(1),
    db
      .select({ label: readinessItems.label })
      .from(readinessItems)
      .where(eq(readinessItems.id, itemId))
      .limit(1),
  ])
  if (!workstream || !item) return

  const [existing] = await db
    .select()
    .from(projectReadiness)
    .where(
      and(eq(projectReadiness.workstreamId, workstreamId), eq(projectReadiness.itemId, itemId)),
    )
    .limit(1)

  // A workstream that has never been touched has no row at all, so the first edit
  // inserts rather than updates. Matching on (workstreamId, itemId) keeps the
  // unique index the only thing deciding which of two concurrent edits wins.
  if (existing) {
    const unchanged =
      existing.status === status && existing.link === link && existing.note === note
    if (unchanged) return
    await db
      .update(projectReadiness)
      .set({ status, link, note })
      .where(eq(projectReadiness.id, existing.id))
  } else {
    await db.insert(projectReadiness).values({ workstreamId, itemId, status, link, note })
  }

  const before = existing?.status ?? 'not_started'
  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary:
      before === status
        ? `${workstream.name} — "${item.label}" details updated`
        : `${workstream.name} — "${item.label}" ${readinessStatusLabel(before)} → ${readinessStatusLabel(status)}`,
    detail: [link ? `Link: ${link}` : null, note].filter(Boolean).join(' · ') || null,
    entityType: 'workstream',
    entityId: workstreamId,
  })

  revalidatePath('/readiness')
  revalidatePath(`/readiness/${workstreamId}`)
  revalidatePath('/changes')
}
