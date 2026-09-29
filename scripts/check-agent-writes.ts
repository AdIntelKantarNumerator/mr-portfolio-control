/**
 * Exercise the action-item and grouping routes against a real database.
 *
 *   DATABASE_URL=postgres://... SYNC_TOKEN=... npx tsx scripts/check-agent-writes.ts
 *
 * Same reasoning as the other check-* scripts: the rules worth testing here
 * are rules about what reaches the database. An action item attached to
 * nothing, a commitment recorded twice from two sets of notes, a grouping
 * re-proposed after somebody said no — every one of those is a row, and only
 * a database can confirm it is not there.
 *
 * It writes test rows and leaves them, and it clears its own from a previous
 * run first. Point it at a scratch database.
 */
import { POST as actionsPost, GET as actionsGet, PATCH as actionsPatch } from '../src/app/api/agent/actions/route'
import { POST as groupPost, GET as groupGet } from '../src/app/api/agent/grouping/route'
import { db } from '../src/db/client'
import {
  actionItemLinks,
  actionItems,
  groupingSuggestions,
  objectives,
  people,
  initiatives,
  projects,
} from '../src/db/schema'
import { eq, inArray, like } from 'drizzle-orm'

const TOKEN = process.env.SYNC_TOKEN ?? 'test-token'

function req(url: string, method: string, body?: unknown) {
  return new Request(`http://x${url}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function json(res: Response) {
  return (await res.json()) as Record<string, never> & Record<string, unknown>
}

function check(label: string, ok: boolean, extra = '') {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

const SOURCE = { kind: 'meeting', title: 'Ratings sync, 25 Sep', url: 'https://example.invalid/notes' }

async function main() {
  // Re-runnable.
  await db.delete(actionItemLinks)
  await db.delete(actionItems)
  await db.delete(groupingSuggestions)
  await db.delete(projects).where(inArray(projects.id, ['cw1']))
  await db.delete(initiatives).where(inArray(initiatives.id, ['cp1', 'cp2', 'cp3']))
  await db.delete(objectives).where(like(objectives.key, 'chk-%'))
  await db.delete(people).where(inArray(people.id, ['cper1']))

  await db.insert(people).values({ id: 'cper1', name: 'Priya Raman' } as never)
  await db.insert(objectives).values({ id: 'ci1', key: 'chk-platform', name: 'Ad Intelligence Platform' } as never)
  await db.insert(initiatives).values([
    { id: 'cp1', key: 'CP-1', name: 'Creative Capture', status: 'active', sortOrder: 1 },
    { id: 'cp2', key: 'CP-2', name: 'Logo Rec Tech', status: 'active', sortOrder: 2 },
    { id: 'cp3', key: 'CP-3', name: 'Nielsen Migration', status: 'active', sortOrder: 3, objectiveId: 'ci1' },
  ] as never)
  await db.insert(projects).values({
    id: 'cw1',
    key: 'CW-1',
    name: 'Frame extraction',
    status: 'active',
    initiativeId: 'cp1',
    sortOrder: 1,
  } as never)

  // --- action items: the happy path, at three levels at once ---
  let r = await json(
    await actionsPost(
      req('/api/agent/actions', 'POST', {
        source: SOURCE,
        items: [
          {
            text: 'Priya to confirm the backfill window with VideoAmp.',
            owner: 'Priya Raman',
            dueDate: '2026-10-03',
            links: [
              { level: 'project', entityId: 'cw1' },
              { level: 'initiative', entityId: 'cp1' },
              { level: 'objective', entityName: 'Ad Intelligence Platform' },
            ],
          },
        ],
      }),
    ),
  )
  check('an action item is written and gets a ref', (r.written as string[])?.length === 1, String(r.written))
  const ref = (r.written as string[])[0]

  const [written] = await db.select().from(actionItems).where(eq(actionItems.ref, ref)).limit(1)
  check('the owner resolved to a real person', written.ownerId === 'cper1' && written.ownerName === null)
  check('the date was stored', written.dueDate?.toISOString().slice(0, 10) === '2026-10-03')
  check('provenance travels with it', written.sourceTitle === SOURCE.title && written.sourceUrl === SOURCE.url)

  const links = await db.select().from(actionItemLinks).where(eq(actionItemLinks.actionItemId, written.id))
  check('it hangs off all three levels', links.length === 3, links.map((l) => l.level).sort().join(','))
  check('an objective can be named rather than given by id', links.some((l) => l.level === 'objective'))

  // --- the same commitment, read again from a second set of notes ---
  r = await json(
    await actionsPost(
      req('/api/agent/actions', 'POST', {
        source: { kind: 'meeting', title: "Somebody's summary of the same meeting" },
        items: [
          {
            // Different punctuation, same commitment.
            text: 'Priya to confirm the backfill window with VideoAmp',
            links: [{ level: 'project', entityId: 'cw1' }],
          },
        ],
      }),
    ),
  )
  check('the same commitment twice is not two rows', (r.written as string[]).length === 0)
  check('and it says which one it matched', /already recorded/.test((r.skipped as string[])[0] ?? ''), String(r.skipped))
  check('still one row', (await db.select().from(actionItems)).length === 1)

  // --- refusals ---
  r = await json(
    await actionsPost(
      req('/api/agent/actions', 'POST', {
        source: SOURCE,
        items: [
          { text: 'Somebody to do a thing.', links: [{ level: 'project', entityId: 'nope' }] },
          { text: 'Another thing.', links: [{ level: 'galaxy', entityId: 'cw1' }] },
          { text: 'x'.repeat(400), links: [{ level: 'project', entityId: 'cw1' }] },
          { text: '', links: [{ level: 'project', entityId: 'cw1' }] },
        ],
      }),
    ),
  )
  check('an item attached to nothing real is dropped', (r.written as string[]).length === 0, String(r.dropped))
  check('and each refusal says why', (r.dropped as string[]).length >= 3, String((r.dropped as string[]).length))
  check('a bad level is named as a bad level', /is not a level/.test((r.dropped as string[]).join(' ')))

  r = await json(await actionsPost(req('/api/agent/actions', 'POST', { items: [], source: { title: '' } })))
  check('no provenance, no write', typeof r.error === 'string', String(r.error))

  // --- an unowned, undated commitment is still recorded ---
  r = await json(
    await actionsPost(
      req('/api/agent/actions', 'POST', {
        source: SOURCE,
        items: [{ text: 'Check whether the retry path covers the nightly job.', links: [{ level: 'initiative', entityId: 'cp1' }] }],
      }),
    ),
  )
  check('unowned and undated still lands', (r.written as string[]).length === 1, String(r.dropped))
  const [unowned] = await db.select().from(actionItems).where(eq(actionItems.ref, (r.written as string[])[0]))
  check('and is marked as having nobody', unowned.ownerId === null && unowned.ownerName === null)

  // --- reading back ---
  const listed = await json(await actionsGet(req('/api/agent/actions?status=open', 'GET')))
  check('both open items come back', (listed.actions as unknown[]).length === 2)
  check(
    'the unowned one is flagged, not silently blank',
    (listed.actions as Array<{ unowned: boolean }>).some((a) => a.unowned),
  )

  // --- closing, and what is refused ---
  r = await json(await actionsPatch(req('/api/agent/actions', 'PATCH', { ref, status: 'done' })))
  check('an item can be closed by ref', r.changed === true)
  r = await json(await actionsPatch(req('/api/agent/actions', 'PATCH', { ref, status: 'dropped' })))
  check('an agent may not drop somebody\'s commitment', typeof r.error === 'string', String(r.error))

  // --- grouping: propose, and what is refused ---
  r = await json(
    await groupPost(
      req('/api/agent/grouping', 'POST', {
        model: 'test',
        groups: [
          {
            name: 'Creative Intelligence',
            rationale: 'Shared owner and the same repository.',
            initiativeIds: ['cp1', 'cp2'],
          },
          { name: 'Too small', rationale: 'x', initiativeIds: ['cp1'] },
          { name: 'Not real', rationale: 'x', initiativeNames: ['Nothing Called This', 'Creative Capture'] },
        ],
      }),
    ),
  )
  check('a grouping of two real initiatives is proposed', (r.proposed as string[]).length === 1, String(r.dropped))
  check('a grouping of one is refused', /at least two real initiatives/.test((r.dropped as string[]).join(' ')))
  check('an initiative that does not exist is named back', /no initiative called/.test((r.dropped as string[]).join(' ')))

  // --- the same set again ---
  r = await json(
    await groupPost(
      req('/api/agent/grouping', 'POST', {
        groups: [{ name: 'Creative Intelligence, again', rationale: 'Same thing.', initiativeIds: ['cp2', 'cp1'] }],
      }),
    ),
  )
  check(
    'the same set is not proposed twice, whatever the order',
    (r.proposed as string[]).length === 0 && /already waiting/.test((r.dropped as string[]).join(' ')),
    String(r.dropped),
  )

  // --- once dismissed, never again ---
  const [pending] = await db.select().from(groupingSuggestions).limit(1)
  await db
    .update(groupingSuggestions)
    .set({ status: 'dismissed', decidedBy: 'Scott', decidedAt: new Date() })
    .where(eq(groupingSuggestions.id, pending.id))

  r = await json(
    await groupPost(
      req('/api/agent/grouping', 'POST', {
        groups: [{ name: 'Creative Intelligence', rationale: 'Trying again.', initiativeIds: ['cp1', 'cp2'] }],
      }),
    ),
  )
  check(
    'a dismissed grouping is not offered again',
    (r.proposed as string[]).length === 0 && /dismissed already/.test((r.dropped as string[]).join(' ')),
    String(r.dropped),
  )

  // --- nothing here moved an initiative ---
  const stillLoose = await db.select().from(initiatives).where(eq(initiatives.id, 'cp1'))
  check('proposing changed no initiative', stillLoose[0].objectiveId === null)

  const state = await json(await groupGet(req('/api/agent/grouping', 'GET')))
  check(
    'the loose initiatives come back so she can see the gap',
    (state.ungrouped as Array<{ id: string }>).some((p) => p.id === 'cp1'),
  )

  console.log('\nDone.')
  process.exit(process.exitCode ?? 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
