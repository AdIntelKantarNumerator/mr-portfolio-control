/**
 * Calendar dates, formatted without ever being converted.
 *
 * "14 November" means the fourteenth wherever it is read. Pushing it through
 * a timezone — which is right for an event that happened at an instant — turns
 * midnight UTC into the 13th for every reader west of Greenwich, so a date
 * somebody typed comes back a day earlier.
 *
 * WHY THIS IS NOT IN local-time.tsx WITH ITS OPPOSITE
 *
 * That file is `'use client'`, which makes everything it exports a client
 * reference: a server component calling one gets "Attempted to call
 * calendarRange() from the server but calendarRange is on the client". These
 * are pure string functions both sides need, so they live in a module with no
 * directive and no imports — the same rule that put the home board's types in
 * home-types.ts.
 */
export function calendarDate(iso: string | null | undefined, opts: { year?: boolean } = {}): string | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso.slice(0, 10)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(opts.year === false ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** `startDate → targetDate`, with an em dash for either end that is missing. */
export function calendarRange(start: string | null, target: string | null): string {
  const a = calendarDate(start, { year: false })
  const b = calendarDate(target, { year: false })
  if (!a && !b) return '—'
  return `${a ?? '—'} → ${b ?? '—'}`
}
