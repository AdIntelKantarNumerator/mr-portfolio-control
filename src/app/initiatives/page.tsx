/**
 * Initiatives: the grouping tier, and the screen where the grouping is done.
 *
 * The home page reports initiatives. This one is where they come from. It
 * deliberately shows the ungrouped projects in the same view as the initiatives
 * themselves — the whole task is "look at what is loose and decide where it
 * goes", and a create form on a separate page would make that two screens and
 * a memory test.
 */
import { asc, desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { groupingSuggestions, initiatives, projects, workstreams, people } from '@/db/schema'
import { Kicker } from '@/components/ui'
import { isEnded } from '@/lib/domain'
import { getHomeCards } from '@/lib/home'
import { InitiativeList, type InitiativeRow } from './list'
import { Suggestions, type Suggestion } from './suggestions'

export const dynamic = 'force-dynamic'

export default async function InitiativesPage() {
  // The home board's own computation, reused rather than repeated: the ring
  // and the left border on this page have to mean what they mean there, and
  // two implementations of "how far behind is this" would drift.
  const [inits, projs, streams, owners, pending, cards] = await Promise.all([
    db.select().from(initiatives).orderBy(asc(initiatives.sortOrder), asc(initiatives.name)),
    db.select().from(projects).orderBy(asc(projects.name)),
    db.select({ id: workstreams.id, projectId: workstreams.projectId, status: workstreams.status }).from(workstreams),
    db.select({ id: people.id, name: people.name }).from(people),
    db
      .select()
      .from(groupingSuggestions)
      .where(eq(groupingSuggestions.status, 'pending'))
      .orderBy(desc(groupingSuggestions.createdAt)),
    getHomeCards('initiative'),
  ])

  const ownerName = new Map(owners.map((p) => [p.id, p.name]))
  const streamsByProject = new Map<string, number>()
  for (const s of streams) {
    if (!s.projectId || isEnded(s.status)) continue
    streamsByProject.set(s.projectId, (streamsByProject.get(s.projectId) ?? 0) + 1)
  }

  const live = projs.filter((p) => !isEnded(p.status))
  const byInitiative = new Map<string, typeof live>()
  const loose: typeof live = []
  for (const p of live) {
    if (!p.initiativeId) {
      loose.push(p)
      continue
    }
    byInitiative.set(p.initiativeId, [...(byInitiative.get(p.initiativeId) ?? []), p])
  }

  // A suggestion names project ids she saw at the time. Some may have been
  // grouped or deleted since, and the card says which rather than quietly
  // dropping them — a proposal that has gone stale is a thing worth seeing.
  const projById = new Map(projs.map((p) => [p.id, p]))
  const initById = new Map(inits.map((i) => [i.id, i.name]))
  const suggestions: Suggestion[] = pending.map((s) => ({
    id: s.id,
    name: s.name,
    rationale: s.rationale,
    agent: s.agent,
    projects: s.projectIds
      .split(',')
      .filter(Boolean)
      .map((id) => {
        const p = projById.get(id)
        return {
          id,
          name: p?.name ?? null,
          grouped: p?.initiativeId ? (initById.get(p.initiativeId) ?? null) : null,
        }
      }),
  }))

  const options = live.map((p) => ({
    id: p.id,
    name: p.name,
    initiativeId: p.initiativeId,
    workstreams: streamsByProject.get(p.id) ?? 0,
  }))

  const cardById = new Map(cards.map((c) => [c.id, c]))
  const rows: InitiativeRow[] = inits.map((i) => {
    const mine = byInitiative.get(i.id) ?? []
    const card = cardById.get(i.id)
    return {
      id: i.id,
      name: i.name,
      description: i.description,
      status: i.status,
      owner: i.ownerId ? (ownerName.get(i.ownerId) ?? null) : null,
      projects: mine.map((p) => ({
        id: p.id,
        name: p.name,
        workstreams: streamsByProject.get(p.id) ?? 0,
      })),
      workstreamCount: mine.reduce((n, p) => n + (streamsByProject.get(p.id) ?? 0), 0),
      health: card?.health ?? null,
      next: card?.next
        ? { name: card.next.name, pct: card.next.pct, expected: card.next.expected, due: card.next.due }
        : null,
    }
  })

  return (
    <div className="stack">
      <div>
        <Kicker>Portfolio</Kicker>
        <h1>Initiatives</h1>
      </div>

      <Suggestions suggestions={suggestions} />

      <InitiativeList
        rows={rows}
        loose={loose.map((p) => ({ id: p.id, name: p.name, workstreams: streamsByProject.get(p.id) ?? 0 }))}
        options={options}
      />
    </div>
  )
}
