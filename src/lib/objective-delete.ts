/**
 * When a Strategic Objective may be deleted, and what deleting it takes with it.
 *
 * Every other way of ending work here is a status change, so the record and
 * its history survive. Deleting is for the objective that should never have
 * existed: created by mistake, or emptied out and never going to be used.
 *
 * Two things block it, and neither is ever deleted or orphaned to make way:
 *
 * - Initiatives. An objective with initiatives is a grouping somebody relies
 *   on, and deleting it would ungroup them silently. Closed and withdrawn ones
 *   count too, because the record of what an objective delivered is exactly
 *   what a delete would lose.
 * - Decisions and blockers, whatever their status. The register is a record of
 *   what was decided, with refs people quote in meetings, and an entry filed
 *   against nothing is one nobody finds again. They are moved first — "Filed
 *   against" on each — and only then can the objective go.
 *
 * Split out of the server action so it can be tested without a database.
 */

export type DeleteCheck = { ok: true } | { ok: false; reason: string }

/** Everything that must be moved first, said once; null when nothing blocks. */
export function deleteBlockers(input: { initiativeCount: number; decisionCount: number }): string | null {
  const parts: string[] = []
  const i = input.initiativeCount
  if (i > 0) {
    parts.push(
      `${i} initiative${i === 1 ? ' is' : 's are'} still in this objective, counting closed and withdrawn ones — move ${i === 1 ? 'it' : 'them'} on the Strategic Objectives page.`,
    )
  }
  const d = input.decisionCount
  if (d > 0) {
    parts.push(
      `${d} decision${d === 1 ? ' or blocker is' : 's or blockers are'} filed here, counting decided and dropped ones — change “Filed against” on ${d === 1 ? 'it' : 'each'} in this page’s Decisions and Blockers.`,
    )
  }
  return parts.length ? `${parts.join(' ')} Or close the objective instead.` : null
}

export function canDeleteObjective(input: {
  initiativeCount: number
  decisionCount: number
  name: string
  typed: string
}): DeleteCheck {
  const blocked = deleteBlockers(input)
  if (blocked) return { ok: false, reason: blocked }
  // Typed rather than ticked. A checkbox is clicked without reading; a name is
  // not typed without looking at which objective this is.
  if (input.typed.trim() !== input.name.trim()) {
    return { ok: false, reason: 'Type the objective’s name exactly to confirm.' }
  }
  return { ok: true }
}

/** What goes with the objective, as the confirm and the changelog say it. */
export interface RemovalCounts {
  milestones: number
  actionLinks: number
  assessments: number
  observations: number
  updates: number
  sources: number
}

export function describeRemoval(c: RemovalCounts): string {
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  const parts = [
    c.milestones ? plural(c.milestones, 'milestone') : null,
    c.actionLinks ? `${plural(c.actionLinks, 'action item link')} (the actions themselves stay)` : null,
    c.assessments || c.observations ? 'its health and Yaara’s assessments' : null,
    c.updates ? plural(c.updates, 'status update') : null,
    c.sources ? plural(c.sources, 'linked source') : null,
  ].filter(Boolean)
  return parts.length ? `This also removes ${parts.join(', ')}.` : 'Nothing else is filed on it.'
}
