'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { LogoMark } from './logo'
import { IconCaret, IconPanel } from './icons'
import { NAV, isActive, sectionFor } from './nav'
import { usePreference } from '@/lib/use-preference'
import { BRAND_NAME, BRAND_TAGLINE } from '@/lib/brand'

export interface ShellUser {
  name: string
  email: string
  picture?: string
  authenticated: boolean
}

const DETAIL = ['full', 'lead'] as const
const THEMES = ['system', 'light', 'dark'] as const
const RAIL = ['open', 'closed'] as const
type Detail = (typeof DETAIL)[number]
type Theme = (typeof THEMES)[number]
type Rail = (typeof RAIL)[number]

/**
 * The frame: a left rail, and everything else.
 *
 * WHY THE NAVIGATION MOVED
 *
 * A top bar has one row. Fifteen destinations in one row means every label is
 * abbreviated to fit and none of them can be grouped, so the register sits
 * beside Templates at the same weight and nothing reads as more important
 * than anything else. A rail has as many rows as it needs, which is what
 * makes the grouping in nav.ts possible at all.
 *
 * WHAT THE HEADER KEPT
 *
 * The mark, the name, and the tagline. The org line and the sentence about
 * what the app is were read exactly once each, by each person, on their first
 * visit — and then occupied the top of every screen forever. What the app is
 * for belongs in the onboarding, not in the furniture.
 */
export function Shell({ children, user }: { children: ReactNode; user: ShellUser }) {
  const pathname = usePathname()
  const [detail, setDetail] = usePreference<Detail>('pcr:detail', DETAIL, 'full')
  const [theme, setTheme] = usePreference<Theme>('pcr:theme', THEMES, 'system')
  const [rail, setRail] = usePreference<Rail>('pcr:sidebar', RAIL, 'open')

  // Sections a person has deliberately collapsed. Not persisted: the section
  // holding the current page always opens on arrival, so a remembered
  // "closed" would be overridden half the time anyway and the memory would
  // read as a bug.
  const [shut, setShut] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    document.body.dataset.detail = detail
  }, [detail])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.dataset.theme = theme
  }, [theme])

  // Navigating closes the mobile drawer. Without this, tapping a link on a
  // phone leaves the menu covering the page it just opened.
  //
  // Adjusted during render rather than in an effect: React re-renders before
  // painting, so the drawer is never seen open over the new page, and an
  // effect would close it one frame late (and is what the lint rule forbids).
  const [seen, setSeen] = useState(pathname)
  if (pathname !== seen) {
    setSeen(pathname)
    if (menu) setMenu(false)
  }

  const here = sectionFor(pathname)

  function toggle(id: string) {
    setShut((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // The sign-in page gets no navigation: showing a signed-out visitor the full
  // menu invites them to click things that will only bounce them back here.
  if (pathname === '/signin') {
    return <div className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6">{children}</div>
  }

  const collapsed = rail === 'closed'

  return (
    <div className={`frame${collapsed ? ' tight' : ''}${menu ? ' menu-open' : ''}`}>
      <aside className="sidebar no-print">
        <div className="side-top">
          <Link href="/" className="brand" aria-label={BRAND_NAME}>
            <LogoMark size={collapsed ? 30 : 34} />
            <span className="brand-words">
              <span className="brand-name">{BRAND_NAME}</span>
              {BRAND_TAGLINE ? <span className="brand-tag">{BRAND_TAGLINE}</span> : null}
            </span>
          </Link>
          <button
            type="button"
            className="side-toggle"
            onClick={() => setRail(collapsed ? 'open' : 'closed')}
            aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <IconPanel />
          </button>
        </div>

        <nav className="side-nav" aria-label="Main">
          {NAV.map((section) => {
            // A collapsed rail is icons only, so a section header with no
            // room for its label would be a stray line. The items stay.
            const open = !section.id || collapsed || here === section.id || !shut.has(section.id)
            return (
              <div key={section.id ?? 'top'} className="side-group">
                {section.label && !collapsed && (
                  <button
                    type="button"
                    className="side-head"
                    onClick={() => toggle(section.id!)}
                    aria-expanded={open}
                  >
                    <IconCaret open={open} />
                    <span>{section.label}</span>
                  </button>
                )}
                {open && (
                  <ul>
                    {section.items.map((item) => {
                      const active = isActive(item.href, pathname)
                      const Icon = item.icon
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={active ? 'on' : undefined}
                            aria-current={active ? 'page' : undefined}
                            title={collapsed ? item.label : item.hint}
                          >
                            <Icon />
                            <span className="side-label">{item.label}</span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </nav>

      </aside>

      {/* Phone and narrow-tablet only: the rail becomes a drawer, and this is
          the bar that opens it. Hidden entirely once the rail fits. */}
      <div className="topbar no-print">
        <button type="button" onClick={() => setMenu(!menu)} aria-label="Menu" aria-expanded={menu}>
          <span />
          <span />
          <span />
        </button>
        <Link href="/" className="brand">
          <LogoMark size={26} />
          <span className="brand-name">{BRAND_NAME}</span>
        </Link>
      </div>

      {menu && <div className="side-scrim no-print" onClick={() => setMenu(false)} role="presentation" />}

      <main className="page">
        {/* Who you are and how you like the page, at the top right of the
            content rather than the bottom of the rail. They belong to the
            reader, not to the navigation, and at the foot of a 15-item rail
            they were below the fold on a laptop. */}
        <div className="pagebar no-print">
          <div className="seg" role="group" aria-label="Detail level">
            {DETAIL.map((d) => (
              <button
                key={d}
                onClick={() => setDetail(d)}
                aria-pressed={detail === d}
                className={detail === d ? 'on' : undefined}
                title={d === 'lead' ? 'Leadership view — hides operational detail' : 'Full view — everything'}
              >
                {d === 'full' ? 'Full' : 'Lead'}
              </button>
            ))}
          </div>
          <select
            aria-label="Theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            className="pb-theme"
          >
            <option value="system">Auto</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          {user.authenticated ? (
            <form action="/api/auth/signout" method="post" className="pb-user">
              <span title={user.email}>{user.name}</span>
              <button type="submit">Sign out</button>
            </form>
          ) : null}
        </div>

        {children}
        {/* Kept from the old frame. It is the one piece of standing text that
            answers a question people actually ask — why a number here differs
            from the tracker — and it earns its place at the bottom in a way
            the blurb at the top never did. */}
        <footer className="page-foot">
          Delivery layer syncs from your tracker. Health assessments, decisions, dependencies,
          contention and intake are entered here, because no upstream tool holds them. Conflicts
          between a source and an assessment are flagged rather than silently resolved.
        </footer>
      </main>
    </div>
  )
}
