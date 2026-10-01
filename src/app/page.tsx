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
 *
 * "Ask Yaara" opens the chat (Open WebUI, at YAARA_CHAT_URL) in its own
 * window, named so a second click returns to it rather than opening another.
 * A new window rather than a panel here because the chat signs in with Google
 * on its own address, and a sign-in inside a frame from another site is
 * exactly what browsers now block. Unset, the button is not shown: a button
 * that leads nowhere is worse than none.
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

  const chatUrl = process.env.YAARA_CHAT_URL?.trim() || null
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
        {chatUrl ? (
          <a className="home-ask" href={chatUrl} target="yaara-chat" rel="noopener" title="Ask Yaara anything about the portfolio">
            {/* A 64px file that ships with the app, as in the shell: the optimiser would add a request to save nothing. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/yaara-64.png" alt="" width={22} height={22} />
            Ask Yaara
          </a>
        ) : null}
      </div>

      <HomeBoard cards={cards} prefs={prefs} ungrouped={ungrouped} />
    </div>
  )
}
