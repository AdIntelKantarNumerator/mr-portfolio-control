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
