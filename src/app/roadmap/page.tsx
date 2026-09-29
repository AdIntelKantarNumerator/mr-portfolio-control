/**
 * Timeline: everything against the calendar.
 *
 * WHAT WENT
 *
 * Four counter tiles, a themes row, a "dated commitments" strip, an "open work
 * with no dates" list, a legend and two paragraphs of caption. Between them
 * they took the top half of the screen to say things the chart underneath
 * already said, and the chart itself only ever drew one shape — a lane per
 * initiative, a bar per project.
 *
 * WHAT IS THERE INSTEAD
 *
 * The same controls as the home board — Showing, Find, Live only, Sort — and
 * a chart that draws whichever tier you asked for, with a bar for each child
 * beneath each row and every milestone from underneath rolled up onto it. The
 * Custom sort is the same stored, per-reader arrangement the home board uses,
 * so a board arranged there is arranged here.
 */
import { cookies } from 'next/headers'
import { Kicker } from '@/components/ui'
import { getCardOrder } from '@/lib/card-order'
import { HOME_PREFS_COOKIE, resolveHomePrefs } from '@/lib/home-prefs'
import { timelineModel } from '@/lib/timeline-source'
import { TimelineControls } from './controls'
import { TimelineView } from '@/components/timeline-view'

export const metadata = { title: 'Timeline' }
export const dynamic = 'force-dynamic'

export default async function RoadmapPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string; sort?: string; find?: string; show?: string; links?: string }>
}) {
  const [query, jar] = await Promise.all([searchParams, cookies()])
  // The same three pickers as the home board, read the same way, so a link to
  // one carries over to the other.
  const prefs = resolveHomePrefs({ level: query.level, sort: query.sort }, jar.get(HOME_PREFS_COOKIE)?.value)
  const level = prefs.level
  const find = (query.find ?? '').trim().toLowerCase()
  const includeEnded = query.show === 'all'
  const showLinks = query.links !== '0'

  // Every lane, because this is the whole-portfolio view. A detail page calls
  // the same function with `only` set. See lib/timeline-source.ts.
  const model = await timelineModel({
    level,
    sort: prefs.sort,
    find,
    includeEnded,
    order: await getCardOrder(level),
  })

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Portfolio</Kicker>
          <h1>Timeline</h1>
        </div>
      </div>

      <TimelineControls
        level={level}
        sort={prefs.sort}
        find={query.find ?? ''}
        show={includeEnded ? 'all' : 'live'}
        links={showLinks}
        count={model.rows.length}
      />

      {model.rows.length === 0 ? (
        <p className="rt-empty">Nothing here matches those controls.</p>
      ) : (
        <TimelineView model={model} level={level} draggable={prefs.sort === 'custom'} showLinks={showLinks} />
      )}
    </div>
  )
}
