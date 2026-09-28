/**
 * Exercise the "this is on the wrong work" correction against a real database.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/check-corrections.ts
 *
 * Same reasoning as check-entity-route.ts: the rules worth testing are rules
 * about what reaches the database — a correction pointing at a record that
 * does not exist is refused, one with nothing for a rule to match on is
 * refused before it becomes a rule that claims a whole system, and the same
 * person saying the same thing twice makes one row rather than two.
 *
 * The refusals matter more than the happy path here. A correction that is
 * accepted and then quietly turns into a rule Yaara refuses is a correction
 * somebody believes they made.
 *
 * It writes test rows and leaves them. Point it at a scratch database.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { recordCorrection } from '../src/app/correction-actions'
import { db } from '../src/db/client'
import { initiatives, projects, routingCorrections } from '../src/db/schema'

function check(label: string, ok: boolean, extra = '') {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

async function pending(wrongEntityId: string) {
  return db
    .select()
    .from(routingCorrections)
    .where(and(eq(routingCorrections.wrongEntityId, wrongEntityId), isNull(routingCorrections.consumedAt)))
}

async function main() {
  const all = await db.select({ id: projects.id, name: projects.name }).from(projects).limit(3)
  const [init] = await db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives).limit(1)
  const [proj, other] = all
  if (!proj || !other) {
    console.log('Needs at least two projects. Seed the scratch database first.')
    process.exitCode = 1
    return
  }
  // An initiative when the scratch database has one — that is the case Scott
  // reported — and otherwise another project, so the "it belongs over there"
  // path is exercised either way rather than skipped on a bare seed.
  const dest = init ? `initiative:${init.id}` : `project:${other.id}`

  const base = {
    wrongEntityType: 'project' as const,
    wrongEntityId: proj.id,
    source: 'slack',
    location: '#gpc-taxonomy',
    author: 'Priya Raman',
    evidenceId: 'e1',
    evidenceTitle: 'Slack #gpc-taxonomy',
  }

  // --- what it refuses ---
  check(
    'a correction about nothing in particular is refused',
    Boolean((await recordCorrection({ ...base, location: null, author: null, belongsTo: '' })).error),
    'a rule from it would claim every message from Slack',
  )

  check(
    'a destination that does not exist is refused',
    Boolean((await recordCorrection({ ...base, belongsTo: 'project:no-such-project' })).error),
  )

  check(
    'a made-up kind of record is refused',
    Boolean((await recordCorrection({ ...base, belongsTo: 'theme:whatever' })).error),
  )

  check(
    'moving it to where it already is is refused',
    Boolean((await recordCorrection({ ...base, belongsTo: `project:${proj.id}` })).error),
  )

  check('none of those were written', (await pending(proj.id)).length === 0, `${(await pending(proj.id)).length} rows`)

  // --- what it accepts ---
  const first = await recordCorrection({ ...base, belongsTo: dest, note: 'this channel is GPC' })
  check('a correction with somewhere to point is accepted', first.ok === true, first.error ?? '')
  check('and says the rule comes into force on the next pass', /next pass/.test(first.message ?? ''), first.message ?? '')
  check('and names it as belonging elsewhere, not as excluded', /belongs elsewhere/.test(first.message ?? ''), first.message ?? '')

  const rows = await pending(proj.id)
  check('exactly one row was written', rows.length === 1, `${rows.length}`)
  check('with the coordinates a rule matches on', rows[0]?.location === '#gpc-taxonomy' && rows[0]?.source === 'slack')
  check('and the words the person used', rows[0]?.note === 'this channel is GPC')
  check('pointing where they said', rows[0]?.rightEntityId === (init ? init.id : other.id))

  // Saying it twice is one correction, not two rules.
  const again = await recordCorrection({ ...base, belongsTo: dest, note: 'saying it again' })
  check('the same correction twice is accepted without writing a second row', again.ok === true)
  check('and it says so rather than pretending', /[Aa]lready/.test(again.message ?? ''), again.message ?? '')
  check('still one row', (await pending(proj.id)).length === 1)

  // --- "it belongs to nothing" is a real answer ---
  const third = all[2] ?? other
  {
    const none = await recordCorrection({
      ...base,
      wrongEntityId: third.id,
      location: '#random-chat',
      belongsTo: '',
      note: 'not portfolio work at all',
    })
    check('an exclusion is accepted without a destination', none.ok === true, none.error ?? '')
    const row = (await pending(third.id))[0]
    check('and is stored as pointing at nothing', row?.rightEntityId === null && row?.rightEntityType === null)
  }

  console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nall checks passed')
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
