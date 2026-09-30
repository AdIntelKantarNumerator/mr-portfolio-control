/**
 * Close, withdraw, reopen and delete a Strategic Objective against a real
 * database.
 *
 *   DATABASE_URL=pglite:./.data/scratch npx tsx scripts/check-objective-lifecycle.ts
 *
 * The rules worth checking here are about what reaches the database: ending
 * needs a reason and lands in the changelog, the home board drops an ended
 * objective, delete is refused while anything is filed under it, and a delete
 * takes the objective's own records while leaving the register and the
 * changelog alone.
 *
 * It writes test rows. Point it at a scratch database.
 */
import { assignInitiatives, createObjective, deleteObjective } from '../src/app/objectives/actions'
import { setLifecycle } from '../src/app/lifecycle/actions'
import { getHomeCards } from '../src/lib/home'
import { db } from '../src/db/client'
import {
  agentObservations,
  changelogEntries,
  decisions,
  initiatives,
  milestones,
  objectives,
} from '../src/db/schema'
import { and, desc, eq, inArray, like } from 'drizzle-orm'

function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) for (const one of v) fd.append(k, one)
    else fd.set(k, v)
  }
  return fd
}

function check(label: string, ok: boolean, extra = '') {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

/** `redirect()` throws to leave the action; here that throw is the success. */
async function redirected(run: () => Promise<unknown>): Promise<{ redirected: boolean; result?: unknown }> {
  try {
    return { redirected: false, result: await run() }
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? ''
    if (digest.startsWith('NEXT_REDIRECT')) return { redirected: true }
    throw err
  }
}

async function onBoard(id: string): Promise<boolean> {
  const cards = await getHomeCards('objective')
  return cards.some((c: { id: string }) => c.id === id)
}

async function main() {
  const NAME = 'Lifecycle Check Objective'
  await db.update(initiatives).set({ objectiveId: null }).where(inArray(initiatives.id, ['lc1']))
  for (const o of await db.select({ id: objectives.id }).from(objectives).where(like(objectives.name, `${NAME}%`))) {
    await db.delete(changelogEntries).where(eq(changelogEntries.entityId, o.id))
    await db.delete(objectives).where(eq(objectives.id, o.id))
  }
  await db.delete(initiatives).where(inArray(initiatives.id, ['lc1']))
  await db.delete(decisions).where(eq(decisions.ref, 'LC-D1'))
  await db.insert(initiatives).values([{ id: 'lc1', key: 'LC-1', name: 'Lifecycle Check Initiative', status: 'active', sortOrder: 1 }] as never)

  await createObjective({}, form({ name: NAME, initiativeIds: ['lc1'] }))
  const [so] = await db.select().from(objectives).where(eq(objectives.name, NAME)).limit(1)
  check('the objective exists and holds the initiative', Boolean(so))
  check('a live objective is on the home board', await onBoard(so.id))

  // --- closing needs a reason ---
  let s = await setLifecycle({}, form({ kind: 'objective', id: so.id, status: 'completed', note: '' }))
  check('closing without a reason is refused', Boolean(s.error), s.error)

  s = await setLifecycle({}, form({ kind: 'objective', id: so.id, status: 'completed', note: 'Delivered in Q3' }))
  check('closing with a reason works', s.ok === true, s.error)
  const [closed] = await db.select().from(objectives).where(eq(objectives.id, so.id))
  check('status is completed', closed.status === 'completed', closed.status)
  check('a closed objective is off the home board', !(await onBoard(so.id)))
  const [line] = await db
    .select()
    .from(changelogEntries)
    .where(eq(changelogEntries.entityId, so.id))
    .orderBy(desc(changelogEntries.at))
    .limit(1)
  check('the changelog says so, with the reason', /Active → Completed/.test(line?.summary ?? '') && line?.detail === 'Delivered in Q3', line?.summary)

  // --- withdraw from closed is still an ending, reopen is a revival ---
  s = await setLifecycle({}, form({ kind: 'objective', id: so.id, status: 'active', note: 'Scope came back' }))
  check('reopening works', s.ok === true, s.error)
  check('a reopened objective is back on the board', await onBoard(so.id))
  s = await setLifecycle({}, form({ kind: 'objective', id: so.id, status: 'canceled', note: 'Strategy changed' }))
  check('withdrawing works', s.ok === true, s.error)
  check('a withdrawn objective is off the home board', !(await onBoard(so.id)))

  // --- delete is refused while an initiative is filed under it, even a withdrawn objective ---
  s = (await redirected(() => deleteObjective({}, form({ id: so.id, confirmName: NAME })))).result as typeof s
  check('delete is refused while it holds an initiative', Boolean(s?.error) && /1 initiative is still/.test(s?.error ?? ''), s?.error)

  // --- empty it, file some records on it, then delete ---
  await assignInitiatives({}, form({ objectiveId: '', initiativeIds: ['lc1'] }))
  await db.insert(milestones).values({ level: 'objective', entityId: so.id, name: 'LC milestone' } as never)
  await db.insert(agentObservations).values({ entityType: 'objective', entityId: so.id, items: '[]', evidence: '[]', model: 'check' } as never)
  await db.insert(decisions).values({ ref: 'LC-D1', title: 'LC decision', body: 'Check row', entityType: 'objective', entityId: so.id } as never)

  s = (await redirected(() => deleteObjective({}, form({ id: so.id, confirmName: 'wrong name' })))).result as typeof s
  check('delete needs the name typed', Boolean(s?.error), s?.error)

  const done = await redirected(() => deleteObjective({}, form({ id: so.id, confirmName: NAME })))
  check('delete succeeds and redirects', done.redirected)
  check('the objective row is gone', (await db.select().from(objectives).where(eq(objectives.id, so.id))).length === 0)
  check(
    'its milestones are gone',
    (await db.select().from(milestones).where(and(eq(milestones.level, 'objective'), eq(milestones.entityId, so.id)))).length === 0,
  )
  check(
    'its observations are gone',
    (await db.select().from(agentObservations).where(and(eq(agentObservations.entityType, 'objective'), eq(agentObservations.entityId, so.id)))).length === 0,
  )
  const [dec] = await db.select().from(decisions).where(eq(decisions.ref, 'LC-D1'))
  check('its decision stays in the register, unfiled', Boolean(dec) && dec.entityId === null)
  const lines = await db.select().from(changelogEntries).where(eq(changelogEntries.entityId, so.id))
  check('the changelog remembers it, deletion included', lines.some((l) => /deleted/.test(l.summary)), `${lines.length} lines`)
  check('the initiative survived', (await db.select().from(initiatives).where(eq(initiatives.id, 'lc1'))).length === 1)
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
