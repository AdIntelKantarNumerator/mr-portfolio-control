/**
 * The milestones on one entity, and everything committed beneath it.
 *
 * WHY A PROJECT SHOWS ITS WORKSTREAMS' MILESTONES
 *
 * Almost nothing is committed at project level. The dates that matter are on
 * the workstreams, so a project page that showed only its own milestones
 * showed an empty plan for a project with eleven dated commitments under it —
 * and the person who wanted "what is this project on the hook for" had to
 * open each workstream and hold the answer in their head.
 *
 * So each level shows its own plus everything below it, and every borrowed
 * row says where it came from and links there. The row is still owned by the
 * entity it was written against: editing one here edits it there, which is
 * why each row carries its owner rather than the page's level.
 *
 * Dates are serialised on the way out: they cross into a client component,
 * where a Date would become a string anyway, and doing it here keeps the
 * boundary visible instead of leaving a field whose type depends on which
 * side of the wire you read it from.
 */
import { asc, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { milestones, projects, workstreams } from '@/db/schema'
import type { MilestoneRow } from '@/components/milestone-editor'

export type Level = 'initiative' | 'project' | 'workstream'

/** Every entity at or beneath `level`/`id`, with the names for the From column. */
async function descendants(
  level: Level,
  id: string,
): Promise<Array<{ level: Level; id: string; name: string }>> {
  const self = { level, id, name: '' }

  if (level === 'workstream') return [self]

  if (level === 'project') {
    const kids = await db
      .select({ id: workstreams.id, name: workstreams.name })
      .from(workstreams)
      .where(inArray(workstreams.projectId, [id]))
    return [self, ...kids.map((k) => ({ level: 'workstream' as const, id: k.id, name: k.name }))]
  }

  // An initiative reaches two tiers down, because the project page it sits
  // above is itself showing two. Anything else would mean the roll-up said
  // something different at each level.
  const kids = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(inArray(projects.initiativeId, [id]))
  if (kids.length === 0) return [self]

  const grandkids = await db
    .select({ id: workstreams.id, name: workstreams.name, projectId: workstreams.projectId })
    .from(workstreams)
    .where(inArray(workstreams.projectId, kids.map((k) => k.id)))

  return [
    self,
    ...kids.map((k) => ({ level: 'project' as const, id: k.id, name: k.name })),
    ...grandkids.map((g) => ({ level: 'workstream' as const, id: g.id, name: g.name })),
  ]
}

export async function milestoneRows(level: Level, entityId: string): Promise<MilestoneRow[]> {
  const scope = await descendants(level, entityId)
  const byId = new Map(scope.map((s) => [s.id, s]))

  const rows = await db
    .select()
    .from(milestones)
    .where(inArray(milestones.entityId, scope.map((s) => s.id)))
    .orderBy(asc(milestones.sortOrder), asc(milestones.name))

  return rows.map((m) => {
    const from = byId.get(m.entityId)
    // The page's own milestones carry no source: labelling them "from this
    // project" on the project's own page is noise in every row.
    const borrowed = Boolean(from && m.entityId !== entityId)
    return {
      id: m.id,
      name: m.name,
      details: m.details,
      status: m.status,
      targetLabel: m.targetLabel,
      targetDate: m.targetDate ? m.targetDate.toISOString() : null,
      dependencies: m.dependencies,
      contested: m.contested,
      editedFields: m.editedFields,
      editedBy: m.editedBy,
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      authoredBy: m.authoredBy,
      // Always set, because the form has to post the owner and not the page.
      ownerLevel: (from?.level ?? level) as Level,
      ownerId: m.entityId,
      from: borrowed && from ? { level: from.level, id: from.id, name: from.name } : null,
    }
  })
}
