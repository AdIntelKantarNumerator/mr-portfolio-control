/**
 * What a readiness checkbox press means.
 *
 * Its own module, away from the hook that calls it, because the hook imports
 * the server action and the server action imports the database — so a test
 * that wanted this one rule ended up starting Postgres. The rule is worth
 * testing on its own: a checklist whose second press does not undo the first
 * is a checklist people cannot correct.
 */

/** What a tick or an N/A press should set the item to, given where it is now. */
export function nextStatus(current: string, pressed: 'done' | 'na'): string {
  return current === pressed ? 'not_started' : pressed
}

/**
 * An edit somebody made that the server has not confirmed yet.
 *
 * `base` is what the server said at the moment they first clicked, and it is
 * what makes the reconciliation below possible without a timestamp or a
 * sequence number.
 */
export interface PendingEdit {
  want: string
  base: string
}

/**
 * What to draw: the click, or the server's word.
 *
 * THE RULE, AND WHY IT IS NOT `useOptimistic`
 *
 * An optimistic value is defined as "show this until the transition that set
 * it ends, then go back to the prop". That is right when one action is in
 * flight and the refresh that follows it is guaranteed to have landed first.
 * Neither is true here: somebody filling in a checklist sets off a dozen
 * writes in a few seconds, and the page refreshes they trigger are coalesced —
 * so the transitions end against a prop that is still the value the page was
 * first rendered with. Every tick reverts at once, which is exactly what it
 * looked like.
 *
 * The rule that survives that is comparative rather than temporal: keep
 * showing the change while the server is still saying what it said when the
 * click happened, and defer to the server the moment it says anything else —
 * whether that is the change coming back, or somebody else's edit arriving.
 * It needs no ordering guarantee, which is the point, because there isn't one.
 */
export function settleStatus(server: string, pending: PendingEdit | undefined): string {
  if (!pending) return server
  return server === pending.base ? pending.want : server
}

/** True once the server has said something, so the edit can be forgotten. */
export function settled(server: string, pending: PendingEdit | undefined): boolean {
  return !pending || server !== pending.base
}

/**
 * The key an edit is held under.
 *
 * Both parts, because the Readiness page shows the same checklist item for
 * many projects at once and `itemId` alone would tick one row's box by
 * ticking another's.
 */
export function editKey(projectId: string, itemId: string): string {
  return `${projectId}:${itemId}`
}
