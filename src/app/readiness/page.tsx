/**
 * Is the documented process actually being followed.
 *
 * The matrix, and nothing else. The four counter tiles counted what the matrix
 * shows; the two paragraphs explained a rule the matrix does not depend on
 * anybody remembering; the roll-up table under it asked a second question on a
 * screen that already had one.
 *
 * WHY IT READS AT THREE LEVELS
 *
 * Readiness is recorded per workstream, which is where the work is. But the
 * conversation is usually about a project or an initiative — "is GPC ready" —
 * and answering it meant reading twelve rows and adding up. A project row is
 * the sum of its workstreams, and clicking one of its cells opens the items of
 * each workstream beneath it, named, so the level you can see the problem at is
 * also the level you can fix it from.
 */
import { asc } from 'drizzle-orm'
import { db } from '@/db/client'
import { initiatives, projects, workstreams } from '@/db/schema'
import { Kicker } from '@/components/ui'
import { label } from '@/lib/domain'
import { getReadiness, statusFor } from '@/lib/readiness'
import { ReadinessMatrix, type GateHead, type ItemCell, type Level, type MatrixRow } from './matrix'

export const metadata = { title: 'Readiness · Portfolio Control Room' }

// Edited from here and from the per-workstream screen; a cached render would
// show somebody a checklist that has already moved.
export const dynamic = 'force-dynamic'

const LEVELS: Level[] = ['initiative', 'project', 'workstream']
const isLevel = (v: string | undefined): v is Level => LEVELS.includes(v as Level)

/** Grouped by how much the answer matters, not alphabetically. */
const STATUS_RANK: Record<string, number> = {
  in_progress: 0,
  active: 0,
  planned: 1,
  paused: 2,
  backlog: 3,
  completed: 4,
}

export default async function ReadinessPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string }>
}) {
  const { level: raw } = await searchParams
  const level: Level = isLevel(raw) ? raw : 'workstream'

  const [model, inits, projs, wss] = await Promise.all([
    getReadiness(),
    db.select().from(initiatives).orderBy(asc(initiatives.name)),
    db.select().from(projects).orderBy(asc(projects.name)),
    db.select().from(workstreams).orderBy(asc(workstreams.name)),
  ])

  const live = wss.filter((w) => w.status !== 'canceled')

  // Which workstreams roll up into each row at this level. Readiness only
  // exists on a workstream, so every row is ultimately a set of them.
  const beneath = (id: string): typeof live => {
    if (level === 'workstream') return live.filter((w) => w.id === id)
    if (level === 'project') return live.filter((w) => w.projectId === id)
    const mine = new Set(projs.filter((p) => p.initiativeId === id).map((p) => p.id))
    return live.filter((w) => w.projectId && mine.has(w.projectId))
  }

  const source =
    level === 'initiative'
      ? inits.filter((i) => i.status !== 'canceled').map((i) => ({ id: i.id, name: i.name, status: i.status, href: `/initiatives/${i.id}` }))
      : level === 'project'
        ? projs.filter((p) => p.status !== 'canceled').map((p) => ({ id: p.id, name: p.name, status: p.status, href: `/projects/${p.id}` }))
        : live.map((w) => ({ id: w.id, name: w.name, status: w.status, href: `/readiness/${w.id}` }))

  const gates: GateHead[] = model.gates.map((g) => ({ id: g.id, name: g.name, phase: g.phase }))

  const rows: MatrixRow[] = source.map((row) => {
    const mine = beneath(row.id)
    const cells: MatrixRow['cells'] = {}
    let allDone = 0
    let allTotal = 0

    for (const gate of model.gates) {
      const items: ItemCell[] = []
      let done = 0
      let total = 0
      for (const w of mine) {
        for (const item of gate.items) {
          const status = statusFor(model, w.id, item.id)
          // Only required items are counted, and `na` counts as satisfied:
          // deciding something does not apply is a completed judgement, not an
          // outstanding obligation. Optional items are still offered in the
          // popup — they are just not what the number is about.
          if (item.required) {
            total += 1
            if (status === 'done' || status === 'na') done += 1
          }
          items.push({
            itemId: item.id,
            label: item.label,
            required: item.required,
            status,
            workstreamId: w.id,
            workstreamName: w.name,
          })
        }
      }
      cells[gate.id] = { done, total, items }
      allDone += done
      allTotal += total
    }

    return {
      id: row.id,
      name: row.name,
      status: label('projectStatus', row.status) || row.status,
      href: row.href,
      cells,
      overall: { done: allDone, total: allTotal },
    }
  })

  rows.sort((a, b) => {
    const ra = STATUS_RANK[a.status.toLowerCase().replace(' ', '_')] ?? 9
    const rb = STATUS_RANK[b.status.toLowerCase().replace(' ', '_')] ?? 9
    return ra === rb ? a.name.localeCompare(b.name) : ra - rb
  })

  const statuses = [...new Set(rows.map((r) => r.status))].sort((a, b) => a.localeCompare(b))

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Work in progress</Kicker>
          <h1>Readiness</h1>
        </div>
      </div>

      <ReadinessMatrix rows={rows} gates={gates} level={level} statuses={statuses} />
    </div>
  )
}
