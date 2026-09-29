/**
 * Action items: what people said they would do.
 *
 * The third register, beside blockers and dependencies, and the one with the
 * shortest half-life — a commitment made in a meeting is worth something for
 * about a fortnight and nothing after that.
 *
 * It is one table with columns rather than a stack of cards, because the
 * question people arrive with is "what is outstanding on GPC" or "what does
 * Priya owe", and neither is answerable by reading cards in a fixed order. The
 * standing paragraph explaining the page is gone with the cards: a page that
 * has to introduce itself every visit is charging for a sentence its reader
 * needed once.
 */
import { asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { actionItemLinks, actionItems, initiatives, people, projects, workstreams } from '@/db/schema'
import { isTier, placeOf, TIERS, type Tier } from '@/lib/hierarchy'
import { scopeFilter } from '@/lib/scope-filter'
import { Kicker } from '@/components/ui'
import { ActionsList, type ActionRowView } from './list'

export const dynamic = 'force-dynamic'

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; scope?: string }>
}) {
  const { show, scope } = await searchParams
  const closed = show === 'closed'

  const [rows, links, folk, groups, projs, streams] = await Promise.all([
    closed
      ? db
          .select()
          .from(actionItems)
          .where(inArray(actionItems.status, ['done', 'dropped']))
          .orderBy(desc(actionItems.updatedAt))
          .limit(200)
      : db.select().from(actionItems).where(eq(actionItems.status, 'open')),
    db.select().from(actionItemLinks),
    db.select({ id: people.id, name: people.name }).from(people).orderBy(asc(people.name)),
    db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives).orderBy(asc(initiatives.name)),
    db
      .select({ id: projects.id, name: projects.name, initiativeId: projects.initiativeId })
      .from(projects)
      .orderBy(asc(projects.name)),
    db
      .select({ id: workstreams.id, name: workstreams.name, projectId: workstreams.projectId })
      .from(workstreams)
      .orderBy(asc(workstreams.name)),
  ])

  const nameOf = new Map(folk.map((p) => [p.id, p.name]))
  const named = new Map<string, { id: string; name: string }>()
  for (const g of groups) named.set(`initiative:${g.id}`, g)
  for (const p of projs) named.set(`project:${p.id}`, p)
  for (const w of streams) named.set(`workstream:${w.id}`, w)

  /*
   * Where each item sits, filled in UPWARDS from the tier it was filed at.
   *
   * The page used to read only the link's own tier, so an action filed against
   * a workstream showed that workstream and "Unknown" for both the project and
   * the initiative above it. A tier above is never unknown - it is a fact about
   * where the work sits. A tier below stays unknown, because nothing says which
   * one it would be. See lib/hierarchy.ts.
   */
  const parents = {
    projectOf: new Map(streams.map((w) => [w.id, w.projectId])),
    initiativeOf: new Map(projs.map((p) => [p.id, p.initiativeId])),
  }

  /*
   * Where each item sits. An explicitly filed tier beats one inferred from
   * another link, whatever order the rows arrive in — see placeOf.
   */
  const byItem = new Map<string, Array<{ level: Tier; id: string }>>()
  for (const l of links) {
    if (!isTier(l.level) || !named.has(`${l.level}:${l.entityId}`)) continue
    byItem.set(l.actionItemId, [...(byItem.get(l.actionItemId) ?? []), { level: l.level, id: l.entityId }])
  }

  const linkFor = new Map<string, Record<string, { id: string; name: string }>>()
  for (const [itemId, ls] of byItem) {
    const at = placeOf(ls, parents)
    const row: Record<string, { id: string; name: string }> = {}
    for (const tier of TIERS) {
      const entity = at[tier] ? named.get(`${tier}:${at[tier]}`) : undefined
      if (entity) row[tier] = entity
    }
    linkFor.set(itemId, row)
  }

  /*
   * Narrowed to one piece of work, when a card linked here. At or below it,
   * matching what the card counted. See lib/scope-filter.ts.
   */
  const narrow = scopeFilter(scope, projs, streams, groups)
  // Against the item's whole ancestry, not just the tier it was filed at: an
  // action on a workstream belongs to the initiative above it, which is what
  // the card that linked here counted.
  const inScope = (id: string) =>
    Object.values(linkFor.get(id) ?? {}).some((e) => narrow.covers(e.id))

  const today = new Date().toISOString().slice(0, 10)
  const items: ActionRowView[] = rows
    .filter((a) => !narrow.label || inScope(a.id))
    .map((a) => {
      const at = linkFor.get(a.id) ?? {}
      const due = a.dueDate ? a.dueDate.toISOString().slice(0, 10) : null
      return {
        id: a.id,
        ref: a.ref,
        text: a.text,
        ownerId: a.ownerId,
        owner: a.ownerId ? (nameOf.get(a.ownerId) ?? null) : a.ownerName,
        due,
        overdue: Boolean(due && due < today && a.status === 'open'),
        status: a.status,
        initiative: at.initiative ?? null,
        project: at.project ?? null,
        workstream: at.workstream ?? null,
      }
    })

  // Overdue, then unowned, then dated, then the rest. Sorting by date alone
  // buries the two states that actually need somebody — an overdue item and a
  // commitment with nobody's name on it — under next month's tidy rows. The
  // filters are how you ask a different question; this is the default answer.
  const rank = (i: ActionRowView) => (i.overdue ? 0 : !i.owner ? 1 : i.due ? 2 : 3)
  items.sort((a, b) => rank(a) - rank(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999'))

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Work in progress</Kicker>
          <h1>Action items</h1>
        </div>
      </div>

      <ActionsList
        rows={items}
        people={folk}
        initiatives={groups}
        projects={projs}
        workstreams={streams}
        closed={closed}
        scope={narrow.label && scope ? { label: narrow.label, clear: '/actions', param: scope } : null}
      />
    </div>
  )
}
