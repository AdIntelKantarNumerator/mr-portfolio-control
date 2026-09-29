/**
 * Every project, findable by name.
 *
 * The detail page has always existed; there was no way to reach it.
 * Projects were visible only nested under the initiative that owns them,
 * which works right up until the thing you are looking for has no initiative -
 * exactly what a project converted from intake looks like on the day it
 * is created. Someone who had just created one could not find it again.
 *
 * Same row shape, ring and edge colour as Initiatives and Objectives: this is
 * the same question one tier further down, and it should not need to be
 * read differently.
 */
import { Kicker } from '@/components/ui'
import { cookies } from 'next/headers'
import { HOME_PREFS_COOKIE, resolveHomePrefs } from '@/lib/home-prefs'
import { getPortfolio } from '@/lib/portfolio'
import { getHomeCards } from '@/lib/home'
import { ProjectList, type WsListRow } from './list'

// This page reads the live portfolio; prerendering it would serve stale data.
export const dynamic = 'force-dynamic'

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  // The same four sorts as the home board, read the same way, so the order a
  // reader arranged in one place is the order they get in the other.
  const [{ sort: asked }, jar] = await Promise.all([searchParams, cookies()])
  const prefs = resolveHomePrefs({ sort: asked }, jar.get(HOME_PREFS_COOKIE)?.value)
  const [p, cards] = await Promise.all([getPortfolio(), getHomeCards('project', prefs.sort)])

  const cardById = new Map(cards.map((c) => [c.id, c]))
  const initiativeById = new Map(p.initiatives.map((i) => [i.id, i]))

  // In the order the sort produced. The source list is alphabetical, so
  // without this the picker would change nothing — which is the shape of bug
  // that makes a reader stop trusting a control.
  const rank = new Map(cards.map((c, ix) => [c.id, ix]))
  const byRank = <T extends { id: string; name: string }>(a: T, b: T) =>
    (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || a.name.localeCompare(b.name)

  const rows: WsListRow[] = [...p.projects].sort(byRank).map((w) => {
    const card = cardById.get(w.id)
    const parent = w.initiativeId ? initiativeById.get(w.initiativeId) : null
    return {
      id: w.id,
      name: w.name,
      status: w.status,
      priority: w.priority ?? null,
      progress: w.progress ?? 0,
      lead: w.lead?.name ?? null,
      team: w.team?.name ?? null,
      startDate: iso(w.startDate),
      targetDate: iso(w.targetDate),
      initiative: parent ? { id: parent.id, name: parent.name } : null,
      health: {
        rag: w.health.rag,
        rationale: w.health.rationale ?? null,
        evidence: w.health.evidence ?? null,
        origin: w.health.origin,
      },
      pace: card?.health ?? null,
      reasons: card?.reasons ?? [],
    }
  })

  return (
    <div className="stack">
      <div>
        <Kicker>Portfolio</Kicker>
        <h1>Projects</h1>
      </div>

      <ProjectList sort={prefs.sort} rows={rows} people={p.people.map((x) => ({ id: x.id, name: x.name }))} />
    </div>
  )
}
