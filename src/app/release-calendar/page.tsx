/**
 * Release Calendar (Scott, 11 November 2026): planned Production releases on
 * a calendar - this month and next by default, or a month, a week or a day.
 *
 * Each release is a Linear ticket labelled as a production release, placed on
 * its target date. Yaara reads them each pass (lib/releases.ts). A link with
 * ?release=MED-339 - the one her announcement in #mr-production-deployments
 * carries - opens on that release's date with it highlighted.
 */
import { Kicker } from '@/components/ui'
import { isView, type CalendarView } from '@/lib/release-rules'
import { readCalendar } from '@/lib/releases'
import { ReleaseCalendar } from './calendar'

export const metadata = { title: 'Release Calendar' }
export const dynamic = 'force-dynamic'

type Search = Promise<Record<string, string | string[] | undefined>>

/** Today where the company keeps its calendar. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export default async function ReleaseCalendarPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const releases = await readCalendar()
  const view: CalendarView = typeof sp.view === 'string' && isView(sp.view) ? sp.view : 'months'
  const highlight = typeof sp.release === 'string' ? sp.release.toUpperCase() : null
  const now = today()
  const asked = typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : null
  const anchor = asked ?? releases.find((r) => r.identifier === highlight)?.targetDate ?? now

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>The work</Kicker>
          <h1>Release Calendar</h1>
        </div>
      </div>
      <ReleaseCalendar releases={releases} initialView={view} initialAnchor={anchor} today={now} highlight={highlight} />
    </div>
  )
}
