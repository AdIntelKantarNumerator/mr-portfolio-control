/**
 * Blockers: what is stuck, and whose it is.
 *
 * This replaces the Register, which put decisions and blockers on one screen
 * with a shared set of filters, a "what has to be true" preamble, four counter
 * tiles and a "also being discussed" section at the foot. One page answering
 * three questions answers none of them first, and the one people came for was
 * always this one.
 *
 * The recurring-topics readout that used to sit at the foot is now its own
 * page — Discussions — and decisions remain on the detail page of whatever
 * they were filed against.
 */
import { asc, desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { decisions, initiatives, people, projects, workstreams } from '@/db/schema'
import { Kicker } from '@/components/ui'
import { addContext } from '@/lib/add-context'
import { getCurrentUser } from '@/lib/auth/current-user'
import { BlockerList, type BlockerRow, type Named } from './list'

export const metadata = { title: 'Blockers' }
export const dynamic = 'force-dynamic'

export default async function BlockersPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>
}) {
  const { show } = await searchParams
  const closed = show === 'closed'

  const [rows, inits, projs, wss, folk, ctx, user] = await Promise.all([
    closed
      ? db
          .select()
          .from(decisions)
          .where(eq(decisions.kind, 'blocker'))
          .orderBy(desc(decisions.resolvedAt))
          .limit(300)
      : db.select().from(decisions).where(eq(decisions.kind, 'blocker')),
    db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives).orderBy(asc(initiatives.name)),
    db.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.name)),
    db.select({ id: workstreams.id, name: workstreams.name }).from(workstreams).orderBy(asc(workstreams.name)),
    db.select({ id: people.id, name: people.name }).from(people).orderBy(asc(people.name)),
    // The same context the detail-page dialogs use, so the two surfaces offer
    // the same options rather than two lists that drift.
    addContext(),
    getCurrentUser(),
  ])

  const nameOf = new Map(folk.map((p) => [p.id, p.name]))
  const named = new Map<string, Named>()
  for (const i of inits) named.set(`initiative:${i.id}`, i)
  for (const p of projs) named.set(`project:${p.id}`, p)
  for (const w of wss) named.set(`workstream:${w.id}`, w)

  const open = (s: string) => s !== 'decided' && s !== 'dropped'
  const items: BlockerRow[] = rows
    .filter((d) => (closed ? !open(d.status) : open(d.status)))
    .map((d) => ({
      id: d.id,
      ref: d.ref,
      title: d.title,
      body: d.body,
      status: d.status,
      category: d.category,
      owner: d.ownerId ? (nameOf.get(d.ownerId) ?? d.ownerText) : d.ownerText,
      raisedBy: d.raisedById ? (nameOf.get(d.raisedById) ?? d.raisedByText) : d.raisedByText,
      dueBy: d.dueBy,
      raisedAt: d.raisedAt ? d.raisedAt.toISOString().slice(0, 10) : null,
      level: d.entityType,
      entity: d.entityType && d.entityId ? (named.get(`${d.entityType}:${d.entityId}`) ?? null) : null,
    }))

  // Open before watching, then oldest first: a blocker's age is the thing
  // that makes it worth looking at, and a list sorted by name buries it.
  const rank = (r: BlockerRow) => (r.status === 'open' ? 0 : r.status === 'watch' ? 1 : 2)
  items.sort((a, b) => rank(a) - rank(b) || (a.raisedAt ?? '9999').localeCompare(b.raisedAt ?? '9999'))

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Work in progress</Kicker>
          <h1>Blockers</h1>
        </div>
      </div>

      <BlockerList
        rows={items}
        initiatives={inits}
        projects={projs}
        workstreams={wss}
        people={folk}
        closed={closed}
        editing={user.personId ? { people: ctx.people, endpoints: ctx.endpoints } : null}
      />
    </div>
  )
}
