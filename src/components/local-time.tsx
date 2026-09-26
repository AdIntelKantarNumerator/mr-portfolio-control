'use client'

/**
 * A timestamp in the reader's own timezone.
 *
 * Every date on this app was formatted on the server, which on Azure runs in
 * UTC. So a change made at 4pm in New York was shown as 8pm to the person who
 * made it, on the page whose whole job is telling them when things happened.
 *
 * WHY THIS IS A CLIENT COMPONENT AND WHY IT SUPPRESSES THE WARNING
 *
 * The server cannot know the reader's timezone — it is not in the request.
 * The only place the right answer exists is the browser. So the server
 * renders UTC, the browser re-renders local, and those two differ by
 * construction: that is not a bug to be fixed but the entire point, and
 * `suppressHydrationWarning` is React's documented way of saying so for
 * exactly this case.
 *
 * The `dateTime` attribute carries the unambiguous instant, so the markup is
 * still machine-readable whichever text is on screen.
 *
 * NOT FOR CALENDAR DATES
 *
 * This is for things that happened at a moment. A milestone due on the 14th
 * is due on the 14th wherever you read it from, and converting its midnight
 * to a zone west of Greenwich shows the 13th — a date somebody typed coming
 * back a day earlier. Use `calendarDate` below for those.
 */

/**
 * A date somebody typed, formatted without ever being converted.
 *
 * "14 November" means the fourteenth wherever it is read. Pushing it through
 * a timezone — which is right for an event that happened at an instant —
 * turns midnight UTC into the 13th for every reader west of Greenwich, so a
 * date somebody typed comes back a day earlier.
 *
 * It lives here beside `LocalTime` on purpose: the two rules are opposites,
 * and keeping them apart is how one of them quietly gets applied to the
 * wrong kind of value.
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

export interface LocalTimeProps {
  /** An ISO string. Dates are serialised before they cross into the client. */
  at: string | null | undefined
  /** Date only, date and time, or time only. */
  show?: 'date' | 'datetime' | 'time'
  /** Include the year. Off by default: most of what this app shows is recent. */
  year?: boolean
  /** What to render when there is no timestamp. */
  empty?: string
  className?: string
}

export function LocalTime({ at, show = 'datetime', year = false, empty = '—', className }: LocalTimeProps) {
  if (!at) return <span className={className}>{empty}</span>

  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return <span className={className}>{empty}</span>

  const opts: Intl.DateTimeFormatOptions =
    show === 'time'
      ? { hour: 'numeric', minute: '2-digit' }
      : show === 'date'
        ? { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) }
        : { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), hour: 'numeric', minute: '2-digit' }

  return (
    <time dateTime={d.toISOString()} className={className} suppressHydrationWarning>
      {new Intl.DateTimeFormat('en-US', opts).format(d)}
    </time>
  )
}

/**
 * The reader's timezone, named, for a footnote.
 *
 * Same suppression for the same reason: on the server this is UTC and in the
 * browser it is wherever they are.
 */
export function LocalZone({ className }: { className?: string }) {
  let zone = 'UTC'
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    // A browser with no zone information is rare and not worth a fallback
    // that says something less true than "UTC".
  }
  return (
    <span className={className} suppressHydrationWarning>
      {zone}
    </span>
  )
}
