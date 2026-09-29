'use server'

/**
 * Editing the program review plan.
 *
 * This is the one screen in the portfolio where somebody writes down what a
 * team is TRYING to do, as opposed to what a system observed. It used to be a
 * slide deck, which is why the shape here is the deck's shape: an objective,
 * some detail, three lists of bullets, a date in whatever form the team
 * actually has it, and bands on a calendar.
 *
 * Deliberately no note required, unlike closing a blocker. Editing a plan is
 * the ordinary act this page exists for; demanding a justification for every
 * typo would mean the plan stops being edited, which is the failure mode that
 * put it in a slide deck in the first place.
 */
import { revalidatePath } from 'next/cache'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { milestoneItems, milestonePhases, milestones } from '@/db/schema'
import { PROJECT_ITEM_STATE, PROJECT_STATUS, isPeriod } from '@/lib/domain'
import { logChange } from '@/lib/portfolio'
import { actorName } from '@/lib/auth/current-user'

export interface ProjectState {
  ok?: boolean
  error?: string
}

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/changes')
}

export async function addProject(
  _prev: ProjectState,
  formData: FormData,
): Promise<ProjectState> {
  const projectId = String(formData.get('projectId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!projectId) return { error: 'No project.' }
  if (name.length < 2) return { error: 'Give it a name — the objective, as the deck would say it.' }

  const last = await db
    .select({ sortOrder: milestones.sortOrder })
    .from(milestones)
    .where(eq(milestones.entityId, projectId))
    .orderBy(asc(milestones.sortOrder))

  await db.insert(milestones).values({
    // Milestones added from a project page sit at project level.
    level: 'project',
    entityId: projectId,
    name: name.slice(0, 200),
    details: String(formData.get('details') ?? '').trim().slice(0, 1000) || null,
    status: 'planning',
    sortOrder: (last.at(-1)?.sortOrder ?? -1) + 1,
    // Null, not the actor: a person typed this, and authoredBy means an agent.
    authoredBy: null,
  })

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `Milestone added: ${name}`,
    entityType: 'project',
    entityId: projectId,
  })

  refresh(projectId)
  return { ok: true }
}

export async function updateProject(
  _prev: ProjectState,
  formData: FormData,
): Promise<ProjectState> {
  const id = String(formData.get('id') ?? '')
  const projectId = String(formData.get('projectId') ?? '')
  const status = String(formData.get('status') ?? '')

  const [row] = await db.select().from(milestones).where(eq(milestones.id, id)).limit(1)
  if (!row) return { error: 'That milestone no longer exists.' }

  await db
    .update(milestones)
    .set({
      name: String(formData.get('name') ?? row.name).trim().slice(0, 200) || row.name,
      details: String(formData.get('details') ?? '').trim().slice(0, 1000) || null,
      status: (PROJECT_STATUS as readonly string[]).includes(status) ? status : row.status,
      targetLabel: String(formData.get('targetLabel') ?? '').trim().slice(0, 80) || null,
      dependencies: String(formData.get('dependencies') ?? '').trim().slice(0, 1000) || null,
      // A person has touched it, so it is no longer only the agent's reading —
      // and her note about what she changed is superseded. Keeping it would
      // put her reasoning on a slide next to a row the owner has since fixed.
      authoredBy: null,
      agentNote: null,
      agentNoteAt: null,
      updatedAt: new Date(),
    })
    .where(eq(milestones.id, id))

  // The three lists arrive as three textareas, one line per bullet. That is
  // how people actually type a list, and a row-per-bullet form for something
  // edited in bulk every fortnight would not get used.
  const lists: Array<[string, string]> = PROJECT_ITEM_STATE.map((state) => [
    state,
    String(formData.get(`items_${state}`) ?? ''),
  ])

  if (lists.some(([, text]) => text.trim() !== '') || formData.has('items_completed')) {
    await db.delete(milestoneItems).where(eq(milestoneItems.milestoneId, id))
    const values = lists.flatMap(([state, text]) =>
      text
        .split('\n')
        .map((line) => line.replace(/^[-•*]\s*/, '').trim())
        .filter(Boolean)
        .map((line, ix) => ({
          milestoneId: id,
          state,
          text: line.slice(0, 500),
          sortOrder: ix,
          authoredBy: null,
        })),
    )
    if (values.length) await db.insert(milestoneItems).values(values)
  }

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `Milestone updated: ${row.name}`,
    entityType: 'project',
    entityId: projectId,
  })

  refresh(projectId)
  return { ok: true }
}

export async function removeProject(
  _prev: ProjectState,
  formData: FormData,
): Promise<ProjectState> {
  const id = String(formData.get('id') ?? '')
  const projectId = String(formData.get('projectId') ?? '')

  const [row] = await db.select().from(milestones).where(eq(milestones.id, id)).limit(1)
  if (!row) return { error: 'That milestone no longer exists.' }

  await db.delete(milestones).where(eq(milestones.id, id))
  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `Milestone removed: ${row.name}`,
    entityType: 'project',
    entityId: projectId,
  })

  refresh(projectId)
  return { ok: true }
}

/**
 * A band on the release calendar.
 *
 * Added one at a time rather than edited as a grid: a band is three facts
 * (phase, from, to) and a grid of twelve months by six phases is a spreadsheet
 * nobody wants inside a web page.
 */
export async function addPhase(
  _prev: ProjectState,
  formData: FormData,
): Promise<ProjectState> {
  const milestoneId = String(formData.get('milestoneId') ?? '')
  const projectId = String(formData.get('projectId') ?? '')
  const from = String(formData.get('fromPeriod') ?? '').trim()
  const to = String(formData.get('toPeriod') ?? '').trim() || from

  if (!isPeriod(from) || !isPeriod(to)) return { error: 'Months look like 2026-07.' }
  if (to < from) return { error: 'It cannot end before it starts.' }

  await db.insert(milestonePhases).values({
    milestoneId,
    phase: String(formData.get('phase') ?? 'development'),
    label: String(formData.get('label') ?? '').trim().slice(0, 80) || null,
    fromPeriod: from,
    toPeriod: to,
  })

  refresh(projectId)
  return { ok: true }
}

export async function removePhase(
  _prev: ProjectState,
  formData: FormData,
): Promise<ProjectState> {
  await db.delete(milestonePhases).where(eq(milestonePhases.id, String(formData.get('id') ?? '')))
  refresh(String(formData.get('projectId') ?? ''))
  return { ok: true }
}

/** The two names beside Owner on the slide. */
export async function setLeads(
  _prev: ProjectState,
  formData: FormData,
): Promise<ProjectState> {
  const { projects } = await import('@/db/schema')
  const projectId = String(formData.get('projectId') ?? '')
  await db
    .update(projects)
    .set({
      devLead: String(formData.get('devLead') ?? '').trim().slice(0, 200) || null,
      programLead: String(formData.get('programLead') ?? '').trim().slice(0, 200) || null,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
  refresh(projectId)
  return { ok: true }
}
