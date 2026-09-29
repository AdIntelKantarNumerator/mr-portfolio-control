/**
 * Home.
 *
 * One card per active objective, sorted by how much is happening, with the
 * level picker letting the same board answer the question at initiative or
 * project level. Everything that was on the old control room has moved to
 * Activity — this page exists to answer "where are we" in one screen, and
 * everything else it used to carry was in the way of that.
 *
 * The three pickers are read from the URL, falling back to a cookie holding
 * how this reader last had them. See lib/home-prefs.ts for why a cookie
 * rather than localStorage.
 */
import { TIER_PLURAL } from '@/lib/home-types'
import { cookies } from 'next/headers'
import { getHomeCards, getUngrouped } from '@/lib/home'
import { HOME_PREFS_COOKIE, resolveHomePrefs } from '@/lib/home-prefs'
import { HomeBoard } from '@/components/home-board'

export const dynamic = 'force-dynamic'

const HEADING = {
  objective: 'Active strategic objectives',
  initiative: 'Active initiatives',
  project: 'Active projects',
} as const

const CRUMB = { objective: TIER_PLURAL.objective, initiative: 'Initiatives', project: 'Projects' } as const

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ level?: string; sort?: string; health?: string }>
}) {
  const [query, jar] = await Promise.all([searchParams, cookies()])
  const prefs = resolveHomePrefs(query, jar.get(HOME_PREFS_COOKIE)?.value)

  const [cards, ungrouped] = await Promise.all([
    getHomeCards(prefs.level, prefs.sort, prefs.health),
    getUngrouped(),
  ])

  const assessed = cards.filter((c) => c.verdict).length
  const filtered = prefs.health !== 'all'

  return (
    <div className="home">
      <div className="crumb">Portfolio · {CRUMB[prefs.level]}</div>
      <div className="titlerow">
        <h1>{HEADING[prefs.level]}</h1>
        <p className="sub">
          {cards.length === 0
            ? filtered
              ? 'Nothing here matches that health filter.'
              : 'Nothing active here yet.'
            : `${cards.length}${filtered ? ' shown' : ' active'}${
                assessed ? `, ${assessed} assessed by Yaara` : ', none assessed yet'
              }.`}
        </p>
      </div>

      <HomeBoard cards={cards} prefs={prefs} ungrouped={ungrouped} />
    </div>
  )
}
