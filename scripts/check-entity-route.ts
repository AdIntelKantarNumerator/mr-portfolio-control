/**
 * Exercise the entity route against a real database.
 *
 *   DATABASE_URL=postgres://... SYNC_TOKEN=... npx tsx scripts/check-entity-route.ts
 *
 * Not part of `npm test`, because it needs a Postgres server and a schema, and
 * a suite that cannot run on a laptop with no database is a suite people stop
 * running. It is here because this route is the only agent write that replaces
 * what a person put there, and the rules that matter — nothing is created,
 * nothing is deleted, every change is logged with its reason — are rules about
 * what reaches the database, which only a database can confirm.
 *
 * It writes test rows and leaves them. Point it at a scratch database.
 */
import { POST } from '../src/app/api/agent/entity/route'
import { db } from '../src/db/client'
import { appAreas, initiatives, projects, people, workstreams, teams, changelogEntries } from '../src/db/schema'
import { eq } from 'drizzle-orm'

const TOKEN = process.env.SYNC_TOKEN!

function req(body: unknown) {
  return new Request('http://x/api/agent/entity', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  })
}

async function call(body: unknown) {
  const res = await POST(req(body))
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

function check(label: string, ok: boolean, extra = '') {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

async function main() {
  await db.insert(people).values([
    { id: 'per1', name: 'Priya Raman' },
    { id: 'per2', name: 'Dan Okoro' },
  ] as never)
  await db.insert(teams).values({ id: 'team1', key: 'T-1', name: 'Ratings' } as never)
  await db.insert(appAreas).values({ id: 'area1', key: 'AA1', name: 'Data Platform', sortOrder: 1 } as never)
  await db.insert(projects).values([
    { id: 'init1', key: 'I-1', name: 'Sports', status: 'active', sortOrder: 1 },
    { id: 'init2', key: 'I-2', name: 'Global Product Catalog', status: 'active', sortOrder: 2 },
  ] as never)
  await db.insert(workstreams).values([
    { id: 'proj1', key: 'P-1', name: 'Dashboard', status: 'active', projectId: 'init1', sortOrder: 1 },
    { id: 'proj2', key: 'P-2', name: 'Taxonomy', status: 'active', sortOrder: 2 },
  ] as never)

  // --- the happy path: several fields at once ---
  let r = await call({
    entityType: 'workstream',
    entityName: 'Dashboard',
    reason: 'Scott asked in Slack',
    changes: {
      name: 'Sports Dashboard',
      project: 'Global Product Catalog',
      owner: 'Priya Raman',
      team: 'Ratings',
      appArea: 'Data Platform',
      status: 'in_progress',
      priority: 'high',
      targetDate: '2026-11-30',
      devLead: 'Scott & Sadiya',
    },
  })
  check('a full change applies', r.status === 200 && r.body.changed === 9, JSON.stringify(r.body.refused))

  const [moved] = await db.select().from(workstreams).where(eq(workstreams.id, 'proj1'))
  check('the row really changed', moved!.name === 'Sports Dashboard' && moved!.projectId === 'init2')
  check('owner went to leadId on a workstream', moved!.leadId === 'per1')
  check('free text lead is kept as written', moved!.devLead === 'Scott & Sadiya')

  const log = await db.select().from(changelogEntries).where(eq(changelogEntries.entityId, 'proj1'))
  check('one changelog entry per field', log.length === 9, `got ${log.length}`)
  check('the reason is in the entry', (log[0]!.detail ?? '').includes('Scott asked in Slack'))
  check('the entry names the actor', log[0]!.actor === 'yaara')

  // --- refusals ---
  r = await call({ entityType: 'workstream', entityName: 'Taxonomy', changes: { name: 'X' } })
  check('no reason is refused', r.status === 400)

  r = await call({
    entityType: 'workstream',
    entityName: 'Taxonomy',
    reason: 'test',
    changes: { name: 'Sports Dashboard' },
  })
  check('a duplicate name is refused', r.body.changed === 0 && String(r.body.refused).includes('already called'))

  r = await call({
    entityType: 'workstream',
    entityName: 'Taxonomy',
    reason: 'test',
    changes: { owner: 'Someone Invented' },
  })
  check('an unknown person is refused, not created', r.body.changed === 0)
  const peopleNow = await db.select().from(people)
  check('and no person was created', peopleNow.length === 2, `${peopleNow.length} people`)

  r = await call({
    entityType: 'workstream',
    entityName: 'Taxonomy',
    reason: 'test',
    changes: { project: 'Nonexistent Project' },
  })
  check('an unknown project is refused', r.body.changed === 0)
  const initsNow = await db.select().from(projects)
  check('and no project was created', initsNow.length === 2)

  r = await call({
    entityType: 'workstream',
    entityName: 'Taxonomy',
    reason: 'test',
    changes: { status: 'done' },
  })
  check('a status outside the list is refused', r.body.changed === 0)

  r = await call({
    entityType: 'project',
    entityName: 'Sports',
    reason: 'test',
    changes: { team: 'Ratings', priority: 'high', project: 'Global Product Catalog' },
  })
  check('fields a project does not have are refused', r.body.changed === 0 && (r.body.refused as string[]).length === 3)

  r = await call({
    entityType: 'workstream',
    entityName: 'Nope',
    reason: 'test',
    changes: { name: 'X' },
  })
  check('an unknown workstream is refused with the list', r.status === 400 && Array.isArray(r.body.available))

  // --- partial: good and bad together ---
  r = await call({
    entityType: 'workstream',
    entityName: 'Taxonomy',
    reason: 'partial test',
    changes: { description: 'A real description', owner: 'Nobody At All' },
  })
  check('the good part applies and the bad part is reported', r.body.changed === 1 && (r.body.refused as string[]).length === 1)

  // --- clearing a value ---
  r = await call({
    entityType: 'workstream',
    entityName: 'Sports Dashboard',
    reason: 'no longer under a project',
    changes: { project: null },
  })
  const [cleared] = await db.select().from(workstreams).where(eq(workstreams.id, 'proj1'))
  check('a project can be cleared', cleared!.projectId === null)

  // --- a name that is close but not exact comes back as a question ---
  r = await call({
    entityType: 'workstream',
    entityName: 'Taxonmy',
    reason: 'test',
    changes: { status: 'paused' },
  })
  check(
    'a near-miss name suggests rather than guessing',
    r.status === 400 && (r.body.suggestions as string[])?.includes('Taxonomy'),
    JSON.stringify(r.body.suggestions),
  )

  const [untouched] = await db.select().from(workstreams).where(eq(workstreams.id, 'proj2'))
  check('and changed nothing while asking', untouched!.status === 'active')

  r = await call({
    entityType: 'workstream',
    entityName: 'Completely Unrelated Thing',
    reason: 'test',
    changes: { status: 'paused' },
  })
  check(
    'nothing close offers no suggestions at all',
    r.status === 400 && ((r.body.suggestions as string[]) ?? []).length === 0,
  )

  r = await call({
    entityType: 'workstream',
    entityName: 'Taxonomy',
    reason: 'test',
    changes: { owner: 'Priya' },
  })
  check(
    'a near-miss person is a question too',
    r.body.changed === 0 && String(r.body.refused).includes('Priya Raman'),
    JSON.stringify(r.body.refused),
  )

  // --- the grouping tier ---
  //
  // Added when initiatives arrived above projects. The rule worth checking is
  // the one that is easy to get backwards: a project rolls up to an
  // initiative, a workstream rolls up to a project, and letting a workstream
  // name an initiative would quietly build a second hierarchy.
  await db.insert(initiatives).values([
    { id: 'gi1', key: 'ent-platform', name: 'Ad Intelligence Platform' },
    { id: 'gi2', key: 'ent-ratings', name: 'Ratings Modernization' },
  ] as never)

  r = await call({
    entityType: 'project',
    entityName: 'Sports',
    reason: 'Scott asked in Slack',
    changes: { initiative: 'Ad Intelligence Platform' },
  })
  check('a project can be moved into an initiative', r.body.changed === 1, JSON.stringify(r.body))
  const [grouped] = await db.select().from(projects).where(eq(projects.id, 'init1'))
  check('and the column actually changed', grouped.initiativeId === 'gi1', String(grouped.initiativeId))

  r = await call({
    entityType: 'workstream',
    // By id: the happy-path check above renamed this one, and a check that
    // silently turns into "no such workstream" passes for the wrong reason.
    entityId: 'proj1',
    reason: 'test',
    changes: { initiative: 'Ad Intelligence Platform' },
  })
  check(
    'a workstream cannot be put in an initiative',
    r.body.changed === 0 && String(r.body.refused).includes('rolls up to a project'),
    JSON.stringify(r.body.refused),
  )

  r = await call({
    entityType: 'project',
    entityName: 'Sports',
    reason: 'test',
    changes: { initiative: 'Ratings Modernisation' },
  })
  check(
    'a near-miss initiative name asks rather than guessing',
    r.body.changed === 0 && String(r.body.refused).includes('Ratings Modernization'),
    JSON.stringify(r.body.refused),
  )

  r = await call({
    entityType: 'project',
    entityName: 'Sports',
    reason: 'It stands alone again',
    changes: { initiative: null },
  })
  check('and a project can be taken out of every initiative', r.body.changed === 1)

  console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nall checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
