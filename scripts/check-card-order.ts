/**
 * Prove the home board's Custom order belongs to one reader, not to everyone.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/check-card-order.ts
 *
 * The first version of this feature wrote the shared `sort_order` column, so
 * one person dragging a card changed what the next person saw. The property
 * that matters now cannot be checked without a database: two rows, two
 * readers, no leakage between them — and, just as important, `sort_order`
 * left exactly as it was, because that column still means something to the
 * rest of the app.
 *
 * It writes test rows and leaves them. Point it at a scratch database.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { setCardOrder } from '../src/app/order-actions'
import { db } from '../src/db/client'
import { cardOrders, projects } from '../src/db/schema'

function check(label: string, ok: boolean, extra = '') {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

/** What the action writes for whoever the request belongs to. */
async function savedFor(personId: string, level: string): Promise<string[]> {
  const [row] = await db
    .select({ ids: cardOrders.orderedIds })
    .from(cardOrders)
    .where(and(eq(cardOrders.personId, personId), eq(cardOrders.level, level)))
    .limit(1)
  return row?.ids.split(',').filter(Boolean) ?? []
}

/**
 * Write an arrangement as a named reader.
 *
 * The action reads the current user from the session cookie, which a script
 * has no way to set, so the row is written the way the action writes it and
 * the action itself is exercised separately for the anonymous reader. Keeping
 * both in one file is the point: the shapes have to match, and the day they
 * stop matching is the day this check earns its keep.
 */
async function writeAs(personId: string, level: string, ids: string[]) {
  await db
    .insert(cardOrders)
    .values({ personId, level, orderedIds: ids.join(',') })
    .onConflictDoUpdate({
      target: [cardOrders.personId, cardOrders.level],
      set: { orderedIds: ids.join(','), updatedAt: new Date() },
    })
}

async function main() {
  const rows = await db.select({ id: projects.id, name: projects.name, sortOrder: projects.sortOrder }).from(projects)
  if (rows.length < 3) {
    console.log('Needs at least three projects. Seed the scratch database first.')
    process.exitCode = 1
    return
  }

  const ids = rows.map((r) => r.id)
  const sortBefore = new Map(rows.map((r) => [r.id, r.sortOrder]))

  // --- two readers, two arrangements ---
  const alice = 'check-alice'
  const bob = 'check-bob'
  const aliceOrder = [ids[2]!, ids[0]!, ids[1]!]
  const bobOrder = [ids[1]!, ids[2]!, ids[0]!]

  await writeAs(alice, 'project', aliceOrder)
  await writeAs(bob, 'project', bobOrder)

  check('each reader gets their own row', (await savedFor(alice, 'project')).join() === aliceOrder.join())
  check("and one reader's drag does not move the other's", (await savedFor(bob, 'project')).join() === bobOrder.join())

  // Re-arranging replaces, rather than appending a second row for the same
  // reader and level - the primary key is what guarantees it.
  const again = [ids[0]!, ids[1]!, ids[2]!]
  await writeAs(alice, 'project', again)
  const aliceRows = await db
    .select({ ids: cardOrders.orderedIds })
    .from(cardOrders)
    .where(and(eq(cardOrders.personId, alice), eq(cardOrders.level, 'project')))
  check('re-arranging overwrites rather than accumulating', aliceRows.length === 1, `${aliceRows.length} rows`)
  check('and the newest arrangement is the one stored', (await savedFor(alice, 'project')).join() === again.join())

  // Each board is arranged separately: the same reader at a different level
  // is a different row.
  await writeAs(alice, 'initiative', [ids[1]!])
  check('levels do not share an arrangement', (await savedFor(alice, 'project')).join() === again.join())

  // --- the action itself ---
  //
  // With no session it runs as 'local', which is the development case. What
  // is being checked is that it wrote SOMEWHERE and did not touch sort_order.
  const res = await setCardOrder('project', [ids[1]!, ids[0]!])
  check('the action accepts a valid order', res.ok === true, res.error ?? '')
  check('and writes it against the anonymous reader', (await savedFor('local', 'project')).join() === [ids[1], ids[0]].join())

  const after = await db
    .select({ id: projects.id, sortOrder: projects.sortOrder })
    .from(projects)
    .where(inArray(projects.id, ids))
  check(
    'sort_order is untouched — the arrangement is nobody else’s business',
    after.every((r) => r.sortOrder === sortBefore.get(r.id)),
    after
      .filter((r) => r.sortOrder !== sortBefore.get(r.id))
      .map((r) => `${r.id}: ${sortBefore.get(r.id)} → ${r.sortOrder}`)
      .join(', '),
  )

  // Ids that have gone are dropped rather than stored, so a saved order never
  // disagrees with the board it describes.
  const withGhost = await setCardOrder('project', [ids[0]!, 'no-such-project', ids[1]!])
  check('a deleted id is refused entry', withGhost.ok === true)
  check(
    'and only the live ids are stored',
    (await savedFor('local', 'project')).join() === [ids[0], ids[1]].join(),
    (await savedFor('local', 'project')).join(),
  )

  const allGone = await setCardOrder('project', ['nope-1', 'nope-2'])
  check('an order of nothing that exists is refused', Boolean(allGone.error), allGone.error ?? '(no error)')

  check('an unknown level is refused', Boolean((await setCardOrder('theme', ids)).error))

  console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nall checks passed')
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
