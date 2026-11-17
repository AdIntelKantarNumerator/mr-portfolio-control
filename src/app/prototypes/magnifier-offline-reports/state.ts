/**
 * Everything a report shows is in its address, so every drill-down is a link
 * and every view can be shared. This file reads and writes that state.
 */
import { idParam, type Who } from '@/lib/magnifier-reports/rules'

export const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'advertisers', label: 'Advertisers' },
  { id: 'products', label: 'Products' },
  { id: 'media', label: 'Media' },
  { id: 'outlets', label: 'Outlets' },
  { id: 'creatives', label: 'Creatives' },
  { id: 'occurrences', label: 'Occurrences' },
  { id: 'fasttrack', label: 'Weekly FastTrack' },
] as const
export type Tab = (typeof TABS)[number]['id']

export interface State {
  node: number | null
  tab: Tab
  /** The report month, 202610; null for the latest complete one. */
  m: number | null
  /** The FastTrack / occurrence week (its Monday); null for the latest whole one. */
  w: string | null
  media: string | null
  /** The focus advertiser (or parent, by `who`). */
  adv: number | null
  who: Who
  /** Month, or every complete month. */
  span: 'month' | 'all'
  /** Media tab: spending, media mix (row %) or share of voice (column %). */
  view: 'spend' | 'mix' | 'sov'
  /** Products tab: one row per product and media. */
  bymedia: boolean
}

type Search = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)

export function readState(sp: Search): State {
  const tab = one(sp.tab)
  const w = one(sp.w)
  const media = one(sp.media)
  const view = one(sp.view)
  return {
    node: idParam(sp.node),
    tab: TABS.some((t) => t.id === tab) ? (tab as Tab) : 'dashboard',
    m: idParam(sp.m),
    w: w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : null,
    media: media && media.length <= 80 ? media : null,
    adv: idParam(sp.adv),
    who: one(sp.who) === 'parent' ? 'parent' : 'advertiser',
    span: one(sp.span) === 'all' ? 'all' : 'month',
    view: view === 'mix' || view === 'sov' ? view : 'spend',
    bymedia: one(sp.bymedia) === '1',
  }
}

/** The address of this state with some of it changed. Defaults are left out. */
export function href(s: State, patch: Partial<State> = {}): string {
  const x = { ...s, ...patch }
  const p = new URLSearchParams()
  if (x.node != null) p.set('node', String(x.node))
  if (x.tab !== 'dashboard') p.set('tab', x.tab)
  if (x.m != null) p.set('m', String(x.m))
  if (x.w) p.set('w', x.w)
  if (x.media) p.set('media', x.media)
  if (x.adv != null) p.set('adv', String(x.adv))
  if (x.who !== 'advertiser') p.set('who', x.who)
  if (x.span !== 'month') p.set('span', x.span)
  if (x.view !== 'spend') p.set('view', x.view)
  if (x.bymedia) p.set('bymedia', '1')
  const q = p.toString()
  return q ? `?${q}` : '?'
}
