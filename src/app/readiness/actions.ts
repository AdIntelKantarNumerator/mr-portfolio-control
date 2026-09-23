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
import { projectReadiness, projects, readinessItems } from '@/db/schema'
import { logChange } from '@/lib/portfolio'
import { actorName } from '@/lib/auth/current-user'
import { isReadinessStatus, readinessStatusLabel } from '@/lib/readiness'

/** There is no auth layer yet, so the changelog records the surface, not a person. */

function blankToNull(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '' ? null : s
}

export async function updateReadiness(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '')
  const itemId = String(formData.get('itemId') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!projectId || !itemId || !isReadinessStatus(status)) return

  const link = blankToNull(formData.get('link'))
  const note = blankToNull(formData.get('note'))

  const [[project], [item]] = await Promise.all([
    db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1),
    db
      .select({ label: readinessItems.label })
      .from(readinessItems)
      .where(eq(readinessItems.id, itemId))
      .limit(1),
  ])
  if (!project || !item) return

  const [existing] = await db
    .select()
    .from(projectReadiness)
    .where(
      and(eq(projectReadiness.projectId, projectId), eq(projectReadiness.itemId, itemId)),
    )
    .limit(1)

  // A project that has never been touched has no row at all, so the first edit
  // inserts rather than updates. Matching on (projectId, itemId) keeps the
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
    await db.insert(projectReadiness).values({ projectId, itemId, status, link, note })
  }

  const before = existing?.status ?? 'not_started'
  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary:
      before === status
        ? `${project.name} — "${item.label}" details updated`
        : `${project.name} — "${item.label}" ${readinessStatusLabel(before)} → ${readinessStatusLabel(status)}`,
    detail: [link ? `Link: ${link}` : null, note].filter(Boolean).join(' · ') || null,
    entityType: 'project',
    entityId: projectId,
  })

  revalidatePath('/readiness')
  revalidatePath(`/readiness/${projectId}`)
  revalidatePath('/changes')
}
