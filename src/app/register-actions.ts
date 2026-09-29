'use server'

/**
 * Filing a register entry against the work you are looking at.
 *
 * WHY THIS IS ON THE DETAIL PAGE AND NOT ONLY ON THE REGISTER PAGES
 *
 * Almost everything in these four registers was written by Yaara out of a
 * meeting she read, and everything a person could do was correct what she
 * wrote. But a blocker somebody hits on a Tuesday, a decision taken in a
 * corridor, an action agreed on a call she does not have the notes for — none
 * of those existed until she happened to read about them, and the place
 * somebody knows about one is the page for the work it concerns.
 *
 * Each function takes the entity as the page knows it, so nothing has to be
 * picked from a list of three hundred to record something about the thing
 * already on screen.
 */
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { actionItemLinks, actionItems, decisions, dependencies, initiatives, projects, workstreams } from '@/db/schema'
import { actorName } from '@/lib/auth/current-user'
import { logChange } from '@/lib/portfolio'
import { blockerPatch, dependencyPatch, describeChange } from '@/lib/register-edit'

export interface RegisterState {
  ok?: boolean
  error?: string
  message?: string
  stamp?: number
}

const LEVELS = { initiative: initiatives, project: projects, workstream: workstreams } as const
type Level = keyof typeof LEVELS
const isLevel = (v: string): v is Level => v === 'initiative' || v === 'project' || v === 'workstream'

function refresh(level: string, id: string) {
  try {
    revalidatePath('/')
    // A record filed against nothing in particular still changes the
    // registers; there is simply no detail page to rebuild.
    if (level && id) revalidatePath(`/${level}s/${id}`)
    revalidatePath('/blockers')
    revalidatePath('/actions')
    revalidatePath('/dependencies')
    revalidatePath('/changes')
  } catch (err) {
    // Needs a request context; the check scripts have none. Same guard, and
    // the same reasoning, as initiatives/actions.ts.
    if (!(err instanceof Error) || !/static generation store/i.test(err.message)) throw err
  }
}

/** A handle people can say out loud. Collisions resolve by suffix, never by failing. */
async function nextRef(prefix: string): Promise<string> {
  const rows = await db.select({ ref: decisions.ref }).from(decisions)
  const used = new Set(rows.map((r) => r.ref))
  for (let n = 1; n < 10_000; n++) {
    const ref = `${prefix}${n}`
    if (!used.has(ref)) return ref
  }
  return `${prefix}-${Date.now()}`
}

async function entityExists(level: Level, id: string): Promise<boolean> {
  const table = LEVELS[level]
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1)
  return Boolean(row)
}

/**
 * A blocker or a decision. One function because they are one table and one
 * shape — what differs is which word the page used, and which prefix the
 * reference gets.
 */
export async function addRegisterEntry(input: {
  kind: 'blocker' | 'decision'
  level: string
  entityId: string
  title: string
  body: string
  ownerId?: string | null
  dueBy?: string | null
}): Promise<RegisterState> {
  if (!isLevel(input.level)) return { error: 'Unknown kind of record.' }
  if (!(await entityExists(input.level, input.entityId))) return { error: 'That record no longer exists — reload the page.' }

  const title = input.title.trim()
  const body = input.body.trim()
  if (title.length < 3) return { error: input.kind === 'blocker' ? 'Say what is blocked.' : 'Say what has to be decided.' }
  // The body is what somebody reads in three weeks when the title has stopped
  // meaning anything to them.
  if (body.length < 3) return { error: 'Say a little more — one line is what makes this readable later.' }

  const ref = await nextRef(input.kind === 'blocker' ? 'B' : 'D')
  const who = await actorName()
  await db.insert(decisions).values({
    ref,
    kind: input.kind,
    category: 'delivery',
    title,
    body,
    status: 'open',
    ownerId: input.ownerId || null,
    dueBy: input.dueBy?.trim() || null,
    entityType: input.level,
    entityId: input.entityId,
    raisedAt: new Date(),
    raisedByText: who,
  })

  await logChange({
    actor: who,
    kind: 'change',
    summary: `${ref}: ${input.kind} raised — ${title.slice(0, 80)}`,
    detail: body.slice(0, 400),
    entityType: input.level,
    entityId: input.entityId,
  })

  refresh(input.level, input.entityId)
  return { ok: true, stamp: Date.now(), message: `Raised as ${ref}.` }
}

/** An action item, filed against the work it came up on. */
export async function addActionItem(input: {
  level: string
  entityId: string
  text: string
  ownerId?: string | null
  dueDate?: string | null
}): Promise<RegisterState> {
  if (!isLevel(input.level)) return { error: 'Unknown kind of record.' }
  if (!(await entityExists(input.level, input.entityId))) return { error: 'That record no longer exists — reload the page.' }

  const text = input.text.trim()
  if (text.length < 3) return { error: 'Say what somebody is going to do.' }

  let due: Date | null = null
  if (input.dueDate?.trim()) {
    due = new Date(`${input.dueDate.trim()}T00:00:00Z`)
    if (Number.isNaN(due.getTime())) return { error: 'That is not a date.' }
  }

  const existing = await db.select({ ref: actionItems.ref }).from(actionItems)
  const used = new Set(existing.map((r) => r.ref).filter(Boolean) as string[])
  let ref = `AI-${used.size + 1}`
  for (let n = used.size + 1; used.has(ref) && n < 100_000; n++) ref = `AI-${n}`

  const who = await actorName()
  const [created] = await db
    .insert(actionItems)
    .values({
      ref,
      text,
      status: 'open',
      ownerId: input.ownerId || null,
      dueDate: due,
      sourceTitle: `Added on the ${input.level} page`,
      authoredBy: who,
    })
    .returning({ id: actionItems.id })

  await db.insert(actionItemLinks).values({ actionItemId: created.id, level: input.level, entityId: input.entityId })

  await logChange({
    actor: who,
    kind: 'change',
    summary: `${ref}: action item added — ${text.slice(0, 80)}`,
    entityType: input.level,
    entityId: input.entityId,
  })

  refresh(input.level, input.entityId)
  return { ok: true, stamp: Date.now(), message: `Added as ${ref}.` }
}

/**
 * A dependency, with this page's work at one end.
 *
 * `direction` says which end: "delivering" when this work is what has to land,
 * "waiting" when it is what cannot move until something else does. Both are
 * things people file from here, and guessing would put half of them backwards.
 */
export async function addDependency(input: {
  level: string
  entityId: string
  direction: 'delivering' | 'waiting'
  other: string
  requiredBy?: string | null
  criticality?: string
  description?: string | null
}): Promise<RegisterState> {
  if (!isLevel(input.level)) return { error: 'Unknown kind of record.' }
  if (!(await entityExists(input.level, input.entityId))) return { error: 'That record no longer exists — reload the page.' }

  const [otherType, ...rest] = input.other.split(':')
  const otherId = rest.join(':')
  if (!otherType || !otherId) return { error: 'Pick what this depends on.' }
  if (otherType === input.level && otherId === input.entityId) return { error: 'Something cannot depend on itself.' }

  let due: Date | null = null
  if (input.requiredBy?.trim()) {
    due = new Date(`${input.requiredBy.trim()}T00:00:00Z`)
    if (Number.isNaN(due.getTime())) return { error: 'That is not a date.' }
  }

  const here = { type: input.level, id: input.entityId }
  const there = { type: otherType, id: otherId }
  const from = input.direction === 'delivering' ? here : there
  const to = input.direction === 'delivering' ? there : here

  await db.insert(dependencies).values({
    fromType: from.type,
    fromId: from.id,
    toType: to.type,
    toId: to.id,
    kind: 'blocks',
    status: 'open',
    criticality: ['normal', 'high', 'critical'].includes(input.criticality ?? '') ? input.criticality! : 'normal',
    description: input.description?.trim() || null,
    dueDate: due,
  })

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: 'Dependency added',
    detail: input.description?.trim() || null,
    entityType: input.level,
    entityId: input.entityId,
  })

  refresh(input.level, input.entityId)
  return { ok: true, stamp: Date.now(), message: 'Recorded.' }
}

// ---------------------------------------------------------------------------
// Changing one, and removing one
//
// WHY BOTH SCREENS CALL THESE
//
// A blocker appears on the work's own page and on the Blockers page, and a
// dependency likewise. Editing was available on neither, and the two screens
// that did offer something — a status select here, an "Against" picker there —
// had already grown apart. Adding an edit path to each page separately would
// have made that three ways to change one row.
//
// WHAT DELETE MEANS
//
// It removes the row. Not a "dropped" status, which both registers already
// have and which is the right answer for something that was real and is now
// moot: delete is for an entry that should never have existed — a duplicate,
// a mis-read, a test. The changelog keeps what it said, so the record of the
// removal survives the record.
//
// A deleted entry can come back. Yaara matches what she reports against an
// existing entry by its ref; a ref that no longer exists is recorded as new,
// with a note saying so. That is the correct behaviour — she is reporting
// something she has just read in a document — and it is worth knowing before
// deleting the same thing twice.
// ---------------------------------------------------------------------------

export type EntryKind = 'blocker' | 'dependency'

export interface LoadedEntry {
  kind: EntryKind
  id: string
  /** Blockers only: the handle people say out loud. Shown, never edited. */
  ref?: string
  title?: string
  body?: string
  status: string
  category?: string
  ownerId: string | null
  dueBy?: string | null
  /** "project:abc", or '' — where a blocker is filed. */
  at?: string
  /** What that work is called, for when the live list leaves it out. */
  atLabel?: string
  /** Dependencies: "project:abc" at each end. */
  from?: string
  to?: string
  /**
   * What each end is called, for the one option a picker cannot offer.
   *
   * An end can point at something the live list leaves out — work that has
   * ended, or an `external` thing that only exists as a label on this row.
   * The dialog still has to name it, and naming it after the whole row ("BiS
   * data feed → GPC" in the Delivering box) reads as though one field holds
   * both ends.
   */
  fromLabel?: string
  toLabel?: string
  depKind?: string
  criticality?: string
  description?: string | null
  /** yyyy-mm-dd for a date input. */
  dueDate?: string
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '')

/** The name of whatever an endpoint points at, or null when it is not work. */
async function endpointName(type: string, entityId: string): Promise<string | null> {
  if (!isLevel(type)) return null
  const table = LEVELS[type]
  const [row] = await db.select({ name: table.name }).from(table).where(eq(table.id, entityId)).limit(1)
  return row?.name ?? null
}

/**
 * The record as it stands, for the dialog to open on.
 *
 * Read here rather than carried in the row, so the dialog always opens on what
 * is in the database rather than on whatever the page was rendered with. Two
 * people editing the same blocker an hour apart is not a race worth locking
 * for, but showing the second one a stale form would be.
 */
export async function loadRegisterEntry(kind: EntryKind, id: string): Promise<LoadedEntry | { error: string }> {
  if (kind === 'blocker') {
    const [row] = await db.select().from(decisions).where(eq(decisions.id, id)).limit(1)
    if (!row) return { error: 'That entry no longer exists — reload the page.' }
    return {
      kind,
      id: row.id,
      ref: row.ref,
      title: row.title,
      body: row.body,
      status: row.status,
      category: row.category,
      ownerId: row.ownerId,
      dueBy: row.dueBy,
      at: row.entityType && row.entityId ? `${row.entityType}:${row.entityId}` : '',
      atLabel:
        row.entityType && row.entityId
          ? ((await endpointName(row.entityType, row.entityId)) ?? 'The work it is filed against')
          : undefined,
    }
  }

  const [row] = await db.select().from(dependencies).where(eq(dependencies.id, id)).limit(1)
  if (!row) return { error: 'That dependency no longer exists — reload the page.' }
  return {
    kind,
    id: row.id,
    status: row.status,
    ownerId: row.ownerId,
    from: `${row.fromType}:${row.fromId}`,
    to: `${row.toType}:${row.toId}`,
    fromLabel: (await endpointName(row.fromType, row.fromId)) ?? row.fromLabel ?? row.fromId,
    toLabel: (await endpointName(row.toType, row.toId)) ?? row.toLabel ?? row.toId,
    depKind: row.kind,
    criticality: row.criticality,
    description: row.description,
    dueDate: day(row.dueDate),
  }
}

const BLOCKER_LABELS = {
  title: 'Title',
  body: 'Detail',
  status: 'Status',
  category: 'Category',
  dueBy: 'Needed by',
  ownerId: 'Owner',
  entityId: 'Filed against',
}

const DEP_LABELS = {
  fromId: 'Delivering',
  toId: 'Waiting',
  kind: 'Kind',
  status: 'Status',
  criticality: 'Criticality',
  dueDate: 'Required by',
  description: 'Notes',
  ownerId: 'Owner',
}

export async function editRegisterEntry(input: {
  kind: EntryKind
  id: string
  title?: string
  body?: string
  status?: string
  category?: string
  ownerId?: string | null
  dueBy?: string | null
  at?: string | null
  from?: string
  to?: string
  depKind?: string
  criticality?: string
  description?: string | null
  dueDate?: string | null
}): Promise<RegisterState> {
  if (input.kind === 'blocker') {
    const [before] = await db.select().from(decisions).where(eq(decisions.id, input.id)).limit(1)
    if (!before) return { error: 'That entry no longer exists — reload the page.' }

    const checked = blockerPatch(input)
    if (!checked.ok) return { error: checked.error.message }
    const next = checked.value

    if (next.level && next.entityId && !(await entityExists(next.level as Level, next.entityId))) {
      return { error: 'That record no longer exists — reload the page.' }
    }

    const closing = next.status === 'decided' || next.status === 'dropped'
    await db
      .update(decisions)
      .set({
        title: next.title,
        body: next.body,
        status: next.status,
        category: next.category,
        ownerId: next.ownerId,
        // An owner picked from the roster replaces a free-text one; leaving
        // both would show two owners on a row that has one.
        ownerText: next.ownerId ? null : before.ownerText,
        dueBy: next.dueBy,
        entityType: next.level,
        entityId: next.entityId,
        resolvedAt: closing ? (before.resolvedAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(eq(decisions.id, input.id))

    const said = describeChange(before, { ...next, entityId: next.entityId }, BLOCKER_LABELS)
    if (said.length) {
      await logChange({
        actor: await actorName(),
        kind: 'change',
        summary: `${before.ref}: edited — ${said[0]}`,
        detail: said.join('; ').slice(0, 400),
        entityType: next.level,
        entityId: next.entityId,
      })
    }

    refreshBoth(before.entityType, before.entityId, next.level, next.entityId)
    return { ok: true, stamp: Date.now(), message: said.length ? 'Saved.' : 'Nothing changed.' }
  }

  const [before] = await db.select().from(dependencies).where(eq(dependencies.id, input.id)).limit(1)
  if (!before) return { error: 'That dependency no longer exists — reload the page.' }

  const checked = dependencyPatch({ ...input, kind: input.depKind })
  if (!checked.ok) return { error: checked.error.message }
  const next = checked.value

  /*
   * A label belongs to the endpoint it was written for.
   *
   * `fromLabel`/`toLabel` name an `external` end — a vendor feed, another
   * org's deliverable — because there is no record to read a name from. Move
   * that end onto a real workstream and the old label is not just redundant,
   * it is wrong: the page prefers the stored label when it has one, so the row
   * would go on calling a workstream "BiS data feed".
   */
  const moved = (a: string, b: string, c: string, d: string) => a !== c || b !== d
  await db
    .update(dependencies)
    .set({
      ...next,
      ...(moved(before.fromType, before.fromId, next.fromType, next.fromId) ? { fromLabel: null } : {}),
      ...(moved(before.toType, before.toId, next.toType, next.toId) ? { toLabel: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(dependencies.id, input.id))

  const said = describeChange(before, next, DEP_LABELS)
  if (said.length) {
    await logChange({
      actor: await actorName(),
      kind: 'change',
      summary: `Dependency edited — ${said[0]}`,
      detail: said.join('; ').slice(0, 400),
    })
  }

  refreshBoth(before.fromType, before.fromId, next.fromType, next.fromId)
  refreshBoth(before.toType, before.toId, next.toType, next.toId)
  return { ok: true, stamp: Date.now(), message: said.length ? 'Saved.' : 'Nothing changed.' }
}

export async function deleteRegisterEntry(kind: EntryKind, id: string): Promise<RegisterState> {
  if (kind === 'blocker') {
    const [before] = await db.select().from(decisions).where(eq(decisions.id, id)).limit(1)
    if (!before) return { error: 'That entry no longer exists — reload the page.' }

    await db.delete(decisions).where(eq(decisions.id, id))
    await logChange({
      actor: await actorName(),
      kind: 'change',
      // The title goes in the summary on purpose: after the row is gone this
      // line is the only place the thing is named.
      summary: `${before.ref}: ${before.kind} deleted — ${before.title.slice(0, 80)}`,
      detail: before.body.slice(0, 400),
      entityType: before.entityType,
      entityId: before.entityId,
    })
    refreshBoth(before.entityType, before.entityId, null, null)
    return { ok: true, stamp: Date.now(), message: `${before.ref} deleted.` }
  }

  const [before] = await db.select().from(dependencies).where(eq(dependencies.id, id)).limit(1)
  if (!before) return { error: 'That dependency no longer exists — reload the page.' }

  await db.delete(dependencies).where(eq(dependencies.id, id))
  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: 'Dependency deleted',
    detail: before.description?.slice(0, 400) ?? null,
  })
  refreshBoth(before.fromType, before.fromId, before.toType, before.toId)
  return { ok: true, stamp: Date.now(), message: 'Deleted.' }
}

/**
 * Both ends of a move.
 *
 * A record that changes which work it is filed against leaves one detail page
 * and arrives on another, and revalidating only where it landed leaves it
 * visible on the page it left until something else happens to rebuild that
 * page.
 */
function refreshBoth(
  wasLevel: string | null,
  wasId: string | null,
  isLevel: string | null,
  isId: string | null,
) {
  const seen = new Set<string>()
  for (const [level, id] of [
    [wasLevel, wasId],
    [isLevel, isId],
  ] as const) {
    if (!level || !id) continue
    const key = `${level}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    refresh(level, id)
  }
  // Nothing was filed at either end — a dependency on an external thing, or a
  // blocker against nothing in particular — but the registers still changed.
  if (seen.size === 0) refresh('', '')
}
