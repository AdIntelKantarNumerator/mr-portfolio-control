/**
 * Resolving a recurring discussion, and it coming back, against a real
 * database.
 *
 *   DATABASE_URL=pglite:./.data/scratch SYNC_TOKEN= npx tsx scripts/check-discussion-resolve.ts
 *
 * The rule worth checking is the one in the register route's upsert: a topic
 * resolved on Monday and raised again in Thursday's meeting reopens, while a
 * re-read of a document from before the resolution leaves it resolved. That is
 * SQL, so only a database can confirm it.
 *
 * It writes test rows. Point it at a scratch database.
 */
import { setTopicResolved } from '../src/app/discussions/actions'
import { POST as register } from '../src/app/api/agent/register/route'
import { recentThemes } from '../src/lib/portfolio'
import { db } from '../src/db/client'
import { entityThemes, initiatives, sourceDocuments } from '../src/db/schema'
import { and, eq, like } from 'drizzle-orm'

function check(label: string, ok: boolean, extra = '') {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

async function mention(externalId: string, occurredAt: string) {
  const res = await register(
    new Request('http://local/api/agent/register', {
      method: 'POST',
      body: JSON.stringify({
        document: { origin: 'google_drive', externalId, title: `Check meeting ${externalId}`, occurredAt },
        themes: [{ entityType: 'initiative', entityId: 'dr1', theme: 'Resolve check topic', summary: `Said on ${occurredAt}` }],
      }),
    }),
  )
  if (res.status !== 200) throw new Error(`register said ${res.status}: ${await res.text()}`)
}

async function row() {
  const [r] = await db
    .select()
    .from(entityThemes)
    .where(and(eq(entityThemes.entityId, 'dr1'), eq(entityThemes.theme, 'Resolve check topic')))
  return r
}

async function main() {
  await db.delete(entityThemes).where(eq(entityThemes.entityId, 'dr1'))
  await db.delete(sourceDocuments).where(like(sourceDocuments.externalId, 'dr-check-%'))
  await db.delete(initiatives).where(eq(initiatives.id, 'dr1'))
  await db.insert(initiatives).values({ id: 'dr1', key: 'DR-1', name: 'Resolve Check Initiative', status: 'active' } as never)

  await mention('dr-check-1', '2026-09-01T10:00:00Z')
  const first = await row()
  check('Yaara recorded the topic', Boolean(first) && first.mentions === 1)

  // --- resolving hides it from the open list ---
  let s = await setTopicResolved({ id: first.id, resolved: true }).catch((e: Error) => {
    // The cache refresh after the write needs a request this script lacks.
    if (/static generation store/i.test(e.message)) return { ok: true }
    throw e
  })
  check('resolving works', Boolean(s.ok))
  let r = await row()
  check('it is marked resolved, by someone', Boolean(r.resolvedAt) && Boolean(r.resolvedBy))
  let recent = await recentThemes(60)
  check('it leaves the open list', !recent.open.some((t) => t.id === r.id))
  check('and is in the resolved list', recent.resolved.some((t) => t.id === r.id))

  // --- an older document read again changes nothing ---
  await mention('dr-check-2', '2026-08-15T10:00:00Z')
  r = await row()
  check('a mention dated before the resolution leaves it resolved', Boolean(r.resolvedAt) && !r.reopenedAt)

  // --- a later meeting raising it again reopens it ---
  const later = new Date(Date.now() + 86_400_000).toISOString()
  await mention('dr-check-3', later)
  r = await row()
  check('a mention dated after the resolution reopens it', !r.resolvedAt && !r.resolvedBy)
  check('and says it came back', Boolean(r.reopenedAt))
  recent = await recentThemes(60)
  check('it is back in the open list', recent.open.some((t) => t.id === r.id))

  // --- reopening by hand is a fresh start ---
  await setTopicResolved({ id: r.id, resolved: true }).catch(() => ({}))
  s = await setTopicResolved({ id: r.id, resolved: false }).catch((e: Error) => {
    if (/static generation store/i.test(e.message)) return { ok: true }
    throw e
  })
  r = await row()
  check('reopening by hand clears resolved and the came-back note', !r.resolvedAt && !r.reopenedAt)
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
