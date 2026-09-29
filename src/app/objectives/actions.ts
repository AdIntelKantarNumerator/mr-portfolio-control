'use server'

/**
 * Creating objectives, and deciding which initiatives belong to them.
 *
 * WHY GROUPING IS ITS OWN SCREEN
 *
 * An objective is the only tier in this app with no source of truth outside
 * it. Initiatives and projects arrive from trackers; objectives are somebody's
 * judgement that five to ten initiatives add up to one thing worth reporting as
 * one thing. That judgement has to be made somewhere, and until it is, every
 * initiative sits in the "not in an objective" panel on the home page, visible
 * and uncomfortable — which is the point.
 *
 * ASSIGNMENT IS A MOVE, NOT A COPY
 *
 * An initiative has one objective or none. `assignInitiative` sets the column; there
 * is no join table and no multi-parent story, because the home page's rollups
 * assume each initiative's numbers are counted exactly once. The day an initiative can
 * belong to two objectives is the day "how is this objective doing" has two
 * answers.
 *
 * Every change lands in the changelog with the old value, because regrouping is
 * the kind of edit that looks wrong three weeks later and nobody remembers
 * doing.
 */
import { revalidatePath } from 'next/cache'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { groupingSuggestions, objectives, initiatives } from '@/db/schema'
import { logChange } from '@/lib/portfolio'
import { actorName } from '@/lib/auth/current-user'
import { slugify } from '@/lib/util'

export interface GroupState {
  ok?: boolean
  error?: string
  message?: string
  /**
   * A new value on every successful save.
   *
   * `ok: true` stays true across two saves in a row, so the form cannot tell
   * "it worked" from "it worked again" and leaves the previous selection
   * ticked — which is how the first test of this screen created an objective
   * containing an initiative the person had already moved somewhere else. The
   * stamp changes every time, so the form clears every time.
   */
  stamp?: number
}

const STATUSES = new Set(['active', 'paused', 'completed', 'canceled'])

function refresh(id?: string) {
  try {
    revalidatePath('/')
    revalidatePath('/objectives')
    revalidatePath('/initiatives')
    revalidatePath('/changes')
    if (id) revalidatePath(`/objectives/${id}`)
  } catch (err) {
    // revalidatePath needs a request context and throws this one invariant
    // without it. The only caller with no request is scripts/check-grouping.ts,
    // which is testing what reaches the database, not what reaches the cache.
    // Every other error still propagates: a cache that silently stopped
    // clearing would show stale cards for as long as nobody noticed.
    if (!(err instanceof Error) || !/static generation store/i.test(err.message)) throw err
  }
}

/** A key nobody else has. Collisions are resolved by suffix, never by failing. */
async function freeKey(name: string): Promise<string> {
  const base = slugify(name) || 'objective'
  const taken = new Set((await db.select({ key: objectives.key }).from(objectives)).map((r) => r.key))
  if (!taken.has(base)) return base
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

export async function createObjective(_prev: GroupState, formData: FormData): Promise<GroupState> {
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const picked = formData.getAll('initiativeIds').map(String).filter(Boolean)

  if (name.length < 3) return { error: 'Give the objective a name — at least three characters.' }
  if (name.length > 200) return { error: 'That name is too long for a card.' }

  const who = await actorName()
  const key = await freeKey(name)

  const [row] = await db
    .insert(objectives)
    .values({ key, name, description: description || null, status: 'active' })
    .returning({ id: objectives.id })

  let moved = 0
  if (picked.length > 0) {
    const rows = await db
      .select({ id: initiatives.id, name: initiatives.name, objectiveId: initiatives.objectiveId })
      .from(initiatives)
      .where(inArray(initiatives.id, picked))

    await db.update(initiatives).set({ objectiveId: row.id, updatedAt: new Date() }).where(inArray(initiatives.id, picked))
    moved = rows.length

    await logChange({
      actor: who,
      kind: 'change',
      summary: `${name}: created with ${moved} initiative${moved === 1 ? '' : 's'}`,
      detail: rows.map((p) => `${p.name}${p.objectiveId ? ' (moved from another objective)' : ''}`).join('\n'),
      entityType: 'objective',
      entityId: row.id,
    })
  } else {
    await logChange({
      actor: who,
      kind: 'change',
      summary: `${name}: objective created`,
      entityType: 'objective',
      entityId: row.id,
    })
  }

  refresh(row.id)
  return { ok: true, stamp: Date.now(), message: moved ? `Created, with ${moved} initiative${moved === 1 ? '' : 's'}.` : 'Created.' }
}

/**
 * Move initiatives into an objective, or out of every objective.
 *
 * One action for both directions: an empty `objectiveId` means ungroup. Two
 * actions would be two places to write the changelog line, and they would
 * disagree within a month.
 */
export async function assignInitiatives(_prev: GroupState, formData: FormData): Promise<GroupState> {
  const target = String(formData.get('objectiveId') ?? '').trim()
  const picked = formData.getAll('initiativeIds').map(String).filter(Boolean)

  if (picked.length === 0) return { error: 'Pick at least one initiative.' }

  let objectiveName = 'no objective'
  if (target) {
    const [init] = await db.select().from(objectives).where(eq(objectives.id, target)).limit(1)
    if (!init) return { error: 'That objective no longer exists — reload the page.' }
    objectiveName = init.name
  }

  const rows = await db
    .select({ id: initiatives.id, name: initiatives.name, objectiveId: initiatives.objectiveId })
    .from(initiatives)
    .where(inArray(initiatives.id, picked))

  if (rows.length === 0) return { error: 'None of those initiatives exist any more.' }

  // Initiatives already where they are being sent are dropped here rather than
  // written and logged. Writing them is harmless; logging them is not — a
  // changelog line reading "X: Platform → Platform" is a move that never
  // happened, and the changelog is the one record in this app that is supposed
  // to be literally true.
  const moving = rows.filter((p) => (p.objectiveId ?? '') !== target)
  const already = rows.length - moving.length
  if (moving.length === 0) {
    return {
      ok: true,
      stamp: Date.now(),
      message: `Already in ${objectiveName} — nothing to move.`,
    }
  }

  const before = new Map(
    (await db.select({ id: objectives.id, name: objectives.name }).from(objectives)).map((i) => [i.id, i.name]),
  )

  await db
    .update(initiatives)
    .set({ objectiveId: target || null, updatedAt: new Date() })
    .where(
      inArray(
        initiatives.id,
        moving.map((p) => p.id),
      ),
    )

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `${moving.length} initiative${moving.length === 1 ? '' : 's'} moved to ${objectiveName}`,
    detail: moving
      .map((p) => `${p.name}: ${p.objectiveId ? (before.get(p.objectiveId) ?? 'unknown') : 'ungrouped'} → ${objectiveName}`)
      .join('\n'),
    entityType: 'objective',
    entityId: target || null,
  })

  refresh(target || undefined)
  return {
    ok: true,
    stamp: Date.now(),
    message: `Moved ${moving.length} to ${objectiveName}${already ? ` (${already} already there)` : ''}.`,
  }
}

/** Rename, re-describe, or end an objective. Never deletes — see the note below. */
export async function editObjective(_prev: GroupState, formData: FormData): Promise<GroupState> {
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const status = String(formData.get('status') ?? '').trim()

  const [row] = await db.select().from(objectives).where(eq(objectives.id, id)).limit(1)
  if (!row) return { error: 'That objective no longer exists.' }
  if (name.length < 3) return { error: 'The name needs at least three characters.' }
  if (status && !STATUSES.has(status)) return { error: 'Unknown status.' }

  const changes: string[] = []
  if (name !== row.name) changes.push(`name: ${row.name} → ${name}`)
  if ((description || null) !== row.description) changes.push('description edited')
  if (status && status !== row.status) changes.push(`status: ${row.status} → ${status}`)
  if (changes.length === 0) return { ok: true, stamp: Date.now(), message: 'Nothing changed.' }

  await db
    .update(objectives)
    .set({
      name,
      description: description || null,
      ...(status ? { status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(objectives.id, id))

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `${row.name}: objective edited`,
    detail: changes.join('\n'),
    entityType: 'objective',
    entityId: id,
  })

  refresh(id)
  return { ok: true, stamp: Date.now(), message: 'Saved.' }
}


/**
 * Accepting one of Yaara's groupings.
 *
 * This is the only place a suggestion turns into anything. She writes
 * proposals; the objective is created here, by a named person, from the
 * button they clicked — which is why the changelog line says who, and why the
 * suggestion keeps a pointer to what it became.
 *
 * The name is editable on the way through: her proposed name is a guess at
 * what the room calls this, and the person accepting usually knows better.
 * Initiatives that have been grouped elsewhere since she proposed are moved
 * anyway — accepting is an explicit instruction — but they are named in the
 * record so the move is not silent.
 */
export async function acceptSuggestion(_prev: GroupState, formData: FormData): Promise<GroupState> {
  const id = String(formData.get('id') ?? '')
  const override = String(formData.get('name') ?? '').trim()

  const [row] = await db.select().from(groupingSuggestions).where(eq(groupingSuggestions.id, id)).limit(1)
  if (!row) return { error: 'That suggestion no longer exists.' }
  if (row.status !== 'pending') return { error: `Already ${row.status}.` }

  const ids = row.initiativeIds.split(',').filter(Boolean)
  const rows = await db
    .select({ id: initiatives.id, name: initiatives.name, objectiveId: initiatives.objectiveId })
    .from(initiatives)
    .where(inArray(initiatives.id, ids))

  if (rows.length === 0) {
    return { error: 'Every initiative in that suggestion has since been removed. Dismiss it instead.' }
  }

  const name = (override || row.name).slice(0, 200)
  const who = await actorName()
  const key = await freeKey(name)

  const [created] = await db
    .insert(objectives)
    .values({ key, name, description: row.rationale, status: 'active' })
    .returning({ id: objectives.id })

  await db
    .update(initiatives)
    .set({ objectiveId: created.id, updatedAt: new Date() })
    .where(
      inArray(
        initiatives.id,
        rows.map((p) => p.id),
      ),
    )

  await db
    .update(groupingSuggestions)
    .set({ status: 'accepted', decidedBy: who, decidedAt: new Date(), objectiveId: created.id })
    .where(eq(groupingSuggestions.id, id))

  const missing = ids.length - rows.length
  const regrouped = rows.filter((p) => p.objectiveId)

  await logChange({
    actor: who,
    kind: 'change',
    summary: `${name}: created from ${row.agent}'s suggestion`,
    detail: [
      override && override !== row.name ? `renamed from her "${row.name}"` : null,
      row.rationale ? `her reason: ${row.rationale}` : null,
      `initiatives: ${rows.map((p) => p.name).join(', ')}`,
      regrouped.length ? `moved out of another objective: ${regrouped.map((p) => p.name).join(', ')}` : null,
      missing ? `${missing} initiative(s) in the suggestion no longer exist` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    entityType: 'objective',
    entityId: created.id,
  })

  refresh(created.id)
  return {
    ok: true,
    stamp: Date.now(),
    message: `Created ${name} with ${rows.length} initiative${rows.length === 1 ? '' : 's'}.`,
  }
}

/**
 * Saying no.
 *
 * The row stays, marked dismissed, and the agent route refuses to propose the
 * same set again. Deleting it instead would lose the only record that the
 * question was asked and answered, and she would ask again the same night.
 */
export async function dismissSuggestion(_prev: GroupState, formData: FormData): Promise<GroupState> {
  const id = String(formData.get('id') ?? '')

  const [row] = await db.select().from(groupingSuggestions).where(eq(groupingSuggestions.id, id)).limit(1)
  if (!row) return { error: 'That suggestion no longer exists.' }
  if (row.status !== 'pending') return { error: `Already ${row.status}.` }

  const who = await actorName()
  await db
    .update(groupingSuggestions)
    .set({ status: 'dismissed', decidedBy: who, decidedAt: new Date() })
    .where(eq(groupingSuggestions.id, id))

  await logChange({
    actor: who,
    kind: 'note',
    summary: `Grouping suggestion dismissed: ${row.name}`,
    detail: row.rationale ? `her reason was: ${row.rationale}` : null,
  })

  refresh()
  return { ok: true, stamp: Date.now(), message: 'Dismissed — she will not suggest that set again.' }
}
