/**
 * Active recurring topics.
 *
 * What keeps coming up in the meetings Yaara reads, and has not become a
 * decision or a blocker. Nobody owns these, which is the point: something
 * raised in three consecutive weeklies with no owner is the shape a blocker
 * has before anybody has called it one, and it was previously visible only at
 * the foot of the register, below everything that already had a name.
 *
 * There is no explanatory paragraph under the title. A page whose whole
 * content is "here is what keeps coming up" does not need one, and the reader
 * who needed it needed it once.
 */
import Link from 'next/link'
import { getPortfolio, labelForEndpoint, recentThemes } from '@/lib/portfolio'
import { Kicker } from '@/components/ui'

export const metadata = { title: 'Discussions' }
export const dynamic = 'force-dynamic'

const HREF: Record<string, string> = {
  initiative: '/initiatives',
  project: '/projects',
  workstream: '/workstreams',
}

export default async function DiscussionsPage() {
  const [p, themes] = await Promise.all([getPortfolio(), recentThemes(60)])

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Work in progress</Kicker>
          <h1>Discussions</h1>
        </div>
      </div>

      <section className="tile">
        <div className="tile-head">
          <h2>Active recurring topics</h2>
        </div>

        {themes.length === 0 ? (
          <p className="tile-empty">
            Nothing recurring yet. These are read out of shared documents — if meetings are happening and nothing
            is here, check whether Yaara has the notes.
          </p>
        ) : (
          <ul className="disc">
            {themes.map((t) => {
              const where = labelForEndpoint(p, t.entityType, t.entityId)
              const href = t.entityType && HREF[t.entityType] ? `${HREF[t.entityType]}/${t.entityId}` : null
              return (
                <li key={t.id}>
                  <div className="disc-head">
                    <b>{t.theme}</b>
                    {where ? (
                      href ? (
                        <Link className="disc-at" href={href}>
                          {where}
                        </Link>
                      ) : (
                        <span className="disc-at">{where}</span>
                      )
                    ) : null}
                    <em>
                      {t.mentions === 1 ? 'mentioned once' : `${t.mentions} mentions`}
                      {t.lastMeeting ? ` · last in ${t.lastMeeting}` : ''}
                    </em>
                  </div>
                  {t.summary ? <p>{t.summary}</p> : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
