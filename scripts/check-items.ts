/**
 * Prove the item follow-up rules against a real database (lib/items.ts).
 *
 *   DATABASE_URL=pglite:./.data/scratch npx tsx scripts/check-items.ts
 *
 * Creates a project, a blocker and two action items, then drives every kind
 * of update through applyItemUpdate and checks the trail each leaves: status,
 * history, last activity, mentions, score. Point it at a scratch database.
 */
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { actionItemLinks, actionItems, decisions, initiatives, people, projects } from '../src/db/schema'
import { applyItemUpdate, inScope, itemHistory, loadItems, scopeIds } from '../src/lib/items'

function check(label: string, ok: boolean, extra = '') {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

const old = new Date(Date.now() - 10 * 86_400_000)

async function main() {
  const who = `Priya Check${String(Date.now()).slice(-6)}`
  const [lead] = await db.insert(people).values({ name: who, email: `priya-${Date.now()}@example.com` }).returning()
  const [init] = await db.insert(initiatives).values({ key: `chk-i-${Date.now()}`, name: 'Check Initiative', ownerId: lead!.id } as never).returning()
  const [proj] = await db.insert(projects).values({ key: `chk-p-${Date.now()}`, name: 'Check Project', initiativeId: init!.id } as never).returning()
  const tag = String(Date.now()).slice(-6)
  const [blocker] = await db
    .insert(decisions)
    .values({ ref: `B9${tag}`, kind: 'blocker', title: 'Waiting on legal sign-off', body: '…', entityType: 'project', entityId: proj!.id, lastActivityAt: old })
    .returning()
  const [a1] = await db.insert(actionItems).values({ ref: `A9${tag}`, text: 'Get legal to sign the data contract', lastActivityAt: old }).returning()
  const [a2] = await db.insert(actionItems).values({ ref: `A8${tag}`, text: 'Chase legal on the data contract', lastActivityAt: old }).returning()
  await db.insert(actionItemLinks).values([
    { actionItemId: a1!.id, level: 'project', entityId: proj!.id },
    { actionItemId: a2!.id, level: 'project', entityId: proj!.id },
  ])

  const mine = async () => inScope(await loadItems(), await scopeIds('initiative', init!.id))

  let items = await mine()
  check('three open items on the initiative, through its project', items.filter((i) => i.open).length === 3)
  check('all three start inactive (untouched for ten days)', items.every((i) => i.inactive))
  check('an item with no owner falls to the project\'s nearest owner', items[0]!.placeOwner === who, String(items[0]!.placeOwner))

  // First score: bookkeeping, not activity.
  await applyItemUpdate({ ref: blocker!.ref, action: 'score', actor: 'Yaara', factors: ['blocks_project', 'key_deliverable'], reasons: [{ factor: 'blocks_project', why: 'Nothing ships without it', quote: 'we cannot launch until legal signs' }] })
  items = await mine()
  const b = items.find((i) => i.ref === blocker!.ref)!
  check('scored Critical from its factors', b.band === 'critical', `${b.score}`)
  check('the first score does not count as activity', b.inactive)
  check('the reasons are kept for the popup', b.reasons[0]?.quote === 'we cannot launch until legal signs')

  // A person makes it less important: activity, and it survives a re-score.
  await applyItemUpdate({ ref: blocker!.ref, action: 'adjust', actor: 'Scott Bernberg', delta: -1 })
  await applyItemUpdate({ ref: blocker!.ref, action: 'score', actor: 'Yaara', factors: ['blocks_project', 'key_deliverable'] })
  items = await mine()
  const b2 = items.find((i) => i.ref === blocker!.ref)!
  check('a manual adjustment is activity', !b2.inactive)
  check('and survives Yaara re-scoring', b2.adjust === -10 && b2.score === (b.score ?? 0) - 10, `${b2.score}`)

  // Duplicate: the copy is dropped and merged; the survivor gains its mentions.
  const r = await applyItemUpdate({ ref: a2!.ref!, action: 'duplicate', duplicateOf: a1!.ref!, actor: 'Yaara', note: 'Same contract.' })
  items = await mine()
  const kept = items.find((i) => i.ref === a1!.ref)!
  check('a duplicate is merged into the older item', r.ok && !items.some((i) => i.ref === a2!.ref && i.open), JSON.stringify(r))
  check('the survivor counts one more mention and is active', kept.mentions === 2 && !kept.inactive)

  // Progress needs a note; ownership by name.
  check('progress without a note is refused', !(await applyItemUpdate({ ref: a1!.ref!, action: 'progress', actor: 'Yaara' })).ok)
  await applyItemUpdate({ ref: a1!.ref!, action: 'progress', actor: 'Yaara', note: 'Legal has the draft.', source: { title: 'Slack #legal' } })
  await applyItemUpdate({ ref: a1!.ref!, action: 'owner', owner: who, actor: 'Scott Bernberg' })
  items = await mine()
  check('owner matched to the person', items.find((i) => i.ref === a1!.ref)!.ownerName === who)

  // A reminder is not activity.
  const [before] = await db.select({ at: actionItems.lastActivityAt }).from(actionItems).where(eq(actionItems.id, a1!.id))
  await applyItemUpdate({ ref: a1!.ref!, action: 'nudged', actor: 'Yaara', note: 'Reminded Priya Shah.' })
  const [after] = await db.select({ at: actionItems.lastActivityAt, n: actionItems.nudgedAt }).from(actionItems).where(eq(actionItems.id, a1!.id))
  check('a reminder sets nudged_at and leaves last activity alone', Boolean(after!.n) && after!.at.getTime() === before!.at.getTime())

  // Resolve, and the history tells the story newest first.
  await applyItemUpdate({ ref: a1!.ref!, action: 'resolve', actor: 'Priya Shah', note: 'Signed today.' })
  await applyItemUpdate({ ref: blocker!.ref, action: 'resolve', actor: 'Yaara', note: 'Legal signed.', source: { title: 'Slack #legal', url: 'https://x' } })
  items = await mine()
  check('both closed', !items.some((i) => i.open))
  const story = await itemHistory(a1!.ref!)
  check('history, newest first', story[0]?.kind === 'done' && story.some((e) => e.kind === 'merged') && story.some((e) => e.kind === 'owner'), story.map((e) => e.kind).join(','))
  check('an unknown ref is refused, not invented', !(await applyItemUpdate({ ref: 'A0', action: 'resolve', actor: 'Yaara' })).ok)

  console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nall checks passed')
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
