/**
 * Whether a piece of work is standing still.
 *
 * WHY THIS IS NOT JUST `blocked.has(id)`
 *
 * A blocker is filed where the work is stuck, and work is stuck in a
 * workstream. Almost nobody files one against the project above it, and
 * nobody at all files one against an initiative. So asking whether the
 * project row itself carries a blocker answers "no" for a project whose every
 * workstream is jammed — which is how the home board came to show an
 * initiative flagged Blocked, with fourteen open blockers listed beside it,
 * over a bar reading six projects on track. Both halves were reading the same
 * table and only one of them was looking underneath.
 *
 * The rule is: a thing is blocked if it carries an open blocker, or if
 * anything beneath it does. The caller supplies what is beneath, because only
 * it knows the shape of the tier it is drawing.
 */
export function blockedAtOrBelow(id: string, below: readonly string[], blocked: ReadonlySet<string>): boolean {
  return blocked.has(id) || below.some((child) => blocked.has(child))
}
