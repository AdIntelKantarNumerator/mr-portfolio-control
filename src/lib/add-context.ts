/**
 * What the "+" on a register tile needs to offer.
 *
 * Loaded once per detail page rather than per tile: all four dialogs want the
 * same two lists, and four copies of them would be four queries for one
 * screen.
 */
import { TIER_PLURAL } from './home-types'
import { asc } from 'drizzle-orm'
import { cache } from 'react'
import { db } from '@/db/client'
import { objectives, milestones, people, initiatives, projects } from '@/db/schema'

const ENDED = new Set(['completed', 'canceled'])

export const addContext = cache(async () => {
  const [folk, inits, projs, wss, ms] = await Promise.all([
    db.select({ id: people.id, name: people.name }).from(people).orderBy(asc(people.name)),
    db.select().from(objectives).orderBy(asc(objectives.name)),
    db.select().from(initiatives).orderBy(asc(initiatives.name)),
    db.select().from(projects).orderBy(asc(projects.name)),
    db.select().from(milestones),
  ])

  const nameOf = new Map<string, string>()
  for (const w of wss) nameOf.set(w.id, w.name)
  for (const p of projs) nameOf.set(p.id, p.name)
  for (const i of inits) nameOf.set(i.id, i.name)

  // Ended work is left out: a dependency on something already finished is
  // either history or a mistake, and offering it invites the mistake.
  return {
    people: folk,
    // The records something could be moved under. Both lists, because the
    // caller knows which tier it is and picking the wrong one here would be
    // a silent mis-parenting rather than a type error.
    // Closed and withdrawn objectives are left out: moving live work into
    // one hides it from the home page, which is never what the mover meant.
    objectives: inits.filter((i) => !ENDED.has(i.status)).map((i) => ({ id: i.id, name: i.name })),
    initiatives: projs.map((p) => ({ id: p.id, name: p.name })),
    endpoints: [
      ...inits.filter((i) => !ENDED.has(i.status)).map((i) => ({ value: `objective:${i.id}`, label: i.name, group: TIER_PLURAL.objective })),
      ...projs.filter((p) => !ENDED.has(p.status)).map((p) => ({ value: `initiative:${p.id}`, label: p.name, group: 'Initiatives' })),
      ...wss.filter((w) => !ENDED.has(w.status)).map((w) => ({ value: `project:${w.id}`, label: w.name, group: 'Projects' })),
      ...ms
        .filter((m) => m.status !== 'complete')
        .map((m) => ({
          value: `milestone:${m.id}`,
          label: `${nameOf.get(m.entityId) ?? 'Milestone'} — ${m.name}`,
          group: 'Milestones',
        })),
    ],
  }
})
