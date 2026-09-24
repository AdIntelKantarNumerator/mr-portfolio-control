'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { LogoMark } from './logo'
import { usePreference } from '@/lib/use-preference'
import { BRAND_BLURB, BRAND_NAME, BRAND_ORG, BRAND_TAGLINE } from '@/lib/brand'

export interface ShellUser {
  name: string
  email: string
  picture?: string
  authenticated: boolean
}

const NAV = [
  { href: '/', label: 'Control room' },
  { href: '/roadmap', label: 'Timeline' },
  { href: '/initiatives', label: 'Initiatives' },
  { href: '/applications', label: 'By application' },
  { href: '/contention', label: 'Contention & people' },
  { href: '/dependencies', label: 'Dependencies' },
  { href: '/decisions', label: 'Decisions / Blockers' },
  { href: '/sources', label: 'Conversations' },
  { href: '/intake', label: 'Intake' },
  { href: '/prioritization', label: 'Prioritization' },
  { href: '/readiness', label: 'Readiness' },
  { href: '/templates', label: 'Templates' },
  { href: '/changes', label: 'What changed' },
]

const DETAIL = ['full', 'lead'] as const
const THEMES = ['system', 'light', 'dark'] as const
type Detail = (typeof DETAIL)[number]
type Theme = (typeof THEMES)[number]

export function Shell({ children, user }: { children: ReactNode; user: ShellUser }) {
  const pathname = usePathname()
  const [detail, setDetail] = usePreference<Detail>('pcr:detail', DETAIL, 'full')
  const [theme, setTheme] = usePreference<Theme>('pcr:theme', THEMES, 'system')

  // Pushing the preference onto the document is a legitimate external-system
  // sync: the CSS selectors that implement dark mode and the leadership view
  // both hang off these attributes.
  useEffect(() => {
    document.body.dataset.detail = detail
  }, [detail])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.dataset.theme = theme
  }, [theme])

  // The sign-in page gets no navigation: showing a signed-out visitor the full
  // menu invites them to click things that will only bounce them back here.
  if (pathname === '/signin') {
    return <div className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6">{children}</div>
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-5 sm:px-6">
      <header
        className="mb-4 flex flex-wrap items-end justify-between gap-4 border-b-2 pb-3.5"
        style={{ borderColor: 'var(--line)' }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <LogoMark size={40} className="shrink-0" />
            <div className="min-w-0">
              <div
                className="text-[10.5px] font-bold uppercase tracking-[0.06em]"
                style={{ color: 'var(--brand-2)' }}
              >
                {BRAND_ORG}
              </div>
              <h1 className="m-0 text-[22px] font-bold leading-tight tracking-[-0.02em]">
                {BRAND_NAME}
              </h1>
              {BRAND_TAGLINE ? (
                <div className="text-[11px] italic" style={{ color: 'var(--muted)' }}>
                  {BRAND_TAGLINE}
                </div>
              ) : null}
            </div>
          </div>
          <p className="m-0 mt-2 max-w-[760px] text-[12.5px]" style={{ color: 'var(--muted)' }}>
            {BRAND_BLURB}
          </p>
        </div>

        <div className="no-print flex items-center gap-2">
          <div
            className="flex overflow-hidden rounded-lg border text-[11.5px] font-semibold"
            style={{ borderColor: 'var(--line)' }}
            role="group"
            aria-label="Detail level"
          >
            {(['full', 'lead'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDetail(d)}
                aria-pressed={detail === d}
                className="px-3 py-1.5 transition-colors"
                style={{
                  background: detail === d ? 'var(--brand)' : 'var(--surface)',
                  color: detail === d ? '#fff' : 'var(--muted)',
                }}
                title={
                  d === 'lead'
                    ? 'Leadership view — hides operational detail'
                    : 'Full view — everything'
                }
              >
                {d === 'full' ? 'Full' : 'Lead'}
              </button>
            ))}
          </div>

          <select
            aria-label="Theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            className="!w-auto !py-1.5 text-[11.5px] font-semibold"
            style={{ color: 'var(--muted)' }}
          >
            <option value="system">Auto</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>

          {user.authenticated ? (
            <div className="flex items-center gap-2">
              <span
                className="hidden text-[11.5px] font-semibold sm:inline"
                style={{ color: 'var(--muted)' }}
                title={user.email}
              >
                {user.name}
              </span>
              <form action="/api/auth/signout" method="post">
                <button type="submit" className="btn !px-2.5 !py-1.5 text-[11.5px]">
                  Sign out
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </header>

      <nav className="no-print mb-5 flex flex-wrap gap-1.5">
        {NAV.map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg border px-3 py-2 text-[12.5px] font-semibold transition-colors"
              style={{
                background: active ? 'var(--brand)' : 'var(--surface)',
                color: active ? '#fff' : 'var(--muted)',
                borderColor: active ? 'var(--brand)' : 'var(--line)',
              }}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      {children}

      <footer
        className="mt-8 border-t pt-3 text-[11px]"
        style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
      >
        Delivery layer syncs from your tracker. Health assessments, decisions, dependencies,
        contention and intake are entered here, because no upstream tool holds them. Conflicts
        between a source and an assessment are flagged rather than silently resolved.
      </footer>
    </div>
  )
}
