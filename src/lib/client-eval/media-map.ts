/**
 * What a client's media entitlement becomes in Insights Studio (Scott, 20
 * November 2026): each platform's media mapped onto the media GPC carries in
 * Prod ClickHouse. A media with nowhere to go will drop; a GPC media the client
 * does not have today will be added.
 *
 * GPC's media are those with spend in Prod ClickHouse since August 2026
 * (creative.creative_product_media_summary_monthly, read 20 November 2026).
 * The legacy names are mapped by meaning, not by id: the platforms share no
 * media ids. Native is where TROI's website ads sit.
 */
import type { Ent360, EntClassic, EntMagnifier, Platform } from './types'

export const GPC_MEDIA = [
  'Network TV',
  'Cable TV',
  'Spot TV',
  'Syndication',
  'Spanish Language Network TV',
  'Local Cable TV',
  'AVOD',
  'Live Streaming Sports',
  'Browser Display',
  'Browser Video',
  'Mobile Web',
  'Mobile Web Video',
  'Mobile App',
  'Native',
  'Social',
  'Magazines',
  'Newspapers',
] as const
export type GpcMedia = (typeof GPC_MEDIA)[number]

/** How GPC's media group, for the slides. */
export const GPC_GROUP: Record<GpcMedia, string> = {
  'Network TV': 'TV',
  'Cable TV': 'TV',
  'Spot TV': 'TV',
  Syndication: 'TV',
  'Spanish Language Network TV': 'TV',
  'Local Cable TV': 'TV',
  AVOD: 'Streaming',
  'Live Streaming Sports': 'Streaming',
  'Browser Display': 'Digital',
  'Browser Video': 'Digital',
  'Mobile Web': 'Digital',
  'Mobile Web Video': 'Digital',
  'Mobile App': 'Digital',
  Native: 'Digital',
  Social: 'Social',
  Magazines: 'Print',
  Newspapers: 'Print',
}

const TV: GpcMedia[] = ['Network TV', 'Cable TV', 'Spot TV', 'Syndication', 'Spanish Language Network TV', 'Local Cable TV']
const DIGITAL: GpcMedia[] = ['Browser Display', 'Browser Video', 'Mobile Web', 'Mobile Web Video', 'Mobile App']
const PRINT: GpcMedia[] = ['Magazines', 'Newspapers']

/** 360's media (iddb_master.media) and where each goes; [] means it drops. */
export const MEDIA_360: Record<string, GpcMedia[]> = {
  'Network TV': ['Network TV'],
  'Span Lang Net TV': ['Spanish Language Network TV'],
  Syndication: ['Syndication'],
  'Cable TV': ['Cable TV'],
  'Spot TV': ['Spot TV'],
  'Local Cable TV': ['Local Cable TV'],
  'MM Local Cable': ['Local Cable TV'],
  'Network TV-Locally Cleared': ['Spot TV'],
  'Syndicated TV-Locally Cleared': ['Spot TV'],
  'Spanish Lang TV-Locally Cleared': ['Spot TV'],
  'Cable TV-Locally Allocated': ['Local Cable TV'],
  AVOD: ['AVOD'],
  'Live Streaming Sports': ['Live Streaming Sports'],
  'Browser Display': ['Browser Display'],
  'Browser Video': ['Browser Video'],
  'Mobile Web': ['Mobile Web'],
  'Mobile App': ['Mobile App'],
  'Mobile Web Video': ['Mobile Web Video'],
  Social: ['Social'],
  Magazines: ['Magazines'],
  'Sunday Magazines': ['Magazines'],
  'Local Magazines': ['Magazines'],
  'Hispanic Magazines': ['Magazines'],
  'B-to-B Magazines': ['Magazines'],
  Newspapers: ['Newspapers'],
  'Natl Newspapers': ['Newspapers'],
  'Hispanic Newspapers': ['Newspapers'],
  'USA Today': ['Newspapers'],
  'Wall Street Journal': ['Newspapers'],
  'New York Times': ['Newspapers'],
  Search: [],
  'Network Radio': [],
  'Natl Spot Radio': [],
  'Local Radio': [],
  Outdoor: [],
  OOH: [],
  Cinema: [],
  'Medical Journals': [],
  'Branded Entertainment-Network TV': [],
  'Branded Entertainment-CableTV': [],
  DIRECTV: [],
}
/** 360 media that are not US, or no longer collected: left out of an unrestricted client's list. */
const NOT_CURRENT_360 = /canadian|historical|international|intl|custom magazines/i

/** Magnifier's media, as its RELs roll up (rel.ts). */
export const MEDIA_MAGNIFIER: Record<string, GpcMedia[]> = {
  TV: TV,
  Print: PRINT,
  Digital: DIGITAL,
  Social: ['Social'],
  'Paid social': ['Social'],
  Radio: [],
  Outdoor: [],
  Cinema: [],
  'Direct mail': [],
  Email: [],
}

/** Classic's buy-side media (magradar_public.Media), owned-property formats and extra properties. */
export const MEDIA_CLASSIC: Record<string, GpcMedia[]> = {
  'Network TV': ['Network TV'],
  'Cable TV': ['Cable TV'],
  Syndication: ['Syndication'],
  'Spot TV': ['Spot TV'],
  'Local Cable': ['Local Cable TV'],
  'Span Lang Net TV': ['Spanish Language Network TV'],
  'Browser Display': ['Browser Display'],
  'Browser Video': ['Browser Video'],
  Native: ['Native'],
  AVOD: ['AVOD'],
  Social: ['Social'],
  Magazines: ['Magazines'],
  Newspapers: ['Newspapers'],
  'Mobile App': ['Mobile App'],
  'Mobile Web Video': ['Mobile Web Video'],
  'Live Streaming Sports': ['Live Streaming Sports'],
  'Mobile Web': ['Mobile Web'],
  'Local Radio': [],
  Outdoor: [],
  Cinema: [],
  // Owned-property formats (publicationFormats) and extra properties (user_additional*).
  Magazine: ['Magazines'],
  Newspaper: ['Newspapers'],
  Website: DIGITAL,
  Blog: DIGITAL,
  App: ['Mobile App'],
  Facebook: ['Social'],
  Twitter: ['Social'],
  Catalog: [],
  'Direct mail': [],
  'Email blasts': [],
  Publications: PRINT,
  'Digital sites': DIGITAL,
  'TV networks': TV,
  'Radio stations': [],
  'Outdoor markets': [],
  Events: [],
}

/** The media a platform's entitlement names, before mapping. "All" when it does not restrict media. */
export function currentMedia(platform: Platform, ent: Ent360 | EntClassic | EntMagnifier): { media: string[]; restricted: boolean } {
  if (ent.kind === '360') {
    if (!ent.media) return { media: Object.keys(MEDIA_360).filter((m) => !NOT_CURRENT_360.test(m)), restricted: false }
    if (ent.media.include.length) return { media: ent.media.include, restricted: true }
    return { media: Object.keys(MEDIA_360).filter((m) => !NOT_CURRENT_360.test(m) && !ent.media!.exclude.includes(m)), restricted: true }
  }
  if (ent.kind === 'magnifier') {
    if (ent.media.length) return { media: ent.media, restricted: true }
    return { media: ['TV', 'Print', 'Radio', 'Digital', 'Outdoor', 'Cinema'], restricted: false }
  }
  const media = new Set<string>([...ent.media, ...ent.owned.map((o) => o.format), ...ent.extra.map((x) => x.what)])
  return { media: [...media], restricted: true }
}

export interface MediaChange {
  /** Today's media and what each becomes ([] = drops). */
  mapping: Array<{ from: string; to: GpcMedia[] }>
  kept: GpcMedia[]
  dropped: string[]
  added: GpcMedia[]
  /** Digital today: TROI's websites (Native) add to it. */
  hasDigital: boolean
  /** Media names the map does not know: shown, not guessed. */
  unknown: string[]
  restricted: boolean
}

const MAPS: Record<Platform, Record<string, GpcMedia[]>> = { '360': MEDIA_360, magnifier: MEDIA_MAGNIFIER, classic: MEDIA_CLASSIC }

/** Today's media against GPC's: what stays, what drops, what is added. */
export function mediaChange(platform: Platform, media: string[], restricted = true): MediaChange {
  const map = MAPS[platform]
  const mapping: MediaChange['mapping'] = []
  const unknown: string[] = []
  const kept = new Set<GpcMedia>()
  const dropped: string[] = []
  for (const m of [...new Set(media)]) {
    const to = map[m]
    if (!to) {
      unknown.push(m)
      continue
    }
    mapping.push({ from: m, to })
    if (to.length) for (const t of to) kept.add(t)
    else dropped.push(m)
  }
  const hasDigital = [...kept].some((m) => GPC_GROUP[m] === 'Digital')
  // TROI's websites come with digital; Native is new to anyone who has digital but not Native today.
  const added = GPC_MEDIA.filter((m) => !kept.has(m))
  return { mapping, kept: GPC_MEDIA.filter((m) => kept.has(m)), dropped, added, hasDigital, unknown, restricted }
}

/**
 * TROI's additional website coverage (Scott: "use % of additional activity").
 * From the GPC vs Magnifier analysis of 10 November 2026, US, Aug–Oct 2026:
 * TROI carried $1.475B of spend beside $14.4B of BIS digital, about 10% more.
 */
export const TROI_NOTE = {
  pct: 10,
  // Client-facing wording: no provider names (TROI, BIS) in the deck.
  text: 'Additional website coverage: about 10% more digital ad spend from newly added websites, mostly native ads ($1.5B on top of $14.4B, US, Aug–Oct 2026).',
}
