/**
 * Initiatives: the grouping tier, and the screen where the grouping is done.
 *
 * The home page reports initiatives. This one is where they come from. It
 * deliberately shows the ungrouped projects in the same view as the initiatives
 * themselves — the whole task is "look at what is loose and decide where it
 * goes", and a create form on a separate page would make that two screens and
 * a memory test.
 */
import Link from 'next/link'
import { asc, desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { groupingSuggestions, initiatives, projects, workstreams, people } from '@/db/schema'
import { Card, Empty, Kicker, Muted, Pill, type Tone } from '@/components/ui'
import { isEnded } from '@/lib/domain'
import { Grouping } from './grouping'
import { Suggestions, type Suggestion } from './suggestions'

export const dynamic = 'force-dynamic'

const TONE: Record<string, Tone> = {
  active: 'blue',
  paused: 'amber',
  completed: 'green',
  canceled: 'slate',
}

export default async function InitiativesPage() {
  const [inits, projs, streams, owners, pending] = await Promise.all([
    db.select().from(initiatives).orderBy(asc(initiatives.sortOrder), asc(initiatives.name)),
    db.select().from(projects).orderBy(asc(projects.name)),
    db.select({ id: workstreams.id, projectId: workstreams.projectId, status: workstreams.status }).from(workstreams),
    db.select({ id: people.id, name: people.name }).from(people),
    db
      .select()
      .from(groupingSuggestions)
      .where(eq(groupingSuggestions.status, 'pending'))
      .orderBy(desc(groupingSuggestions.createdAt)),
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

  return (
    <div className="stack">
      <div>
        <Kicker>Portfolio</Kicker>
        <h1>Initiatives</h1>
        <Muted>
          An initiative is five to ten projects that are worth reporting as one thing. Nothing here is synced from a
          tracker — the grouping is a judgement somebody makes, and this is where they make it.
        </Muted>
      </div>

      <Suggestions suggestions={suggestions} />

      <Grouping initiatives={inits.map((i) => ({ id: i.id, name: i.name }))} projects={options} />

      {inits.length === 0 ? (
        <Empty>No initiatives yet. Create one above and put some projects in it.</Empty>
      ) : (
        inits.map((i) => {
          const mine = byInitiative.get(i.id) ?? []
          const streamCount = mine.reduce((n, p) => n + (streamsByProject.get(p.id) ?? 0), 0)
          return (
            <Card key={i.id}>
              <div className="flex flex-wrap items-baseline gap-2">
                <Link href={`/initiatives/${i.id}`} className="font-semibold underline decoration-dotted underline-offset-2">
                  {i.name}
                </Link>
                <Pill tone={TONE[i.status] ?? 'slate'}>{i.status}</Pill>
                <Muted>
                  {mine.length} project{mine.length === 1 ? '' : 's'} · {streamCount} workstream
                  {streamCount === 1 ? '' : 's'}
                  {i.ownerId ? ` · ${ownerName.get(i.ownerId) ?? 'unknown owner'}` : ''}
                </Muted>
              </div>

              {i.description && <p className="mt-1 text-sm">{i.description}</p>}

              {mine.length === 0 ? (
                <Muted className="mt-2">
                  Empty. An initiative with no projects shows on the home page as a card with nothing in it.
                </Muted>
              ) : (
                <div className="chips mt-2">
                  {mine.map((p) => (
                    <Link key={p.id} href={`/projects/${p.id}`}>
                      {p.name}
                      <span className="w">{streamsByProject.get(p.id) ?? 0} WS</span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          )
        })
      )}

      {loose.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-baseline gap-2">
            <strong>Not in an initiative</strong>
            <Pill tone="amber">{loose.length}</Pill>
          </div>
          <Muted>
            Running, and on nobody&rsquo;s card. Use the form above to group them — or leave them, and the home page
            will keep saying so.
          </Muted>
          <div className="chips mt-2">
            {loose.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                {p.name}
                <span className="w">{streamsByProject.get(p.id) ?? 0} WS</span>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
