/**
 * A person's edit to an assessment, and what happens to it when Yaara writes
 * again.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/check-assessment-handover.ts
 *
 * The rule: an edit stands until there is fresh evidence, and then her new
 * reading replaces it. A correction is worth making because the card is wrong
 * today, not because it should be frozen for good.
 *
 * WHY THIS NEEDS A DATABASE
 *
 * The whole behaviour is which rows are live. Both halves of it — that her
 * post retires what was there, and that the card then reads hers — are
 * statements about rows, and only a database can confirm a row is not there.
 *
 * WHAT IT CAUGHT
 *
 * Her post retired only rows whose `agent` matched hers. Editing a card she
 * had already written was fine; writing the FIRST assessment on a card she
 * had not reached stored an observation authored by the person, which she
 * then never superseded. Two rows live, and the card took whichever had the
 * newer `generatedAt` — which is the caller's to set, so a Friday deck read
 * on Monday lost to a hand-written sentence from Saturday, permanently.
 *
 * It writes test rows and clears its own from a previous run first. Point it
 * at a scratch database.
 */
import { POST as observe } from '../src/app/api/agent/observations/route'
import { db } from '../src/db/client'
import { agentObservations, objectives, initiatives } from '../src/db/schema'
import { and, desc, eq, isNull, like } from 'drizzle-orm'

const TOKEN = process.env.SYNC_TOKEN ?? 'test-token'
const MARK = 'handover-check'

function req(body: unknown) {
  return new Request('http://x/api/agent/observations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  })
}

let failures = 0
function check(what: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ok    ${what}`)
  else {
    failures++
    console.log(`  FAIL  ${what}${detail ? `\n        ${detail}` : ''}`)
  }
}

/** The one the card would show: newest live observation for that entity. */
async function shown(entityId: string) {
  const [row] = await db
    .select()
    .from(agentObservations)
    .where(and(eq(agentObservations.entityId, entityId), isNull(agentObservations.supersededAt)))
    .orderBy(desc(agentObservations.generatedAt))
    .limit(1)
  return row ?? null
}

async function liveCount(entityId: string) {
  const rows = await db
    .select({ id: agentObservations.id })
    .from(agentObservations)
    .where(and(eq(agentObservations.entityId, entityId), isNull(agentObservations.supersededAt)))
  return rows.length
}

async function main() {
  // --- a scratch objective and initiative of our own ------------------------
  await db.delete(initiatives).where(like(initiatives.key, `${MARK}%`))
  await db.delete(objectives).where(like(objectives.key, `${MARK}%`))

  const [init] = await db
    .insert(objectives)
    .values({ key: `${MARK}-init`, name: `${MARK} objective`, status: 'active' })
    .returning()
  const [proj] = await db
    .insert(initiatives)
    .values({ key: `${MARK}-proj`, name: `${MARK} initiative`, status: 'active', objectiveId: init.id })
    .returning()

  // --- she has written one, a person corrects it --------------------------
  console.log('\nan edit to an assessment she already wrote')
  await observe(
    req({ entityType: 'objective', entityId: init.id, agent: 'yaara', summary: 'HERS: first reading.', model: 'test' }),
  )
  const hers = await shown(init.id)
  // The edit, exactly as app/verdict-actions.ts makes it on an existing row.
  await db
    .update(agentObservations)
    .set({ verdict: 'THEIRS: corrected by hand.', verdictBy: 'A Person', verdictAt: new Date() })
    .where(eq(agentObservations.id, hers!.id))
  check('the correction is what the card shows', (await shown(init.id))?.verdict === 'THEIRS: corrected by hand.')

  await observe(
    req({ entityType: 'objective', entityId: init.id, agent: 'yaara', summary: 'HERS: second reading.', model: 'test' }),
  )
  const after = await shown(init.id)
  check('her new reading replaces it', after?.verdict === 'HERS: second reading.', `got: ${after?.verdict}`)
  check('and the byline goes back to her', after?.verdictBy === null)
  check('exactly one observation is live', (await liveCount(init.id)) === 1)

  // --- nobody has assessed it, a person writes the first one --------------
  console.log('\nthe first assessment, written by a person')
  // Exactly what verdict-actions.ts inserts when there is no row to edit:
  // an observation whose author is the person.
  await db.insert(agentObservations).values({
    entityType: 'initiative',
    entityId: proj.id,
    agent: 'A Person',
    items: '[]',
    evidence: '[]',
    verdict: 'THEIRS: nobody had assessed this.',
    verdictBy: 'A Person',
    verdictAt: new Date(),
    model: 'human',
  })
  check('it is what the card shows', (await shown(proj.id))?.verdict === 'THEIRS: nobody had assessed this.')

  await observe(
    req({ entityType: 'initiative', entityId: proj.id, agent: 'yaara', summary: 'HERS: caught up.', model: 'test' }),
  )
  check('her reading replaces it too', (await shown(proj.id))?.verdict === 'HERS: caught up.')
  check('and the hand-written row is retired, not left live beside hers', (await liveCount(proj.id)) === 1)

  // --- the case that made it permanent ------------------------------------
  console.log('\nher reading is backdated to the document she read')
  await db.insert(agentObservations).values({
    entityType: 'initiative',
    entityId: proj.id,
    agent: 'A Person',
    items: '[]',
    evidence: '[]',
    verdict: 'THEIRS: written on Saturday.',
    verdictBy: 'A Person',
    verdictAt: new Date(),
    model: 'human',
  })
  await observe(
    req({
      entityType: 'initiative',
      entityId: proj.id,
      agent: 'yaara',
      summary: 'HERS: from Friday review deck.',
      model: 'test',
      // Older than the hand-written one. She stamps an observation with the
      // date of the document, so this is ordinary, not contrived.
      generatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    }),
  )
  const last = await shown(proj.id)
  check('her older-dated reading still wins', last?.verdict === 'HERS: from Friday review deck.', `got: ${last?.verdict}`)
  check('one live observation, not two', (await liveCount(proj.id)) === 1)

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
