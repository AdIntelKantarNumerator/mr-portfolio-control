/**
 * Projects, with the delivery work under each one.
 *
 * The header, the ring, the coloured edge and the find box are the same as
 * the Initiatives page because they are the same question one tier down, and
 * a reader who learned to read that page should not have to learn this one.
 *
 * Everything the old version put in the frame - a sentence explaining the
 * sort order, four counter tiles, a line of recent activity per row, a link
 * to the page the project's own name already links to - has gone. None of it
 * was an answer to anything; all of it was between the reader and the rows.
 */
import { Kicker } from '@/components/ui'
import { cookies } from 'next/headers'
import { HOME_PREFS_COOKIE, resolveHomePrefs } from '@/lib/home-prefs'
import { getPortfolio } from '@/lib/portfolio'
import { getHomeCards } from '@/lib/home'
import { ProjectList, type ProjectRow } from './list'

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
  // The home board's own computation, reused rather than repeated: a ring
  // that means one thing here and another there is worse than no ring.
  const [p, cards] = await Promise.all([getPortfolio(), getHomeCards('project', prefs.sort)])

  const cardById = new Map(cards.map((c) => [c.id, c]))

  // In the order the sort produced. `p.projects` is alphabetical, so without
  // this the picker would change nothing — which is the shape of bug that
  // makes a reader stop trusting a control.
  const rank = new Map(cards.map((c, ix) => [c.id, ix]))
  const ordered = [...p.projects].sort(
    (a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || a.name.localeCompare(b.name),
  )

  const rows: ProjectRow[] = ordered.map((i) => {
    const card = cardById.get(i.id)
    const start = i.startDate ?? i.derivedStart
    const target = i.targetDate ?? i.derivedTarget
    return {
      id: i.id,
      name: i.name,
      status: i.status,
      owner: i.owner?.name ?? null,
      // The editable value is always the project's own date, never the
      // rolled-up one: offering a derived date in a date picker would turn
      // "the workstreams run to November" into a commitment somebody
      // appeared to make, on their first click.
      startDate: iso(i.startDate),
      targetDate: iso(i.targetDate),
      datesRolledUp: (!i.startDate && Boolean(start)) || (!i.targetDate && Boolean(target)),
      health: card?.health ?? null,
      rag: i.health.rag,
      next: card?.next
        ? { name: card.next.name, pct: card.next.pct, expected: card.next.expected, due: card.next.due }
        : null,
      workstreams: i.workstreams.map((w) => ({
        id: w.id,
        name: w.name,
        status: w.status,
        priority: w.priority ?? null,
        progress: w.progress ?? 0,
        lead: w.lead?.name ?? null,
        startDate: iso(w.startDate),
        targetDate: iso(w.targetDate),
        health: {
          rag: w.health.rag,
          rationale: w.health.rationale ?? null,
          evidence: w.health.evidence ?? null,
          origin: w.health.origin,
        },
      })),
    }
  })

  return (
    <div className="stack">
      <div>
        <Kicker>Portfolio</Kicker>
        <h1>Projects</h1>
      </div>

      <ProjectList rows={rows} people={p.people.map((x) => ({ id: x.id, name: x.name }))} sort={prefs.sort} />
    </div>
  )
}
