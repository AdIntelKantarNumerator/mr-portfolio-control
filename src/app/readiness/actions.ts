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

/**
 * One checkbox, saved the moment it is clicked.
 *
 * The full form above is still the place to record a link and a note, and it
 * is still the honest way to mark something done. But a checklist you can
 * only change by opening a form on another page is a checklist that goes
 * stale, and a stale readiness score is worse than none: it is a green number
 * next to work nobody has checked.
 *
 * So this moves the status alone and leaves the link and note exactly as they
 * were. It cannot be used to claim "done" with no evidence where evidence was
 * already recorded, and where none was recorded it changes nothing about what
 * the row says.
 */
export interface ReadinessToggleState {
  error?: string
  stamp?: number
}

export async function toggleReadinessItem(
  _prev: ReadinessToggleState,
  formData: FormData,
): Promise<ReadinessToggleState> {
  const projectId = String(formData.get('projectId') ?? '')
  const itemId = String(formData.get('itemId') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!projectId || !itemId) return { error: 'Nothing to change.' }
  if (!isReadinessStatus(status)) return { error: `"${status}" is not a readiness state.` }

  const [existing] = await db
    .select({ link: projectReadiness.link, note: projectReadiness.note })
    .from(projectReadiness)
    .where(and(eq(projectReadiness.projectId, projectId), eq(projectReadiness.itemId, itemId)))
    .limit(1)

  const fd = new FormData()
  fd.set('projectId', projectId)
  fd.set('itemId', itemId)
  fd.set('status', status)
  // Carried through rather than cleared: the whole-row action treats an absent
  // field as "set it to null", and a tick should not silently delete the link
  // somebody attached last month.
  if (existing?.link) fd.set('link', existing.link)
  if (existing?.note) fd.set('note', existing.note)

  await updateReadiness(fd)

  /*
   * The detail pages render this checklist too, so they have to be refreshed —
   * but by path, not by layout.
   *
   * These were `revalidatePath('/projects', 'layout')` and the same for
   * initiatives, which invalidates every page under those segments. Ticking one
   * box threw away the rendered output of every project and every initiative
   * in the portfolio, and the reader waited for their own page to be built
   * again from nothing. One extra query to find the parent is a great deal
   * cheaper than that.
   */
  const [row] = await db
    .select({ initiativeId: projects.initiativeId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  revalidatePath(`/projects/${projectId}`)
  if (row?.initiativeId) revalidatePath(`/initiatives/${row.initiativeId}`)

  return { stamp: Date.now() }
}
