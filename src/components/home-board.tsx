'use client'

/**
 * The home page board: a level picker, the cards, and one modal they all share.
 *
 * The modal lives here rather than in each card because there is only ever one
 * open, and giving every card its own would mean twenty dialogs in the DOM
 * competing for the same escape key.
 */
import { TIER_LABEL, TIER_PLURAL } from '@/lib/home-types'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { HomeCard } from '@/lib/home'
import type { HealthFilter, Level, Sort } from '@/lib/home-types'
import { HOME_PREFS_COOKIE, serialiseHomePrefs, type HomePrefs } from '@/lib/home-prefs'
import { SortableCards } from './sortable-cards'
import { AskYaaraButton } from './yaara-panel'

const LABEL: Record<Level, { one: string; many: string; beneath: string }> = {
  objective: { one: TIER_LABEL.objective, many: 'Active strategic objectives', beneath: 'initiatives' },
  initiative: { one: 'Initiative', many: 'Active initiatives', beneath: 'projects' },
  project: { one: 'Project', many: 'Active projects', beneath: 'milestones' },
}

const SORT_LABEL: Record<Sort, string> = {
  active: 'Most active',
  quiet: 'Least active',
  name: 'Name',
  custom: 'Custom',
}

const HEALTH_LABEL: Record<HealthFilter, string> = {
  all: 'All',
  good: 'On track',
  crit: 'Blocked',
}

export function HomeBoard({
  cards,
  prefs,
  ungrouped,
}: {
  cards: HomeCard[]
  prefs: HomePrefs
  ungrouped: { id: string; name: string; projects: number }[]
}) {
  const [modal, setModal] = useState<{ title: string; body: React.ReactNode } | null>(null)
  const router = useRouter()
  const { level } = prefs

  /**
   * Change one picker.
   *
   * All three go into the URL together, from `prefs` rather than from the
   * current query string: the page resolves missing params from the cookie,
   * so a URL carrying only `level` would look like "sort and health are
   * default" to the next reader of that link. Writing all three makes the
   * address bar say what is actually on screen.
   *
   * The cookie is written here rather than on the server because this is
   * where the choice happens, and a Set-Cookie on a page render would be a
   * side effect in a GET. One year, lax, path-wide — it is a view
   * preference, and losing it costs one click.
   */
  function choose(patch: Partial<HomePrefs>) {
    const next = { ...prefs, ...patch }
    document.cookie = `${HOME_PREFS_COOKIE}=${serialiseHomePrefs(next)}; path=/; max-age=31536000; samesite=lax`
    const q = new URLSearchParams({ level: next.level, sort: next.sort, health: next.health })
    router.push(`/?${q.toString()}`)
  }

  return (
    <>
      <div className="filters">
        <label className="fpill">
          <span>
            <span className="lab">Showing</span>
            <select
              value={level}
              onChange={(e) => choose({ level: e.target.value as Level })}
              className="fsel"
              aria-label="Which level to show"
            >
              <option value="objective">{TIER_PLURAL.objective}</option>
              <option value="initiative">Initiatives</option>
              <option value="project">Projects</option>
            </select>
          </span>
        </label>
        <label className="fpill">
          <span>
            <span className="lab">Sort by</span>
            <select
              value={prefs.sort}
              onChange={(e) => choose({ sort: e.target.value as Sort })}
              className="fsel"
              aria-label="Sort order"
            >
              {(Object.keys(SORT_LABEL) as Sort[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className={`fpill${prefs.health !== 'all' ? ' active' : ''}`}>
          <span>
            <span className="lab">Health</span>
            <select
              value={prefs.health}
              onChange={(e) => choose({ health: e.target.value as HealthFilter })}
              className="fsel"
              aria-label="Health filter"
            >
              {(Object.keys(HEALTH_LABEL) as HealthFilter[]).map((k) => (
                <option key={k} value={k}>
                  {HEALTH_LABEL[k]}
                </option>
              ))}
            </select>
          </span>
        </label>
        {/* Far right of the picker row. Opens the panel in the shell. */}
        <AskYaaraButton className="push-right" />
      </div>

      {cards.length === 0 ? (
        <div className="blank">
          {/* An empty board because of a filter is a different fact from an
              empty board because there is no work, and telling somebody to
              go create an objective when they have simply filtered them all
              out is the sort of thing that makes people stop reading empty
              states. */}
          {prefs.health !== 'all' ? (
            <>
              <h2>Nothing is {HEALTH_LABEL[prefs.health].toLowerCase()}</h2>
              <p>
                No {LABEL[level].many.toLowerCase().replace('active ', '')} match that filter. Set Health back to
                All to see the rest.
              </p>
            </>
          ) : (
            <>
              <h2>No active {LABEL[level].many.toLowerCase().replace('active ', '')} yet</h2>
              <p>
                {level === 'objective'
                  ? 'Objectives group initiatives together — five to ten active is the working number. Nothing has been grouped yet, so every initiative below is ungrouped. Create one, or ask Yaara which initiatives belong together.'
                  : `Nothing active at this level. Switch the "Showing" picker above to see another level.`}
              </p>
            </>
          )}
        </div>
      ) : (
        <SortableCards
          cards={cards}
          level={level}
          draggable={prefs.sort === 'custom'}
          onOpen={(t, b) => setModal({ title: t, body: b })}
        />
      )}

      {level === 'objective' && ungrouped.length > 0 && (
        <section className="orphan">
          <div className="oh">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 2l6.4 11.4H1.6L8 2z" stroke="var(--warn)" strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M8 6.4v3.1M8 11.4v.05" stroke="var(--warn)" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <h2>Not in an objective</h2>
            <span className="status quiet">{ungrouped.length} initiatives</span>
          </div>
          <div className="ob">
            <p className="lead">
              Running, and on nobody&rsquo;s card. They are invisible to anyone reading this page for a status — which is
              why they are named here rather than left out.
            </p>
            <div className="chips">
              {ungrouped.map((p) => (
                <a key={p.id} href={`/initiatives/${p.id}`}>
                  {p.name}
                  <span className="w">{p.projects} WS</span>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {modal && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && setModal(null)} role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-label={modal.title}>
            <div className="mh">
              <h3>{modal.title}</h3>
              <button onClick={() => setModal(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="mb">{modal.body}</div>
          </div>
        </div>
      )}
    </>
  )
}
