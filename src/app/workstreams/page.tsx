/**
 * Every workstream, findable by name.
 *
 * The detail page has always existed; there was no way to reach it.
 * Workstreams were visible only nested under the project that owns them,
 * which works right up until the thing you are looking for has no project -
 * exactly what a workstream converted from intake looks like on the day it
 * is created. Someone who had just created one could not find it again.
 *
 * Same row shape, ring and edge colour as Projects and Initiatives: this is
 * the same question one tier further down, and it should not need to be
 * read differently.
 */
import { Kicker } from '@/components/ui'
import { getPortfolio } from '@/lib/portfolio'
import { getHomeCards } from '@/lib/home'
import { WorkstreamList, type WsListRow } from './list'

// This page reads the live portfolio; prerendering it would serve stale data.
export const dynamic = 'force-dynamic'

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export default async function WorkstreamsPage() {
  const [p, cards] = await Promise.all([getPortfolio(), getHomeCards('workstream')])

  const cardById = new Map(cards.map((c) => [c.id, c]))
  const projectById = new Map(p.projects.map((i) => [i.id, i]))

  const rows: WsListRow[] = p.workstreams.map((w) => {
    const card = cardById.get(w.id)
    const parent = w.projectId ? projectById.get(w.projectId) : null
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
      project: parent ? { id: parent.id, name: parent.name } : null,
      health: {
        rag: w.health.rag,
        rationale: w.health.rationale ?? null,
        evidence: w.health.evidence ?? null,
        origin: w.health.origin,
      },
      pace: card?.health ?? null,
      next: card?.next
        ? { name: card.next.name, pct: card.next.pct, expected: card.next.expected, due: card.next.due }
        : null,
    }
  })

  return (
    <div className="stack">
      <div>
        <Kicker>Portfolio</Kicker>
        <h1>Workstreams</h1>
      </div>

      <WorkstreamList rows={rows} people={p.people.map((x) => ({ id: x.id, name: x.name }))} />
    </div>
  )
}
