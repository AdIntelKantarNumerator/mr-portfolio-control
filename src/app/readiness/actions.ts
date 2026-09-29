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
  const workstreamId = String(formData.get('workstreamId') ?? '')
  const itemId = String(formData.get('itemId') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!workstreamId || !itemId) return { error: 'Nothing to change.' }
  if (!isReadinessStatus(status)) return { error: `"${status}" is not a readiness state.` }

  const [existing] = await db
    .select({ link: projectReadiness.link, note: projectReadiness.note })
    .from(projectReadiness)
    .where(and(eq(projectReadiness.workstreamId, workstreamId), eq(projectReadiness.itemId, itemId)))
    .limit(1)

  const fd = new FormData()
  fd.set('workstreamId', workstreamId)
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
   * These were `revalidatePath('/workstreams', 'layout')` and the same for
   * projects, which invalidates every page under those segments. Ticking one
   * box threw away the rendered output of every workstream and every project
   * in the portfolio, and the reader waited for their own page to be built
   * again from nothing. One extra query to find the parent is a great deal
   * cheaper than that.
   */
  const [row] = await db
    .select({ projectId: workstreams.projectId })
    .from(workstreams)
    .where(eq(workstreams.id, workstreamId))
    .limit(1)

  revalidatePath(`/workstreams/${workstreamId}`)
  if (row?.projectId) revalidatePath(`/projects/${row.projectId}`)

  return { stamp: Date.now() }
}
