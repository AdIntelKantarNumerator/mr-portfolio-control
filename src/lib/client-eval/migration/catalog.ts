/**
 * What Insights Studio can be given (Scott, 23 November 2026): its packages,
 * media and account types, as the production entitlement schema holds them
 * (psflex-mr-clientapps-prod, database insightsstudio, schema entitlement,
 * read 23 November 2026). Insights Studio reads that schema; it is loaded from
 * vxcentral on the MRDPP server.
 *
 * A copy, not a live read: the app has no login to that server yet, and the
 * catalogue changes rarely. Ids are the schema's own, so a plan can later be
 * written straight into it.
 */

export type AccountType = 'publisher' | 'brand_agency'
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = { publisher: 'Publisher', brand_agency: 'Brand/Agency' }

export interface IsPackage {
  id: number
  key: string
  name: string
  kind: 'base' | 'add_on'
  /** What it opens, as the feature and data packages list it. */
  gives: string
}

/** entitlement.intelligence_package, active ones (Market + News is switched off). */
export const PACKAGES: IsPackage[] = [
  { id: 2, key: 'competitive', name: 'Competitive', kind: 'base', gives: 'Spend, units, impressions and basic creative; Advertising Trends, Category and Account Review, Search, Workspaces, Account lists, Exports' },
  { id: 3, key: 'commercial', name: 'Commercial', kind: 'base', gives: 'Contacts, agency data, trigger events and intent signals; Sales Opportunities, Agency and Contact Review, Workspaces, Exports' },
  { id: 4, key: 'creative', name: 'Creative', kind: 'base', gives: 'Messaging and execution, creative details, transcripts and OCR, product attributes; Creative Intel' },
  { id: 5, key: 'sports', name: 'Sports', kind: 'base', gives: 'Sports spend and units; Sports and Sports team review' },
  { id: 6, key: 'ratings_us_linear_tv', name: 'Ratings (US Linear TV)', kind: 'add_on', gives: 'Ratings for US linear TV' },
  { id: 7, key: 'custom_concierge_requests', name: 'Custom concierge requests', kind: 'add_on', gives: 'Custom concierge requests' },
  { id: 8, key: 'ai_assistant', name: 'AI assistant', kind: 'add_on', gives: 'AI assistant' },
  { id: 9, key: 'crm_integrations', name: 'CRM integrations', kind: 'add_on', gives: 'CRM integrations' },
  { id: 10, key: 'sponsorship', name: 'Sponsorship data', kind: 'add_on', gives: 'Sponsorship detail; Program Timeline' },
]
export const packageByKey = new Map(PACKAGES.map((p) => [p.key, p]))

export interface IsMedia {
  id: number
  type: string
  name: string
  active: boolean
}

/** entitlement.media. Inactive media are not in Insights Studio yet. */
export const MEDIA: IsMedia[] = [
  { id: 101, type: 'Television', name: 'Network TV', active: true },
  { id: 102, type: 'Television', name: 'Cable TV', active: true },
  { id: 103, type: 'Television', name: 'Spot TV', active: true },
  { id: 104, type: 'Television', name: 'Syndication', active: true },
  { id: 105, type: 'Television', name: 'Local Cable TV', active: true },
  { id: 106, type: 'Television', name: 'Spanish Language Network TV', active: true },
  { id: 201, type: 'Radio', name: 'Network Radio', active: false },
  { id: 202, type: 'Radio', name: 'Local Radio', active: false },
  { id: 203, type: 'Radio', name: 'National Spot Radio', active: false },
  { id: 401, type: 'Digital', name: 'Browser Display', active: true },
  { id: 402, type: 'Digital', name: 'Browser Video', active: true },
  { id: 403, type: 'Digital', name: 'Mobile Web', active: true },
  { id: 404, type: 'Digital', name: 'Mobile Web Video', active: true },
  { id: 405, type: 'Digital', name: 'Mobile App', active: true },
  // Not in GPC or Insights Studio yet (Scott, 25 November 2026): never added, and a drop for clients who have it.
  { id: 406, type: 'Digital', name: 'Search', active: false },
  { id: 407, type: 'Digital', name: 'Social', active: true },
  { id: 408, type: 'Digital', name: 'Native', active: true },
  { id: 501, type: 'CTV', name: 'AVOD', active: true },
  { id: 502, type: 'CTV', name: 'Live Streaming Sports', active: true },
  { id: 601, type: 'Cinema', name: 'Cinema', active: false },
  { id: 701, type: 'Outdoor', name: 'Outdoor', active: false },
  { id: 702, type: 'Outdoor', name: 'Out-of-Home', active: false },
  { id: 801, type: 'Magazine', name: 'Magazines', active: true },
  { id: 802, type: 'Magazine', name: 'Sunday Magazines', active: true },
  { id: 803, type: 'Magazine', name: 'B-to-B Magazines', active: true },
  { id: 804, type: 'Magazine', name: 'Local Magazines', active: true },
  { id: 805, type: 'Magazine', name: 'Hispanic Magazines', active: true },
  { id: 806, type: 'Magazine', name: 'Medical Journals', active: true },
  { id: 901, type: 'Newspaper', name: 'Newspapers', active: true },
  { id: 902, type: 'Newspaper', name: 'National Newspapers', active: true },
  { id: 903, type: 'Newspaper', name: 'Hispanic Newspapers', active: true },
]

/**
 * Premium media: packaging gives every medium except these, which only clients
 * who have them today keep. Live Streaming Sports (Scott, 23 November 2026);
 * Social and AVOD too (Scott, 24 November 2026). National Newspapers is not
 * premium. Any medium a client has today it keeps.
 */
export const PREMIUM_MEDIA = new Set([407, 501, 502])

/**
 * Legacy media names that mean an Insights Studio medium under another name. CTV is AVOD and BiS Paid Social is
 * Social (Scott, 25 November 2026).
 */
const ALIAS: Record<string, string> = {
  'natl newspapers': 'National Newspapers',
  'national newspaper': 'National Newspapers',
  'span lang net tv': 'Spanish Language Network TV',
  'local cable': 'Local Cable TV',
  'mm local cable': 'Local Cable TV',
  ctv: 'AVOD',
  'bis paid social': 'Social',
  'paid social': 'Social',
}
const activeByName = new Map(MEDIA.filter((m) => m.active).map((m) => [m.name.toLowerCase(), m.name]))

/** The Insights Studio medium a legacy medium is, by its name or a known alias; null when the catalogue has none. */
export function catalogName(legacy: string): string | null {
  const k = legacy.trim().toLowerCase()
  const n = ALIAS[k] ?? activeByName.get(k)
  return n && activeByName.has(n.toLowerCase()) ? n : null
}

/**
 * Media shown as one (Scott, 24 November 2026): every TV medium is "Linear TV", every magazine one (Medical Journals
 * too) "Magazines", every newspaper one "Newspapers". A client with any medium in a group has the group. The
 * entitlement still names each medium; this is how a plan reads.
 */
const MEDIA_GROUP: Record<string, string> = { Television: 'Linear TV', Magazine: 'Magazines', Newspaper: 'Newspapers' }
const groupByName = new Map(MEDIA.map((m) => [m.name.toLowerCase(), MEDIA_GROUP[m.type] ?? m.name]))

/** The name a medium is shown under: its group's, or its own. */
export const mediaGroupOf = (name: string) => groupByName.get(name.toLowerCase()) ?? name

/** Names rolled up into their groups, each once, in the order first seen. */
export const rollupNames = (names: string[]) => [...new Set(names.map(mediaGroupOf))]

/** A plan's media rolled up: a group is kept when any of its media is, otherwise it takes its members' status. */
export function rollupMedia<T extends { name: string; status: 'kept' | 'added' | 'premium' }>(media: T[]): Array<{ name: string; status: T['status']; members: string[] }> {
  const out = new Map<string, { name: string; status: T['status']; members: string[] }>()
  for (const m of media) {
    const name = mediaGroupOf(m.name)
    const g = out.get(name)
    if (!g) out.set(name, { name, status: m.status, members: [m.name] })
    else {
      g.members.push(m.name)
      if (m.status === 'kept' || (m.status === 'premium' && g.status === 'added')) g.status = m.status
    }
  }
  return [...out.values()]
}

/** Countries a plan can name. Non-US only when the client has it today (Scott, 23 November 2026). */
export const COUNTRIES = { US: 'United States', CA: 'Canada' } as const
export type CountryCode = keyof typeof COUNTRIES

/** Membership roles on an account (client_account_membership.role_code). */
export type Role = 'admin' | 'analyst' | 'viewer'

/** Workspace buckets (isappdata.workspace_set_item.set_type, WorkspaceSetType in Insights Studio). */
export const SET_TYPE = { advertisers: 1, properties: 2, competitiveProperties: 3, categories: 4, markets: 5 } as const
export type SetKey = keyof typeof SET_TYPE
export const SET_LABEL: Record<SetKey, string> = {
  advertisers: 'Advertisers',
  properties: 'My Properties',
  competitiveProperties: 'Competitive Properties',
  categories: 'Categories',
  markets: 'Markets',
}

/** Entity types a workspace item may carry (EntityTypeEnum, 360's codes). */
export const ENTITY_TYPE: Record<number, string> = {
  100: 'Product',
  101: 'Subsidiary',
  102: 'Parent',
  103: 'Category',
  104: 'Major',
  105: 'Industry',
  107: 'Industry group',
  118: 'Advertiser',
  135: 'Subcategory',
  139: 'Brand',
  373: 'Property',
  476: 'Media owner',
  477: 'Publisher',
  478: 'Media ultimate brand',
  500: 'Market',
}
