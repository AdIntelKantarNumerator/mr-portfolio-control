'use server'

/**
 * Setting milestones by hand, at any of the three levels.
 *
 * The plan — what a team says it will deliver and by when — arrives from
 * Linear and from read program review decks. Neither of those is always
 * right, and neither covers an initiative at all: nothing upstream knows what
 * "Ad Intelligence Platform" is committed to, because the grouping only
 * exists here.
 *
 * WHAT A HAND EDIT DOES TO THE NEXT SYNC
 *
 * It records which fields it changed, and the sync then leaves exactly those
 * alone while carrying on with the rest. Correcting a date does not freeze
 * the name. The rule is in lib/milestones.ts and is applied identically by
 * Linear's sync, the agent route and this file; the last time a rule like it
 * lived in three copies, the three disagreed within a month.
 *
 * Deleting is offered, unlike almost everywhere else in this app, because a
 * milestone that should not be there is usually a transcription error rather
 * than a decision anybody wants a record of. The changelog keeps the name.
 */
import { revalidatePath } from 'next/cache'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { initiatives, milestones, projects, workstreams } from '@/db/schema'
import { actorName } from '@/lib/auth/current-user'
import { logChange } from '@/lib/portfolio'
import { lockedAfterEdit, type MilestoneField } from '@/lib/milestones'
import { WORKSTREAM_STATUS } from '@/lib/domain'

export interface MilestoneState {
  ok?: boolean
  error?: string
  message?: string
  stamp?: number
}

const LEVELS = new Set(['initiative', 'project', 'workstream'])
const STATUSES = new Set<string>(WORKSTREAM_STATUS)

function refresh(level: string, entityId: string) {
  revalidatePath('/')
  revalidatePath('/changes')
  revalidatePath(`/${level}s/${entityId}`)
  revalidatePath(`/${level}s`)
}

/** The row exists and is at the level it claims. */
async function entityName(level: string, id: string): Promise<string | null> {
  if (level === 'initiative') {
    const [r] = await db.select({ name: initiatives.name }).from(initiatives).where(eq(initiatives.id, id)).limit(1)
    return r?.name ?? null
  }
  if (level === 'project') {
    const [r] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, id)).limit(1)
    return r?.name ?? null
  }
  const [r] = await db.select({ name: workstreams.name }).from(workstreams).where(eq(workstreams.id, id)).limit(1)
  return r?.name ?? null
}

function asDate(v: FormDataEntryValue | null): Date | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function saveMilestone(_prev: MilestoneState, formData: FormData): Promise<MilestoneState> {
  const level = String(formData.get('level') ?? '')
  const entityId = String(formData.get('entityId') ?? '')
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()

  if (!LEVELS.has(level) || !entityId) return { error: 'Nothing to attach this to.' }
  if (name.length < 2) return { error: 'A milestone needs a name.' }
  if (name.length > 200) return { error: 'That name is too long for a rail.' }

  const owner = await entityName(level, entityId)
  if (!owner) return { error: `That ${level} no longer exists.` }

  const status = String(formData.get('status') ?? 'planning')
  if (!STATUSES.has(status)) return { error: 'Unknown status.' }

  // Typed, not a loose record: it is spread straight into the insert, and a
  // Record<string, unknown> there makes drizzle accept a milestone with no
  // name at compile time.
  const after = {
    name,
    details: String(formData.get('details') ?? '').trim().slice(0, 1000) || null,
    status,
    // Both, and deliberately: the label is what the room reads off a slide
    // ("Q3/Q4"), the date is what a timeline sorts by. Neither is derivable
    // from the other, which is why the form asks for both.
    targetLabel: String(formData.get('targetLabel') ?? '').trim().slice(0, 80) || null,
    targetDate: asDate(formData.get('targetDate')),
    dependencies: String(formData.get('dependencies') ?? '').trim().slice(0, 1000) || null,
    contested: formData.get('contested') === 'on',
  } satisfies Partial<Record<MilestoneField, unknown>>

  const who = await actorName()

  if (!id) {
    const [last] = await db
      .select({ sortOrder: milestones.sortOrder })
      .from(milestones)
      .where(eq(milestones.entityId, entityId))
      .orderBy(asc(milestones.sortOrder))
    await db.insert(milestones).values({
      level,
      entityId,
      ...after,
      sortOrder: (last?.sortOrder ?? 0) + 10,
      editedBy: who,
      editedAt: new Date(),
      // Everything on a hand-created milestone is the person's. Nothing
      // upstream knows about it, so there is nothing for a sync to own.
      editedFields: 'name,details,status,targetLabel,targetDate,dependencies,contested',
    })
    await logChange({
      actor: who,
      kind: 'change',
      summary: `${owner}: milestone added — ${name}`,
      detail: after.targetLabel || after.targetDate ? `due ${after.targetLabel ?? String(after.targetDate).slice(0, 10)}` : null,
      entityType: level,
      entityId,
    })
    refresh(level, entityId)
    return { ok: true, stamp: Date.now(), message: 'Added.' }
  }

  const [before] = await db.select().from(milestones).where(eq(milestones.id, id)).limit(1)
  if (!before) return { error: 'That milestone no longer exists.' }

  const { fields, changed } = lockedAfterEdit(before, after, before.editedFields)
  if (changed.length === 0) return { ok: true, stamp: Date.now(), message: 'Nothing changed.' }

  await db
    .update(milestones)
    .set({
      ...after,
      editedBy: who,
      editedAt: new Date(),
      editedFields: fields,
      // Her note described the row as it was. It is no longer that row.
      agentNote: null,
      agentNoteAt: null,
      updatedAt: new Date(),
    })
    .where(eq(milestones.id, id))

  await logChange({
    actor: who,
    kind: 'change',
    summary: `${owner}: milestone edited — ${name}`,
    detail: changed
      .map((f) => `${f}: ${show(before[f as keyof typeof before])} → ${show(after[f as keyof typeof after])}`)
      .join('\n'),
    entityType: level,
    entityId,
  })

  refresh(level, entityId)
  return {
    ok: true,
    stamp: Date.now(),
    message: `Saved. A sync will leave ${changed.join(', ')} alone from now on.`,
  }
}

export async function deleteMilestone(_prev: MilestoneState, formData: FormData): Promise<MilestoneState> {
  const id = String(formData.get('id') ?? '')
  const [row] = await db.select().from(milestones).where(eq(milestones.id, id)).limit(1)
  if (!row) return { error: 'That milestone no longer exists.' }

  const owner = await entityName(row.level, row.entityId)
  await db.delete(milestones).where(eq(milestones.id, id))

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `${owner ?? row.entityId}: milestone removed — ${row.name}`,
    detail: 'A sync may recreate it if the source still has it.',
    entityType: row.level,
    entityId: row.entityId,
  })

  refresh(row.level, row.entityId)
  return { ok: true, stamp: Date.now(), message: 'Removed.' }
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(none)'
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}
