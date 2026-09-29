/**
 * Dependencies: what is waiting on what.
 *
 * One list with filters, and an Add button. The counter tiles, the graph, the
 * team matrix and the two explanatory paragraphs are gone — each was answering
 * a question somebody might have, and none was answering the one people arrive
 * with, which is "what is waiting on what, and is any of it about to bite".
 *
 * The required date is now load-bearing rather than decorative: a dependency
 * whose delivering end will miss it marks that work blocked on the board. See
 * lib/dependency-risk.ts for exactly what "will miss" means and why it is the
 * delivering end that goes red.
 */
import { TIER_PLURAL } from '@/lib/home-types'
import { asc } from 'drizzle-orm'
import { db } from '@/db/client'
import { dependencies, objectives, milestones, people, initiatives, projects } from '@/db/schema'
import { Kicker } from '@/components/ui'
import { lateness } from '@/lib/dependency-risk'
import { getCurrentUser } from '@/lib/auth/current-user'
import { DependencyList, type DependencyRow, type EndpointOption } from './list'

export const metadata = { title: 'Dependencies' }
export const dynamic = 'force-dynamic'

const HREF: Record<string, string> = {
  objective: '/objectives',
  initiative: '/initiatives',
  project: '/projects',
}

const ENDED = new Set(['completed', 'canceled'])

export default async function DependenciesPage() {
  const [deps, inits, projs, wss, ms, folk, user] = await Promise.all([
    db.select().from(dependencies),
    db.select().from(objectives).orderBy(asc(objectives.name)),
    db.select().from(initiatives).orderBy(asc(initiatives.name)),
    db.select().from(projects).orderBy(asc(projects.name)),
    db.select().from(milestones),
    db.select({ id: people.id, name: people.name }).from(people).orderBy(asc(people.name)),
    getCurrentUser(),
  ])

  const nameOf = new Map(folk.map((p) => [p.id, p.name]))

  // One index for both ends of every row: the label to show, the page to link
  // to, and the two facts that decide whether the date is going to be missed.
  const known = new Map<
    string,
    { label: string; href: string | null; targetDate: Date | null; done: boolean }
  >()
  for (const i of inits)
    known.set(`objective:${i.id}`, {
      label: i.name,
      href: `/objectives/${i.id}`,
      targetDate: i.targetDate,
      done: ENDED.has(i.status),
    })
  for (const p of projs)
    known.set(`initiative:${p.id}`, {
      label: p.name,
      href: `/initiatives/${p.id}`,
      targetDate: p.targetDate,
      done: ENDED.has(p.status),
    })
  for (const w of wss)
    known.set(`project:${w.id}`, {
      label: w.name,
      href: `/projects/${w.id}`,
      targetDate: w.targetDate,
      done: ENDED.has(w.status),
    })
  for (const m of ms)
    known.set(`milestone:${m.id}`, {
      label: m.name,
      // A milestone has no page of its own, so it links to whatever it hangs
      // off — which is not always a project: the same table carries
      // milestones at all three levels.
      href: m.entityId && HREF[m.level] ? `${HREF[m.level]}/${m.entityId}` : null,
      targetDate: m.targetDate,
      done: m.status === 'complete',
    })

  const endAt = (type: string, id: string, fallback: string | null) =>
    known.get(`${type}:${id}`) ?? { label: fallback ?? id, href: null, targetDate: null, done: false }

  const rows: DependencyRow[] = deps.map((d) => {
    const from = endAt(d.fromType, d.fromId, d.fromLabel)
    const to = endAt(d.toType, d.toId, d.toLabel)
    return {
      id: d.id,
      from: { label: from.label, href: from.href },
      to: { label: to.label, href: to.href },
      kind: d.kind,
      status: d.status,
      criticality: d.criticality,
      owner: d.ownerId ? (nameOf.get(d.ownerId) ?? null) : null,
      required: d.dueDate ? d.dueDate.toISOString().slice(0, 10) : null,
      late: lateness(d, known.has(`${d.fromType}:${d.fromId}`) ? from : null),
      description: d.description,
    }
  })

  // Trouble first: a list you scan for what needs doing should not open on
  // the rows that need nothing.
  const rank = (r: DependencyRow) =>
    r.late === 'overdue' ? 0 : r.late ? 1 : r.status === 'at_risk' ? 2 : r.status === 'open' ? 3 : 4
  rows.sort((a, b) => rank(a) - rank(b) || (a.required ?? '9999').localeCompare(b.required ?? '9999'))

  const endpoints: EndpointOption[] = [
    ...inits.map((i) => ({ value: `objective:${i.id}`, label: i.name, group: TIER_PLURAL.objective })),
    ...projs.map((p) => ({ value: `initiative:${p.id}`, label: p.name, group: 'Initiatives' })),
    ...wss.filter((w) => !ENDED.has(w.status)).map((w) => ({ value: `project:${w.id}`, label: w.name, group: 'Projects' })),
    ...ms
      .filter((m) => m.status !== 'complete')
      .map((m) => ({
        value: `milestone:${m.id}`,
        label: `${known.get(`${m.level}:${m.entityId}`)?.label ?? 'Milestone'} — ${m.name}`,
        group: 'Milestones',
      })),
  ]

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Work in progress</Kicker>
          <h1>Dependencies</h1>
        </div>
      </div>

      <DependencyList
        rows={rows}
        endpoints={endpoints}
        people={folk}
        editing={user.personId ? { people: folk, endpoints } : null}
      />
    </div>
  )
}
