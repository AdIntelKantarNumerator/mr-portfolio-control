/**
 * Decisions: what is outstanding, and who owes the answer.
 *
 * The same page as Blockers, because they are the same table and the same
 * shape - see components/records/register-list.tsx. Decisions had no page at
 * all after the Register was split up; they were visible only on the detail
 * page of whatever they were filed against, and the home board's links to
 * them 404'd.
 */
import { asc, desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { decisions, initiatives, people, projects, workstreams } from '@/db/schema'
import { Kicker } from '@/components/ui'
import { addContext } from '@/lib/add-context'
import { scopeFilter } from '@/lib/scope-filter'
import { getCurrentUser } from '@/lib/auth/current-user'
import { RegisterList, type BlockerRow, type Named } from '@/components/records/register-list'

export const metadata = { title: 'Decisions' }
export const dynamic = 'force-dynamic'

export default async function DecisionsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; scope?: string }>
}) {
  const { show, scope } = await searchParams
  const closed = show === 'closed'

  const [rows, inits, projs, wss, folk, ctx, user] = await Promise.all([
    closed
      ? db
          .select()
          .from(decisions)
          .where(eq(decisions.kind, 'decision'))
          .orderBy(desc(decisions.resolvedAt))
          .limit(300)
      : db.select().from(decisions).where(eq(decisions.kind, 'decision')),
    db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives).orderBy(asc(initiatives.name)),
    db
      .select({ id: projects.id, name: projects.name, initiativeId: projects.initiativeId })
      .from(projects)
      .orderBy(asc(projects.name)),
    db
      .select({ id: workstreams.id, name: workstreams.name, projectId: workstreams.projectId })
      .from(workstreams)
      .orderBy(asc(workstreams.name)),
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

  /*
   * Narrowed to one piece of work, when a card linked here.
   *
   * At or BELOW it, because that is what the card counted: "10 blockers" on
   * an initiative means ten across everything underneath. A page filtered to
   * the initiative row alone would answer that link with an empty list, which
   * reads as data loss rather than as a filter. See lib/hierarchy.ts.
   */
  const narrow = scopeFilter(scope, projs, wss, inits)

  const open = (s: string) => s !== 'decided' && s !== 'dropped'
  const items: BlockerRow[] = rows
    .filter((d) => narrow.covers(d.entityId))
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
          <h1>Decisions</h1>
        </div>
      </div>

      <RegisterList
        kind="decision"
        rows={items}
        initiatives={inits}
        projects={projs}
        workstreams={wss}
        people={folk}
        closed={closed}
        editing={user.personId ? { people: ctx.people, endpoints: ctx.endpoints } : null}
        scope={narrow.label && scope ? { label: narrow.label, clear: '/decisions', param: scope } : null}
      />
    </div>
  )
}
