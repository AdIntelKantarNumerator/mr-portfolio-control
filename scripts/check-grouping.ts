/**
 * Exercise the objective grouping actions against a real database.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/check-grouping.ts
 *
 * Same reasoning as check-entity-route.ts: the rules worth testing here are
 * rules about what reaches the database — an initiative belongs to exactly one
 * objective, a move is recorded with where it came from, and a move that
 * changes nothing is not recorded at all — and only a database can confirm
 * those.
 *
 * It writes test rows and leaves them. Point it at a scratch database.
 */
import { assignInitiatives, createObjective, editObjective } from '../src/app/objectives/actions'
import { db } from '../src/db/client'
import { objectives, initiatives, changelogEntries } from '../src/db/schema'
import { desc, eq, inArray, like } from 'drizzle-orm'

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

async function objectiveOf(id: string): Promise<string | null> {
  const [row] = await db.select({ i: initiatives.objectiveId }).from(initiatives).where(eq(initiatives.id, id)).limit(1)
  return row?.i ?? null
}

async function logLines(entityId: string): Promise<{ summary: string; detail: string | null }[]> {
  return db
    .select({ summary: changelogEntries.summary, detail: changelogEntries.detail })
    .from(changelogEntries)
    .where(eq(changelogEntries.entityId, entityId))
    .orderBy(desc(changelogEntries.at))
}

async function main() {
  // Re-runnable: the previous run's rows are removed first. A check you have to
  // drop a database to run twice is a check that gets run once.
  await db.delete(changelogEntries).where(eq(changelogEntries.entityType, 'objective'))
  await db.update(initiatives).set({ objectiveId: null }).where(inArray(initiatives.id, ['gp1', 'gp2', 'gp3']))
  await db.delete(objectives).where(like(objectives.name, 'Ad Intelligence%'))
  await db.delete(initiatives).where(inArray(initiatives.id, ['gp1', 'gp2', 'gp3']))

  await db.insert(initiatives).values([
    { id: 'gp1', key: 'GP-1', name: 'Creative Capture', status: 'active', sortOrder: 1 },
    { id: 'gp2', key: 'GP-2', name: 'Logo Rec Tech', status: 'active', sortOrder: 2 },
    { id: 'gp3', key: 'GP-3', name: 'Nielsen Migration', status: 'active', sortOrder: 3 },
  ] as never)

  // --- create, with initiatives picked in the same gesture ---
  let s = await createObjective({}, form({ name: 'Ad Intelligence Platform', initiativeIds: ['gp1', 'gp2'] }))
  check('creating with initiatives reports how many moved', s.ok === true && /2 initiatives/.test(s.message ?? ''), s.message)

  const [alpha] = await db.select().from(objectives).where(eq(objectives.name, 'Ad Intelligence Platform')).limit(1)
  check('the objective exists', Boolean(alpha))
  check('it has a key of its own', Boolean(alpha?.key), alpha?.key)
  check('both initiatives point at it', (await objectiveOf('gp1')) === alpha.id && (await objectiveOf('gp2')) === alpha.id)
  check('the third is untouched', (await objectiveOf('gp3')) === null)

  // --- a name that collides gets its own key rather than failing ---
  s = await createObjective({}, form({ name: 'Ad Intelligence Platform' }))
  const twins = await db.select().from(objectives).where(eq(objectives.name, 'Ad Intelligence Platform'))
  check('a duplicate name is allowed', s.ok === true && twins.length === 2)
  check('and the keys differ', new Set(twins.map((t) => t.key)).size === 2, twins.map((t) => t.key).join(', '))
  const beta = twins.find((t) => t.id !== alpha.id)!

  // --- moving: the old parent is named in the record ---
  s = await assignInitiatives({}, form({ objectiveId: beta.id, initiativeIds: ['gp1'] }))
  check('the move is reported', s.ok === true && /Moved 1/.test(s.message ?? ''), s.message)
  check('the initiative moved', (await objectiveOf('gp1')) === beta.id)
  const moveLog = (await logLines(beta.id))[0]
  check(
    'the record says where it came from',
    /Creative Capture: Ad Intelligence Platform → Ad Intelligence Platform/.test(moveLog?.detail ?? ''),
    moveLog?.detail ?? '',
  )

  // --- a move that changes nothing is not recorded ---
  const beforeCount = (await logLines(beta.id)).length
  s = await assignInitiatives({}, form({ objectiveId: beta.id, initiativeIds: ['gp1'] }))
  check('a no-op move says so', s.ok === true && /nothing to move/i.test(s.message ?? ''), s.message)
  check('and writes no changelog line', (await logLines(beta.id)).length === beforeCount)

  // --- a mixed batch moves only what actually changes ---
  s = await assignInitiatives({}, form({ objectiveId: beta.id, initiativeIds: ['gp1', 'gp3'] }))
  check('a mixed batch counts only the real moves', /Moved 1 .*1 already there/.test(s.message ?? ''), s.message)
  check('the one that needed moving did', (await objectiveOf('gp3')) === beta.id)

  // --- ungrouping ---
  s = await assignInitiatives({}, form({ objectiveId: '', initiativeIds: ['gp3'] }))
  check('an initiative can be removed from every objective', s.ok === true && (await objectiveOf('gp3')) === null)

  // --- refusals ---
  s = await assignInitiatives({}, form({ objectiveId: beta.id }))
  check('a move with nothing picked is refused', Boolean(s.error), s.error)
  s = await assignInitiatives({}, form({ objectiveId: 'no-such-objective', initiativeIds: ['gp2'] }))
  check('a move into a deleted objective is refused', Boolean(s.error), s.error)
  check('and nothing moved', (await objectiveOf('gp2')) === alpha.id)
  s = await createObjective({}, form({ name: 'ab' }))
  check('a two-character name is refused', Boolean(s.error), s.error)

  // --- editing ---
  s = await editObjective({}, form({ id: alpha.id, name: 'Ad Intelligence', description: 'Renamed', status: 'paused' }))
  check('an edit is saved', s.ok === true, s.message)
  const [edited] = await db.select().from(objectives).where(eq(objectives.id, alpha.id)).limit(1)
  check('the new values are in the row', edited.name === 'Ad Intelligence' && edited.status === 'paused')
  const editLog = (await logLines(alpha.id))[0]
  check(
    'the record names the old value',
    /name: Ad Intelligence Platform → Ad Intelligence/.test(editLog?.detail ?? ''),
    editLog?.detail ?? '',
  )
  s = await editObjective({}, form({ id: alpha.id, name: 'Ad Intelligence', description: 'Renamed', status: 'paused' }))
  check('re-saving the same values records nothing', /Nothing changed/.test(s.message ?? ''), s.message)
  s = await editObjective({}, form({ id: alpha.id, name: 'Ad Intelligence', status: 'exploded' }))
  check('an unknown status is refused', Boolean(s.error), s.error)

  console.log('\nDone.')
  process.exit(process.exitCode ?? 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
