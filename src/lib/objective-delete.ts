/**
 * When a Strategic Objective may be deleted, and what deleting it takes with it.
 *
 * Every other way of ending work here is a status change, so the record and
 * its history survive. Deleting is for the objective that should never have
 * existed: created by mistake, or emptied out and never going to be used. The
 * one hard rule is that nothing is filed under it. An objective with
 * initiatives is a grouping somebody relies on, and deleting it would ungroup
 * them silently. Closed and withdrawn initiatives count too, because the
 * record of what an objective delivered is exactly what a delete would lose.
 *
 * Split out of the server action so it can be tested without a database.
 */

export type DeleteCheck = { ok: true } | { ok: false; reason: string }

export function canDeleteObjective(input: {
  initiativeCount: number
  name: string
  typed: string
}): DeleteCheck {
  if (input.initiativeCount > 0) {
    const n = input.initiativeCount
    return {
      ok: false,
      reason: `${n} initiative${n === 1 ? ' is' : 's are'} still in this objective, counting closed and withdrawn ones. Move ${n === 1 ? 'it' : 'them'} first, or close the objective instead.`,
    }
  }
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
  decisions: number
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
  const kept = c.decisions
    ? ` ${plural(c.decisions, 'decision or blocker', 'decisions and blockers')} filed here will stay in the register, unfiled.`
    : ''
  return (parts.length ? `This also removes ${parts.join(', ')}.` : 'Nothing else is filed on it.') + kept
}
