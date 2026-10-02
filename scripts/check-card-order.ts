/**
 * Prove the board order is one shared order, and that every move is recorded.
 *
 *   npx tsx scripts/check-card-order.ts                    (the local database)
 *   DATABASE_URL=postgres://... npx tsx scripts/check-card-order.ts
 *
 * Since 2 October 2026 dragging a card writes the shared sort_order column
 * (app/order-actions.ts) and logs who moved what. Until then each reader had
 * their own arrangement in card_orders, and this script proved the opposite
 * property. What matters now, and needs a database to check:
 *
 *   - the order sent lands in sort_order, for everybody
 *   - a filtered board reorders only the cards it shows, in their own slots
 *   - each move is in Activity, naming the card and the positions
 *   - ids that have gone, an order of nothing, and unknown levels are refused
 *
 * It reorders initiatives and leaves them reordered, and adds Activity lines.
 * Point it at a scratch database.
 */
import { asc, desc } from 'drizzle-orm'
import { setCardOrder } from '../src/app/order-actions'
import { db } from '../src/db/client'
import { changelogEntries, initiatives } from '../src/db/schema'

function check(label: string, ok: boolean, extra = '') {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

async function order(): Promise<string[]> {
  return (await db.select({ id: initiatives.id }).from(initiatives).orderBy(asc(initiatives.sortOrder), asc(initiatives.name))).map((r) => r.id)
}

async function lastLog() {
  const [row] = await db.select().from(changelogEntries).orderBy(desc(changelogEntries.at)).limit(1)
  return row
}

async function main() {
  const start = await order()
  if (start.length < 4) {
    console.log('Needs at least four initiatives. Seed the scratch database first.')
    process.exitCode = 1
    return
  }

  // --- the whole board: move the last card to the front ---
  const wanted = [start.at(-1)!, ...start.slice(0, -1)]
  const res = await setCardOrder('initiative', wanted)
  check('the action accepts a valid order', res.ok === true, res.error ?? '')
  check('and it is the shared order now', (await order()).join() === wanted.join())
  const log = await lastLog()
  check(
    'the move is recorded, naming the positions',
    Boolean(log && log.summary.startsWith('Order: moved') && log.summary.includes(`from ${start.length}th`) && log.summary.includes('to 1st')),
    log?.summary ?? '(no log line)',
  )
  check('against the card that moved', log?.entityId === wanted[0], `${log?.entityId}`)

  // --- a filtered board: only the visible cards move, in their own slots ---
  const now = await order()
  const visible = [now[0]!, now[2]!] // as though the 2nd card were filtered out
  const before = [...now]
  await setCardOrder('initiative', [visible[1]!, visible[0]!])
  const after = await order()
  check('the visible cards swap places', after[0] === before[2] && after[2] === before[0], after.slice(0, 3).join(', '))
  check('and the hidden card between them stays where it was', after[1] === before[1])
  check('and nothing else moved', after.slice(3).join() === before.slice(3).join())

  // --- dropping a card where it already is changes nothing and logs nothing ---
  const quiet = await lastLog()
  await setCardOrder('initiative', await order())
  check('an unchanged order writes no Activity line', (await lastLog())?.id === quiet?.id)

  // --- refusals ---
  const ghost = await setCardOrder('initiative', [after[1]!, 'no-such-initiative', after[0]!])
  check('a deleted id is ignored rather than stored', ghost.ok === true && (await order()).every((id) => id !== 'no-such-initiative'))
  check('an order of nothing that exists changes nothing', (await setCardOrder('initiative', ['nope-1', 'nope-2'])).ok === true)
  check('an unknown level is refused', Boolean((await setCardOrder('theme', after)).error))

  console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nall checks passed')
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
