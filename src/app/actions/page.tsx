/**
 * Action items: what people said they would do.
 *
 * The third register, beside decisions and blockers, and the one with the
 * shortest half-life — a commitment made in a meeting is worth something for
 * about a fortnight and nothing after that. So this page leads with what is
 * overdue and what has nobody's name on it, because those are the two states
 * that a list sorted by date hides.
 *
 * Almost everything here is written by Yaara out of meeting notes. The edits
 * offered are exactly the ones she gets wrong: nobody named, and no date.
 */
import Link from 'next/link'
import { asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { actionItemLinks, actionItems, initiatives, people, projects, workstreams } from '@/db/schema'
import { Empty, Kicker, Muted, Pill } from '@/components/ui'
import { ActionRow } from './row'

export const dynamic = 'force-dynamic'

const HREF: Record<string, string> = {
  initiative: '/initiatives',
  project: '/projects',
  workstream: '/workstreams',
}

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>
}) {
  const { show } = await searchParams
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
    db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives),
    db.select({ id: projects.id, name: projects.name }).from(projects),
    db.select({ id: workstreams.id, name: workstreams.name }).from(workstreams),
  ])

  const nameOf = new Map(folk.map((p) => [p.id, p.name]))
  const entityName = new Map<string, string>()
  for (const g of groups) entityName.set(`initiative:${g.id}`, g.name)
  for (const p of projs) entityName.set(`project:${p.id}`, p.name)
  for (const w of streams) entityName.set(`workstream:${w.id}`, w.name)

  const linksFor = new Map<string, { level: string; id: string; name: string; href: string }[]>()
  for (const l of links) {
    const name = entityName.get(`${l.level}:${l.entityId}`)
    if (!name) continue
    linksFor.set(l.actionItemId, [
      ...(linksFor.get(l.actionItemId) ?? []),
      { level: l.level, id: l.entityId, name, href: `${HREF[l.level] ?? '/'}/${l.entityId}` },
    ])
  }

  const today = new Date().toISOString().slice(0, 10)
  const items = rows.map((a) => ({
    id: a.id,
    ref: a.ref,
    text: a.text,
    ownerId: a.ownerId,
    owner: a.ownerId ? (nameOf.get(a.ownerId) ?? null) : a.ownerName,
    unowned: !a.ownerId && !a.ownerName,
    due: a.dueDate ? a.dueDate.toISOString().slice(0, 10) : null,
    overdue: Boolean(a.dueDate && a.dueDate.toISOString().slice(0, 10) < today),
    status: a.status,
    source: a.sourceTitle,
    sourceUrl: a.sourceUrl,
    author: a.authoredBy,
    links: linksFor.get(a.id) ?? [],
  }))

  // Overdue, then unowned, then dated, then the rest. Sorting by date alone
  // buries the two states that actually need somebody — an overdue item and a
  // commitment with nobody's name on it — under next month's tidy rows.
  const rank = (i: (typeof items)[number]) => (i.overdue ? 0 : i.unowned ? 1 : i.due ? 2 : 3)
  items.sort((a, b) => rank(a) - rank(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999'))

  const overdue = items.filter((i) => i.overdue).length
  const unowned = items.filter((i) => i.unowned).length

  return (
    <div className="stack">
      <div>
        <Kicker>Register</Kicker>
        <h1>Action items</h1>
        <Muted>
          What people said they would do, read out of meeting notes. A person, a thing and a date — the two that go
          missing are the name and the date, and both are editable here.
        </Muted>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <Pill tone={closed ? 'slate' : 'blue'}>{items.length} {closed ? 'closed' : 'open'}</Pill>
          {!closed && overdue > 0 && <Pill tone="red">{overdue} overdue</Pill>}
          {!closed && unowned > 0 && <Pill tone="amber">{unowned} with nobody named</Pill>}
          <Link
            href={closed ? '/actions' : '/actions?show=closed'}
            className="text-sm underline decoration-dotted underline-offset-2"
          >
            {closed ? 'Show open' : 'Show closed and dropped'}
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <Empty>
          {closed
            ? 'Nothing has been closed or dropped yet.'
            : 'Nothing outstanding. Yaara writes these out of the meeting notes she reads — if a meeting produced commitments and none are here, check whether she has the document.'}
        </Empty>
      ) : (
        <div className="acts">
          {items.map((a) => (
            <ActionRow key={a.id} item={a} people={folk} />
          ))}
        </div>
      )}
    </div>
  )
}
