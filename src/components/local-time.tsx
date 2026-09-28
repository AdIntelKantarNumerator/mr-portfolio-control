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

/*
 * `calendarDate` and `calendarRange` live in lib/calendar-date.ts. They are
 * deliberately NOT re-exported from here: anything exported from a
 * 'use client' module is a client reference, so a server component calling
 * one through this file would fail exactly as it did before the move. Import
 * them from '@/lib/calendar-date'.
 */

export interface LocalTimeProps {
  /** An ISO string. Dates are serialised before they cross into the client. */
  at: string | null | undefined
  /** Date only, date and time, or time only. */
  show?: 'date' | 'datetime' | 'time'
  /** Include the year. Off by default: most of what this app shows is recent. */
  year?: boolean
  /** What to render when there is no timestamp. */
  empty?: string
  /**
   * Append the zone abbreviation - EDT, GMT+2, JST.
   *
   * On a page of timestamps this belongs on the row rather than in a note at
   * the top: a note is read once and then scrolled past, and the reader who
   * needs to know whether 1:43 PM is their afternoon is the one arriving at
   * row forty from a link.
   */
  zone?: boolean
  className?: string
}

export function LocalTime({ at, show = 'datetime', year = false, empty = '—', zone = false, className }: LocalTimeProps) {
  if (!at) return <span className={className}>{empty}</span>

  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return <span className={className}>{empty}</span>

  const opts: Intl.DateTimeFormatOptions =
    show === 'time'
      ? { hour: 'numeric', minute: '2-digit' }
      : show === 'date'
        ? { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) }
        : { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), hour: 'numeric', minute: '2-digit' }

  // `timeZoneName: 'short'` is what turns "1:43 PM" into "1:43 PM EDT", and
  // it is correct for the date in question rather than for today - a row from
  // January says EST while one from July says EDT, which is the whole point of
  // printing it.
  const withZone: Intl.DateTimeFormatOptions = zone ? { ...opts, timeZoneName: 'short' } : opts

  return (
    <time dateTime={d.toISOString()} className={className} suppressHydrationWarning>
      {new Intl.DateTimeFormat('en-US', withZone).format(d)}
    </time>
  )
}
