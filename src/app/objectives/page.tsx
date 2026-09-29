/**
 * Objectives: the grouping tier, and the screen where the grouping is done.
 *
 * The home page reports objectives. This one is where they come from. It
 * deliberately shows the ungrouped initiatives in the same view as the objectives
 * themselves — the whole task is "look at what is loose and decide where it
 * goes", and a create form on a separate page would make that two screens and
 * a memory test.
 */
import { TIER_PLURAL } from '@/lib/home-types'
import { asc, desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { groupingSuggestions, objectives, initiatives, projects, people } from '@/db/schema'
import { Kicker } from '@/components/ui'
import { isEnded } from '@/lib/domain'
import { cookies } from 'next/headers'
import { HOME_PREFS_COOKIE, resolveHomePrefs } from '@/lib/home-prefs'
import { getHomeCards } from '@/lib/home'
import { ObjectiveList, type ObjectiveRow } from './list'
import { Suggestions, type Suggestion } from './suggestions'

export const dynamic = 'force-dynamic'

export default async function ObjectivesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  // The same four sorts as the home board, read the same way, so the order a
  // reader arranged in one place is the order they get in the other.
  const [{ sort: asked }, jar] = await Promise.all([searchParams, cookies()])
  const prefs = resolveHomePrefs({ sort: asked }, jar.get(HOME_PREFS_COOKIE)?.value)
  // The home board's own computation, reused rather than repeated: the ring
  // and the left border on this page have to mean what they mean there, and
  // two implementations of "how far behind is this" would drift.
  const [inits, projs, streams, owners, pending, cards] = await Promise.all([
    db.select().from(objectives).orderBy(asc(objectives.sortOrder), asc(objectives.name)),
    db.select().from(initiatives).orderBy(asc(initiatives.name)),
    db.select({ id: projects.id, initiativeId: projects.initiativeId, status: projects.status }).from(projects),
    db.select({ id: people.id, name: people.name }).from(people),
    db
      .select()
      .from(groupingSuggestions)
      .where(eq(groupingSuggestions.status, 'pending'))
      .orderBy(desc(groupingSuggestions.createdAt)),
    getHomeCards('objective', prefs.sort),
  ])

  const ownerName = new Map(owners.map((p) => [p.id, p.name]))
  const streamsByInitiative = new Map<string, number>()
  for (const s of streams) {
    if (!s.initiativeId || isEnded(s.status)) continue
    streamsByInitiative.set(s.initiativeId, (streamsByInitiative.get(s.initiativeId) ?? 0) + 1)
  }

  const live = projs.filter((p) => !isEnded(p.status))
  const byObjective = new Map<string, typeof live>()
  const loose: typeof live = []
  for (const p of live) {
    if (!p.objectiveId) {
      loose.push(p)
      continue
    }
    byObjective.set(p.objectiveId, [...(byObjective.get(p.objectiveId) ?? []), p])
  }

  // A suggestion names initiative ids she saw at the time. Some may have been
  // grouped or deleted since, and the card says which rather than quietly
  // dropping them — a proposal that has gone stale is a thing worth seeing.
  const projById = new Map(projs.map((p) => [p.id, p]))
  const initById = new Map(inits.map((i) => [i.id, i.name]))
  const suggestions: Suggestion[] = pending.map((s) => ({
    id: s.id,
    name: s.name,
    rationale: s.rationale,
    agent: s.agent,
    initiatives: s.initiativeIds
      .split(',')
      .filter(Boolean)
      .map((id) => {
        const p = projById.get(id)
        return {
          id,
          name: p?.name ?? null,
          grouped: p?.objectiveId ? (initById.get(p.objectiveId) ?? null) : null,
        }
      }),
  }))

  const options = live.map((p) => ({
    id: p.id,
    name: p.name,
    objectiveId: p.objectiveId,
    projects: streamsByInitiative.get(p.id) ?? 0,
  }))

  const cardById = new Map(cards.map((c) => [c.id, c]))
  // In the order the sort produced. The source list is alphabetical, so
  // without this the picker would change nothing — which is the shape of bug
  // that makes a reader stop trusting a control.
  const rank = new Map(cards.map((c, ix) => [c.id, ix]))
  const byRank = <T extends { id: string; name: string }>(a: T, b: T) =>
    (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || a.name.localeCompare(b.name)

  const rows: ObjectiveRow[] = [...inits].sort(byRank).map((i) => {
    const mine = byObjective.get(i.id) ?? []
    const card = cardById.get(i.id)
    return {
      id: i.id,
      name: i.name,
      description: i.description,
      status: i.status,
      owner: i.ownerId ? (ownerName.get(i.ownerId) ?? null) : null,
      initiatives: mine.map((p) => ({
        id: p.id,
        name: p.name,
        projects: streamsByInitiative.get(p.id) ?? 0,
      })),
      projectCount: mine.reduce((n, p) => n + (streamsByInitiative.get(p.id) ?? 0), 0),
      health: card?.health ?? null,
      reasons: card?.reasons ?? [],
    }
  })

  return (
    <div className="stack">
      <div>
        <Kicker>Portfolio</Kicker>
        <h1>{TIER_PLURAL.objective}</h1>
      </div>

      <Suggestions suggestions={suggestions} />

      <ObjectiveList
        sort={prefs.sort}
        rows={rows}
        loose={loose.map((p) => ({ id: p.id, name: p.name, projects: streamsByInitiative.get(p.id) ?? 0 }))}
        options={options}
      />
    </div>
  )
}
