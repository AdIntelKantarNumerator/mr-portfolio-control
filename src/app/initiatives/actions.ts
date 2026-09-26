'use server'

/**
 * Creating initiatives, and deciding which projects belong to them.
 *
 * WHY GROUPING IS ITS OWN SCREEN
 *
 * An initiative is the only tier in this app with no source of truth outside
 * it. Projects and workstreams arrive from trackers; initiatives are somebody's
 * judgement that five to ten projects add up to one thing worth reporting as
 * one thing. That judgement has to be made somewhere, and until it is, every
 * project sits in the "not in an initiative" panel on the home page, visible
 * and uncomfortable — which is the point.
 *
 * ASSIGNMENT IS A MOVE, NOT A COPY
 *
 * A project has one initiative or none. `assignProject` sets the column; there
 * is no join table and no multi-parent story, because the home page's rollups
 * assume each project's numbers are counted exactly once. The day a project can
 * belong to two initiatives is the day "how is this initiative doing" has two
 * answers.
 *
 * Every change lands in the changelog with the old value, because regrouping is
 * the kind of edit that looks wrong three weeks later and nobody remembers
 * doing.
 */
import { revalidatePath } from 'next/cache'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { groupingSuggestions, initiatives, projects } from '@/db/schema'
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
   * ticked — which is how the first test of this screen created an initiative
   * containing a project the person had already moved somewhere else. The
   * stamp changes every time, so the form clears every time.
   */
  stamp?: number
}

const STATUSES = new Set(['active', 'paused', 'completed', 'canceled'])

function refresh(id?: string) {
  try {
    revalidatePath('/')
    revalidatePath('/initiatives')
    revalidatePath('/projects')
    revalidatePath('/changes')
    if (id) revalidatePath(`/initiatives/${id}`)
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
  const base = slugify(name) || 'initiative'
  const taken = new Set((await db.select({ key: initiatives.key }).from(initiatives)).map((r) => r.key))
  if (!taken.has(base)) return base
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

export async function createInitiative(_prev: GroupState, formData: FormData): Promise<GroupState> {
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const picked = formData.getAll('projectIds').map(String).filter(Boolean)

  if (name.length < 3) return { error: 'Give the initiative a name — at least three characters.' }
  if (name.length > 200) return { error: 'That name is too long for a card.' }

  const who = await actorName()
  const key = await freeKey(name)

  const [row] = await db
    .insert(initiatives)
    .values({ key, name, description: description || null, status: 'active' })
    .returning({ id: initiatives.id })

  let moved = 0
  if (picked.length > 0) {
    const rows = await db
      .select({ id: projects.id, name: projects.name, initiativeId: projects.initiativeId })
      .from(projects)
      .where(inArray(projects.id, picked))

    await db.update(projects).set({ initiativeId: row.id, updatedAt: new Date() }).where(inArray(projects.id, picked))
    moved = rows.length

    await logChange({
      actor: who,
      kind: 'change',
      summary: `${name}: created with ${moved} project${moved === 1 ? '' : 's'}`,
      detail: rows.map((p) => `${p.name}${p.initiativeId ? ' (moved from another initiative)' : ''}`).join('\n'),
      entityType: 'initiative',
      entityId: row.id,
    })
  } else {
    await logChange({
      actor: who,
      kind: 'change',
      summary: `${name}: initiative created`,
      entityType: 'initiative',
      entityId: row.id,
    })
  }

  refresh(row.id)
  return { ok: true, stamp: Date.now(), message: moved ? `Created, with ${moved} project${moved === 1 ? '' : 's'}.` : 'Created.' }
}

/**
 * Move projects into an initiative, or out of every initiative.
 *
 * One action for both directions: an empty `initiativeId` means ungroup. Two
 * actions would be two places to write the changelog line, and they would
 * disagree within a month.
 */
export async function assignProjects(_prev: GroupState, formData: FormData): Promise<GroupState> {
  const target = String(formData.get('initiativeId') ?? '').trim()
  const picked = formData.getAll('projectIds').map(String).filter(Boolean)

  if (picked.length === 0) return { error: 'Pick at least one project.' }

  let initiativeName = 'no initiative'
  if (target) {
    const [init] = await db.select().from(initiatives).where(eq(initiatives.id, target)).limit(1)
    if (!init) return { error: 'That initiative no longer exists — reload the page.' }
    initiativeName = init.name
  }

  const rows = await db
    .select({ id: projects.id, name: projects.name, initiativeId: projects.initiativeId })
    .from(projects)
    .where(inArray(projects.id, picked))

  if (rows.length === 0) return { error: 'None of those projects exist any more.' }

  // Projects already where they are being sent are dropped here rather than
  // written and logged. Writing them is harmless; logging them is not — a
  // changelog line reading "X: Platform → Platform" is a move that never
  // happened, and the changelog is the one record in this app that is supposed
  // to be literally true.
  const moving = rows.filter((p) => (p.initiativeId ?? '') !== target)
  const already = rows.length - moving.length
  if (moving.length === 0) {
    return {
      ok: true,
      stamp: Date.now(),
      message: `Already in ${initiativeName} — nothing to move.`,
    }
  }

  const before = new Map(
    (await db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives)).map((i) => [i.id, i.name]),
  )

  await db
    .update(projects)
    .set({ initiativeId: target || null, updatedAt: new Date() })
    .where(
      inArray(
        projects.id,
        moving.map((p) => p.id),
      ),
    )

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `${moving.length} project${moving.length === 1 ? '' : 's'} moved to ${initiativeName}`,
    detail: moving
      .map((p) => `${p.name}: ${p.initiativeId ? (before.get(p.initiativeId) ?? 'unknown') : 'ungrouped'} → ${initiativeName}`)
      .join('\n'),
    entityType: 'initiative',
    entityId: target || null,
  })

  refresh(target || undefined)
  return {
    ok: true,
    stamp: Date.now(),
    message: `Moved ${moving.length} to ${initiativeName}${already ? ` (${already} already there)` : ''}.`,
  }
}

/** Rename, re-describe, or end an initiative. Never deletes — see the note below. */
export async function editInitiative(_prev: GroupState, formData: FormData): Promise<GroupState> {
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const status = String(formData.get('status') ?? '').trim()

  const [row] = await db.select().from(initiatives).where(eq(initiatives.id, id)).limit(1)
  if (!row) return { error: 'That initiative no longer exists.' }
  if (name.length < 3) return { error: 'The name needs at least three characters.' }
  if (status && !STATUSES.has(status)) return { error: 'Unknown status.' }

  const changes: string[] = []
  if (name !== row.name) changes.push(`name: ${row.name} → ${name}`)
  if ((description || null) !== row.description) changes.push('description edited')
  if (status && status !== row.status) changes.push(`status: ${row.status} → ${status}`)
  if (changes.length === 0) return { ok: true, stamp: Date.now(), message: 'Nothing changed.' }

  await db
    .update(initiatives)
    .set({
      name,
      description: description || null,
      ...(status ? { status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(initiatives.id, id))

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `${row.name}: initiative edited`,
    detail: changes.join('\n'),
    entityType: 'initiative',
    entityId: id,
  })

  refresh(id)
  return { ok: true, stamp: Date.now(), message: 'Saved.' }
}


/**
 * Accepting one of Yaara's groupings.
 *
 * This is the only place a suggestion turns into anything. She writes
 * proposals; the initiative is created here, by a named person, from the
 * button they clicked — which is why the changelog line says who, and why the
 * suggestion keeps a pointer to what it became.
 *
 * The name is editable on the way through: her proposed name is a guess at
 * what the room calls this, and the person accepting usually knows better.
 * Projects that have been grouped elsewhere since she proposed are moved
 * anyway — accepting is an explicit instruction — but they are named in the
 * record so the move is not silent.
 */
export async function acceptSuggestion(_prev: GroupState, formData: FormData): Promise<GroupState> {
  const id = String(formData.get('id') ?? '')
  const override = String(formData.get('name') ?? '').trim()

  const [row] = await db.select().from(groupingSuggestions).where(eq(groupingSuggestions.id, id)).limit(1)
  if (!row) return { error: 'That suggestion no longer exists.' }
  if (row.status !== 'pending') return { error: `Already ${row.status}.` }

  const ids = row.projectIds.split(',').filter(Boolean)
  const rows = await db
    .select({ id: projects.id, name: projects.name, initiativeId: projects.initiativeId })
    .from(projects)
    .where(inArray(projects.id, ids))

  if (rows.length === 0) {
    return { error: 'Every project in that suggestion has since been removed. Dismiss it instead.' }
  }

  const name = (override || row.name).slice(0, 200)
  const who = await actorName()
  const key = await freeKey(name)

  const [created] = await db
    .insert(initiatives)
    .values({ key, name, description: row.rationale, status: 'active' })
    .returning({ id: initiatives.id })

  await db
    .update(projects)
    .set({ initiativeId: created.id, updatedAt: new Date() })
    .where(
      inArray(
        projects.id,
        rows.map((p) => p.id),
      ),
    )

  await db
    .update(groupingSuggestions)
    .set({ status: 'accepted', decidedBy: who, decidedAt: new Date(), initiativeId: created.id })
    .where(eq(groupingSuggestions.id, id))

  const missing = ids.length - rows.length
  const regrouped = rows.filter((p) => p.initiativeId)

  await logChange({
    actor: who,
    kind: 'change',
    summary: `${name}: created from ${row.agent}'s suggestion`,
    detail: [
      override && override !== row.name ? `renamed from her "${row.name}"` : null,
      row.rationale ? `her reason: ${row.rationale}` : null,
      `projects: ${rows.map((p) => p.name).join(', ')}`,
      regrouped.length ? `moved out of another initiative: ${regrouped.map((p) => p.name).join(', ')}` : null,
      missing ? `${missing} project(s) in the suggestion no longer exist` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    entityType: 'initiative',
    entityId: created.id,
  })

  refresh(created.id)
  return {
    ok: true,
    stamp: Date.now(),
    message: `Created ${name} with ${rows.length} project${rows.length === 1 ? '' : 's'}.`,
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
