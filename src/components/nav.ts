/**
 * What is in the left rail, and why it is grouped this way.
 *
 * Fifteen destinations is too many to scan as one list, and the old top bar
 * proved it: everything read as equally important, so nothing was findable.
 * They are grouped here by the question somebody arrived with, not by what
 * the data is:
 *
 *   Home              Where are we. The one everybody opens first.
 *   The work          The three tiers and the calendar they sit on.
 *   Work in progress  Everything waiting on a person to decide or do something.
 *   Inbound           Work that has not started and is asking to.
 *   Reference         True, occasionally needed, never urgent.
 *   Activity          The log, last and unlabelled.
 *
 * "Work in progress" is the group that earns its place. Blockers, action
 * items, dependencies, readiness gates and the topics that keep coming up are
 * five different tables and one question — what is stuck on a human — and
 * having them adjacent is the difference between finding the stuck thing and
 * remembering to look for it.
 *
 * Kept separate from shell.tsx so the structure can be read without reading
 * the layout, and changed without touching it.
 */
import { TIER_PLURAL } from '@/lib/home-types'
import type { ComponentType, SVGProps } from 'react'
import {
  IconActions,
  IconActivity,
  IconConversations,
  IconDecisions,
  IconDependencies,
  IconDictionary,
  IconHome,
  IconObjectives,
  IconIntake,
  IconPrioritization,
  IconInitiatives,
  IconReadiness,
  IconRegister,
  IconSeries,
  IconTemplates,
  IconTimeline,
  IconProjects,
  IconWorkflow,
} from './icons'

export interface NavItem {
  href: string
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>
  /** Shown on hover, for the labels that are shorter than the idea. */
  hint?: string
}

export interface NavSection {
  /** Null for the ungrouped items at the top. */
  id: string | null
  label: string | null
  items: NavItem[]
}

export const NAV: NavSection[] = [
  {
    id: null,
    label: null,
    items: [{ href: '/', label: 'Home', icon: IconHome, hint: 'Where everything stands' }],
  },
  {
    id: 'work',
    label: 'The work',
    items: [
      { href: '/objectives', label: TIER_PLURAL.objective, icon: IconObjectives, hint: 'Groups of initiatives' },
      { href: '/initiatives', label: 'Initiatives', icon: IconInitiatives },
      { href: '/projects', label: 'Projects', icon: IconProjects },
      { href: '/roadmap', label: 'Timeline', icon: IconTimeline, hint: 'Everything against the calendar' },
    ],
  },
  {
    id: 'decide',
    label: 'Work in progress',
    items: [
      { href: '/blockers', label: 'Blockers', icon: IconRegister, hint: 'What is stuck, and whose it is' },
      { href: '/decisions', label: 'Decisions', icon: IconDecisions, hint: 'What we decided' },
      { href: '/actions', label: 'Action items', icon: IconActions, hint: 'What people said they would do' },
      { href: '/dependencies', label: 'Dependencies', icon: IconDependencies },
      { href: '/readiness', label: 'Readiness', icon: IconReadiness, hint: 'Gates before a launch' },
      {
        href: '/discussions',
        label: 'Discussions',
        icon: IconConversations,
        hint: 'What keeps coming up and has no owner yet',
      },
      { href: '/series', label: 'Meeting series', icon: IconSeries, hint: 'Recurring meetings, followed session to session' },
    ],
  },
  {
    id: 'inbound',
    label: 'Inbound',
    items: [
      { href: '/intake', label: 'Intake', icon: IconIntake, hint: 'Requests that have not started' },
      { href: '/prioritization', label: 'Prioritization', icon: IconPrioritization },
    ],
  },
  {
    id: 'reference',
    label: 'Reference',
    items: [
      // People (contention) is out for now. The page is still there and still
      // answers a real question — who is committed to two things at once —
      // but nobody was opening it, and a reference section is the first place
      // an unused link becomes clutter.
      { href: '/templates', label: 'Project Documents', icon: IconTemplates },
      {
        href: '/workflow',
        label: 'Workflow Assessment',
        icon: IconWorkflow,
        hint: 'What our systems and people depend on, and what a change reaches',
      },
      {
        href: '/data-dictionary',
        label: 'Data Dictionary',
        icon: IconDictionary,
        hint: 'ClickHouse: what is loaded, and what every table and field means',
      },
    ],
  },
  {
    // Last, and on its own. It is the log — you go to it when something has
    // already happened and you want to know what, which is a different
    // errand from everything above it.
    id: 'log',
    label: null,
    items: [
      { href: '/changes', label: 'Activity', icon: IconActivity, hint: 'What changed, and who changed it' },
    ],
  },
]

/**
 * Whether a nav item is the page you are on.
 *
 * Home matches only itself — `'/'.startsWith` is true for every route, which
 * is how a sidebar ends up with two things highlighted at once.
 */
export function isActive(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
}

/** Which section holds the current page, so it can be open on arrival. */
export function sectionFor(pathname: string): string | null {
  for (const s of NAV) {
    if (s.id && s.items.some((i) => isActive(i.href, pathname))) return s.id
  }
  return null
}
