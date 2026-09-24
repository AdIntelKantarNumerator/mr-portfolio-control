/**
 * The two attribution rules in the decisions and blockers register.
 *
 * Both fail silently if they are wrong: a blocker credited to the wrong
 * colleague, and a handle that collides with one already on screen, are
 * mistakes nobody reading the page can detect. They live here rather than in
 * the route so they can be tested without standing up a database.
 */

/**
 * A written name to a Person, but only when there is exactly one answer.
 *
 * Exact full name first, then a unique first name — because "Priya said staging
 * is down" is how people actually talk, and refusing that would leave almost
 * every blocker unattributed. Two Sarahs means neither, and the name is kept as
 * text: "Sarah" on the card is honest, "Sarah Chen" when it was Sarah Okafor is
 * a fabrication the reader has no way to catch.
 */
export function matchPerson(
  name: string | null | undefined,
  roster: readonly { id: string; name: string }[],
): string | null {
  const needle = (name ?? '').trim().toLowerCase()
  if (needle.length < 2) return null

  const exact = roster.filter((p) => p.name.trim().toLowerCase() === needle)
  if (exact.length === 1) return exact[0].id
  if (exact.length > 1) return null

  const byFirst = roster.filter((p) => p.name.trim().toLowerCase().split(/\s+/)[0] === needle)
  return byFirst.length === 1 ? byFirst[0].id : null
}

/**
 * The next free handle for a kind: D7, B3.
 *
 * Refs are what people say out loud ("where are we on B3"), so they are short
 * and sequential rather than a uuid. Computed from what exists rather than
 * counted, because a deleted row would otherwise make the next one collide —
 * and because the register was populated by hand with G4 and S2 long before any
 * of this, which are not ours to renumber and must not be collided with.
 */
export function nextRef(kind: string, existing: readonly string[]): string {
  const prefix = kind === 'blocker' ? 'B' : 'D'
  const pattern = new RegExp(`^${prefix}(\\d+)$`, 'i')
  const highest = existing.reduce((max, ref) => {
    const m = pattern.exec(ref.trim())
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  return `${prefix}${highest + 1}`
}
