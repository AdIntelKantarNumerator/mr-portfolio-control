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
import { asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { decisionEvents, decisions, objectives, people, initiatives, sourceDocuments, projects } from '@/db/schema'
import { Kicker } from '@/components/ui'
import { addContext } from '@/lib/add-context'
import { scopeFilter } from '@/lib/scope-filter'
import { isOpenEntry } from '@/lib/domain'
import { provenanceOfEntry, type Mention } from '@/lib/provenance'
import { getCurrentUser } from '@/lib/auth/current-user'
import { RegisterList, type BlockerRow, type Named } from '@/components/records/register-list'
import { EditEntryButton } from '@/components/records/edit-entry'
import { dashboardFor } from '@/lib/items-dashboard'
import { HealthTile, TopItems, WithdrawAll } from '@/components/items/parts'

export const metadata = { title: 'Blockers' }
export const dynamic = 'force-dynamic'

export default async function BlockersPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; scope?: string; focus?: string }>
}) {
  const { show, scope, focus } = await searchParams
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
    db.select({ id: objectives.id, name: objectives.name }).from(objectives).orderBy(asc(objectives.name)),
    db
      .select({ id: initiatives.id, name: initiatives.name, objectiveId: initiatives.objectiveId })
      .from(initiatives)
      .orderBy(asc(initiatives.name)),
    db
      .select({ id: projects.id, name: projects.name, initiativeId: projects.initiativeId })
      .from(projects)
      .orderBy(asc(projects.name)),
    db.select({ id: people.id, name: people.name }).from(people).orderBy(asc(people.name)),
    // The same context the detail-page dialogs use, so the two surfaces offer
    // the same options rather than two lists that drift.
    addContext(),
    getCurrentUser(),
  ])

  /*
   * Where each entry was raised. Two more queries rather than a join, because
   * the register reads whole rows already and both of these are small: one
   * mention row per time a thing was discussed, and one document row per
   * meeting somebody read. See lib/provenance.ts for what is made of them.
   */
  const ids = rows.map((d) => d.id)
  const [events, docs] = await Promise.all([
    ids.length ? db.select().from(decisionEvents).where(inArray(decisionEvents.decisionId, ids)) : [],
    db.select().from(sourceDocuments),
  ])
  const docById = new Map(docs.map((d) => [d.id, d]))
  const eventsFor = new Map<string, Mention[]>()
  for (const e of events) {
    eventsFor.set(e.decisionId, [
      ...(eventsFor.get(e.decisionId) ?? []),
      {
        kind: e.kind,
        where: e.meeting ?? docById.get(e.documentId ?? '')?.title ?? null,
        when: e.occurredAt ? e.occurredAt.toISOString().slice(0, 10) : null,
        who: e.actor,
        note: e.note,
        url: e.url ?? docById.get(e.documentId ?? '')?.url ?? null,
      },
    ])
  }

  const nameOf = new Map(folk.map((p) => [p.id, p.name]))
  const named = new Map<string, Named>()
  for (const i of inits) named.set(`objective:${i.id}`, i)
  for (const p of projs) named.set(`initiative:${p.id}`, p)
  for (const w of wss) named.set(`project:${w.id}`, w)

  /*
   * Narrowed to one piece of work, when a card linked here.
   *
   * At or BELOW it, because that is what the card counted: "10 blockers" on
   * an objective means ten across everything underneath. A page filtered to
   * the objective row alone would answer that link with an empty list, which
   * reads as data loss rather than as a filter. See lib/hierarchy.ts.
   */
  const narrow = scopeFilter(scope, projs, wss, inits)

  const items: BlockerRow[] = rows
    .filter((d) => narrow.covers(d.entityId))
    .filter((d) => (closed ? !isOpenEntry(d.status) : isOpenEntry(d.status)))
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
      source: provenanceOfEntry({
        evidence: d.evidence,
        raisedAtMeeting: d.raisedAtMeeting,
        raisedAt: d.raisedAt,
        raisedBy: d.raisedById ? (nameOf.get(d.raisedById) ?? d.raisedByText) : d.raisedByText,
        document: d.raisedDocumentId ? (docById.get(d.raisedDocumentId) ?? null) : null,
        resolvedAtMeeting: d.resolvedAtMeeting,
        resolvedAt: d.resolvedAt,
        events: eventsFor.get(d.id) ?? [],
      }),
    }))

  // Open before watching, then oldest first: a blocker's age is the thing
  // that makes it worth looking at, and a list sorted by name buries it.
  const rank = (r: BlockerRow) => (r.status === 'open' ? 0 : r.status === 'watch' ? 1 : 2)
  items.sort((a, b) => rank(a) - rank(b) || (a.raisedAt ?? '9999').localeCompare(b.raisedAt ?? '9999'))

  // The dashboard (Scott, 5 October 2026): closure health and the top five
  // at the top, then the open blockers, then the ones nobody has touched for a
  // week. Resolved and dropped keep the plain list behind "Show resolved".
  if (closed) {
    return (
      <div className="stack">
        <div className="titlerow">
          <div>
            <Kicker>Work in progress</Kicker>
            <h1>Blockers</h1>
          </div>
        </div>
        <RegisterList
          kind="blocker"
          rows={items}
          objectives={inits}
          initiatives={projs}
          projects={wss}
          people={folk}
          closed={closed}
          editing={user.personId ? { people: ctx.people, endpoints: ctx.endpoints } : null}
          scope={narrow.label && scope ? { label: narrow.label, clear: '/blockers', param: scope } : null}
        />
      </div>
    )
  }

  const dash = await dashboardFor('blocker', scope)
  // The top five are shown once, in their tile; the list is everything else
  // that is open (Scott, 5 October 2026).
  const top = new Set(dash.top.map((t) => t.ref))
  // Everything open, active and inactive, top five included: the list's own
  // switches decide which of those to show (Scott, 6 October 2026).
  const openRows = items.filter((r) => dash.activeRefs.has(r.ref) || dash.inactiveRefs.has(r.ref))
  const inactiveCount = items.filter((r) => dash.inactiveRefs.has(r.ref)).length
  const editingCtx = user.personId ? { people: ctx.people, endpoints: ctx.endpoints } : null
  const scoped = narrow.label && scope ? { label: narrow.label, clear: '/blockers', param: scope } : null
  // The same edit button the list rows have, for each of the top five.
  const edits: Record<string, React.ReactNode> = {}
  if (editingCtx) {
    for (const r of items) {
      if (top.has(r.ref)) edits[r.ref] = <EditEntryButton kind="blocker" id={r.id} ctx={editingCtx} label={r.title} />
    }
  }

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Work in progress</Kicker>
          <h1>{dash.scopeName ? `Blockers: ${dash.scopeName}` : 'Blockers'}</h1>
        </div>
      </div>

      <div className="imp-tiles">
        <HealthTile rag={dash.health.rag} facts={dash.health.facts} noun="blockers" />
        <TopItems items={dash.top} noun="blockers" edits={edits} />
      </div>

      <section className="tile imp-section">
        <p className="ptitle">All blockers</p>
        <RegisterList
          kind="blocker"
          rows={openRows}
          objectives={inits}
          initiatives={projs}
          projects={wss}
          people={folk}
          closed={false}
          editing={editingCtx}
          scope={scoped}
          info={dash.info}
          variant="open"
          focus={focus}
          topRefs={dash.top.map((t) => t.ref)}
          withdraw={<WithdrawAll kind="blocker" scope={dash.scope} count={inactiveCount} noun="inactive blockers" />}
        />
      </section>

    </div>
  )
}
