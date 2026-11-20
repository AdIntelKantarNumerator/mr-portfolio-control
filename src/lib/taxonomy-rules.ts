/**
 * Taxonomy Comparison: the pure rules.
 *
 * FROM one taxonomy TO GPC (Scott, 30 October 2026; the first version, 29
 * October, set four taxonomies side by side). A person picks the FROM
 * taxonomy — VX1, VX2 or MediaRadar Classic — and pastes advertisers. Each
 * is matched to one FROM entity; that entity's CREATIVES are followed into
 * GPC, so the answer is where the FROM advertiser's dollars land in GPC:
 * which GPC advertisers, and which GPC taxonomy nodes. Nothing in GPC is
 * found by name.
 *
 * Temporary, so the window and media types are constants, not settings.
 * No database, no network: the screen, the run and the tests read the same
 * rules. lib/taxonomy-run.ts does the fetching and the model calls.
 */

export const FROM_TAXONOMIES = ['VX1', 'VX2', 'Classic'] as const
export type FromTaxonomy = (typeof FROM_TAXONOMIES)[number]

export const TAXONOMY_LABEL: Record<FromTaxonomy | 'GPC', string> = {
  VX1: 'VX1',
  VX2: 'VX2',
  Classic: 'MediaRadar Classic',
  GPC: 'GPC',
}

export const isFromTaxonomy = (v: string): v is FromTaxonomy => (FROM_TAXONOMIES as readonly string[]).includes(v)

/**
 * Print was dropped (Scott, 29 October 2026): it is not populated in every
 * taxonomy, so it read as gaps that were not real.
 */
export const MEDIA_TYPES = ['Digital', 'Social', 'Linear TV', 'CTV'] as const
export type MediaType = (typeof MEDIA_TYPES)[number]

/** August and September 2026 only (Scott, 29 October 2026). */
export const MONTHS = ['2026-08', '2026-09'] as const
export type Month = (typeof MONTHS)[number]

export const MONTH_LABEL: Record<Month, string> = { '2026-08': 'Aug 2026', '2026-09': 'Sep 2026' }

export const MAX_ADVERTISERS = 25

/**
 * One advertiser per line. Commas are not separators: "Procter & Gamble Co.,
 * The" is one name. Blank lines and repeats (ignoring case) are dropped.
 */
export function parseAdvertisers(text: string): { names: string[]; error?: string } {
  const seen = new Set<string>()
  const names: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const name = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name.slice(0, 120))
  }
  if (!names.length) return { names, error: 'Paste at least one advertiser, one per line.' }
  if (names.length > MAX_ADVERTISERS) return { names, error: `Up to ${MAX_ADVERTISERS} advertisers at a time; you pasted ${names.length}.` }
  return { names }
}

const SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'plc', 'corp', 'corporation', 'co', 'company', 'companies',
  'the', 'group', 'holdings', 'holding', 'sa', 'ag', 'nv', 'gmbh', 'brands', 'us', 'usa', 'na',
])

/** A name reduced to the words that identify it: case, punctuation and legal suffixes gone. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !SUFFIXES.has(w))
    .join(' ')
}

/**
 * A name as letters and digits only: "Wendy's" and "Wendys" are both "wendys",
 * "AT&T" is "att". Every name search compares this form on both sides — the
 * pasted name and the stored one — so punctuation can never hide a candidate.
 * The SQL side is regexp_replace(lower(name), '[^a-z0-9]', '').
 */
export function compactName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * LIKE patterns, matched against compactName of the stored name:
 *
 *   the whole name compacted         "%wendys%", "%att%"
 *   its distinctive words in order   "%procter%gamble%" (suffixes, "and", 1–2 letter words dropped)
 *   its longest word alone           "%procter%", when the name has several
 */
export function namePatterns(name: string): string[] {
  const out = new Set<string>()
  const whole = compactName(name)
  if (whole) out.add(`%${whole}%`)
  const words = normaliseName(name)
    .split(' ')
    .filter((w) => w.length >= 3 && w !== 'and')
  if (words.length) out.add(`%${words.join('%')}%`)
  const longest = [...words].sort((a, b) => b.length - a.length)[0]
  if (words.length > 1 && longest.length >= 5) out.add(`%${longest}%`)
  return [...out]
}

/** exact: the same name. close: the same once case, punctuation and suffixes are ignored. different: anything else. */
export type MatchKind = 'exact' | 'close' | 'different'

export function matchKind(input: string, found: string): MatchKind {
  if (input.trim().toLowerCase() === found.trim().toLowerCase()) return 'exact'
  return normaliseName(input) === normaliseName(found) ? 'close' : 'different'
}

export interface Candidate {
  id: string
  name: string
  /** Total spend in the window, where the source can say cheaply (Classic), to tell the real advertiser from a namesake. */
  spend?: number
  /** Otherwise a size the source can count quickly: "308 products". */
  size?: string
  /** For ordering when there is no model: spend, or the count behind `size`. */
  weight?: number
  /** VX1 only: "Parent company" or "Advertiser" — VX1 offers both levels. */
  level?: string
  /** What the source calls the level this name sits at, when it is not the advertiser itself. */
  via?: string
}

export interface Resolved {
  id: string
  name: string
  kind: MatchKind
  /** Why this entity was chosen, in a sentence, when it was not an exact name match. */
  reason?: string
  /** Set when a person picked it from the list rather than the model. */
  chosenBy?: string
  /** VX1 only: "Parent company" or "Advertiser". */
  level?: string
}

/**
 * One slice of the FROM entity's spend: a month and media type, landing on
 * one GPC advertiser (null: the creatives have none) and one GPC taxonomy
 * leaf (null levels: unclassified). A creative with several GPC advertisers
 * or products is split evenly, so the slices add up to the FROM spend.
 */
export interface Flow {
  month: Month
  media: MediaType
  gpcId: string | null
  gpcName: string | null
  /** The top of the GPC advertiser's entity tree (materialized_path root); itself when it is the top. */
  gpcParentId?: string | null
  gpcParentName?: string | null
  /**
   * The GPC product the slice was attributed to (lib/taxonomy-dbx.ts
   * ATTRIBUTION); "0" is the Unknown product, null when the creative has no
   * payer. Undefined on runs from before 9 November 2026, which did not
   * record it.
   */
  gpcProductId?: string | null
  gpcProductName?: string | null
  /** GPC's industry group, above the industry (Scott, 20 November 2026). Absent on runs from before. */
  industryGroup?: string | null
  industry: string | null
  category: string | null
  subcategory: string | null
  /**
   * The SOURCE side's own node for the same dollars (Scott, 16 November
   * 2026): the FROM entity's legacy category when comparing into GPC, the
   * GPC category when GPC is the FROM side. Drawn as the breakdown of the
   * left bar. Absent on runs from before.
   */
  srcIndustryGroup?: string | null
  srcIndustry?: string | null
  srcCategory?: string | null
  srcSubcategory?: string | null
  spend: number
}

export interface AdvertiserResult {
  input: string
  entity: Resolved | null
  /** Every FROM candidate the search found, so a person can pick a different one. */
  candidates: Candidate[]
  /** Why nothing matched, when nothing did. */
  missing?: string
  flows: Flow[]
  /** Classic only: Classic's own spend for the entity, beside the creative dollars that reach GPC. */
  classicReported?: number
  flags: Flag[]
  commentary: string
}

export interface Flag {
  /** name: matched under a different name. missing: no FROM entity. unmapped: dollars with no GPC advertiser. split: several GPC advertisers. coverage: Classic dollars against linked creative dollars. */
  kind: 'name' | 'missing' | 'unmapped' | 'split' | 'coverage'
  text: string
}

/**
 * Which way a comparison runs (Scott, 16 November 2026). "to-gpc", the first
 * way: a legacy advertiser's creatives followed into GPC. "from-gpc", the
 * swap: a GPC entity's spend followed into the legacy taxonomy picked, so the
 * Sankey reads GPC on the left and the legacy taxonomy on the right. Flows
 * keep one shape either way: gpc*, industry, category and subcategory are the
 * TARGET side, src* the source side, whatever the target is.
 */
export type Direction = 'to-gpc' | 'from-gpc'

/** The taxonomy on each side of a run. */
export function sides(from: FromTaxonomy, direction: Direction = 'to-gpc'): { left: FromTaxonomy | 'GPC'; right: FromTaxonomy | 'GPC' } {
  return direction === 'from-gpc' ? { left: 'GPC', right: from } : { left: from, right: 'GPC' }
}

/** What each of the three node levels is called in a taxonomy. */
const LEVEL_NAMES: Record<FromTaxonomy | 'GPC', [string, string, string]> = {
  GPC: ['Industry', 'Category', 'Subcategory'],
  VX1: ['Industry', 'Major', 'Class'],
  VX2: ['Industry', 'Category', 'Subcategory'],
  Classic: ['Level 1', 'Level 2', 'Level 3'],
}

export const NODE_LEVELS = ['industry', 'category', 'subcategory'] as const
export type NodeLevel = (typeof NODE_LEVELS)[number]
export const NODE_LEVEL_LABEL: Record<NodeLevel, string> = { industry: 'Industry', category: 'Category', subcategory: 'Subcategory' }

/**
 * The advertiser comparison's levels: the three node levels and, above them,
 * the top of each taxonomy (Scott, 20 November 2026: "add Industry Group").
 * GPC's is its industry group; VX1's its section; VX2's top level already is
 * Omnis' industry group, and Classic's is its first level, so those two show
 * the same nodes as Industry. The Industry View keeps the three NODE_LEVELS.
 */
export const CHART_LEVELS = ['group', ...NODE_LEVELS] as const
export type ChartLevel = (typeof CHART_LEVELS)[number]
const GROUP_NAMES: Record<FromTaxonomy | 'GPC', string> = { GPC: 'Industry Group', VX1: 'Section', VX2: 'Industry Group', Classic: 'Level 1' }

/** A level's name in a taxonomy: VX1's three are Industry, Major and Class, under its Section. */
export const levelName = (tax: FromTaxonomy | 'GPC', level: ChartLevel) => (level === 'group' ? GROUP_NAMES[tax] : LEVEL_NAMES[tax][NODE_LEVELS.indexOf(level)]!)

/** "No GPC advertiser", or "No VX1 advertiser" when the target is VX1. */
export const noneLabel = (target: FromTaxonomy | 'GPC') => (target === 'GPC' ? NO_GPC : `No ${TAXONOMY_LABEL[target]} advertiser`)

export const NO_GPC = 'No GPC advertiser'
export const UNCLASSIFIED = 'Unclassified'
export const OTHER = 'Other'

export interface FlowFilter {
  media?: MediaType | null
  month?: Month | null
}

export const filterFlows = (flows: Flow[], f: FlowFilter = {}) =>
  flows.filter((x) => (!f.media || x.media === f.media) && (!f.month || x.month === f.month))

export const flowTotal = (flows: Flow[]) => flows.reduce((a, x) => a + x.spend, 0)

/** The GPC Unknown product's node label: spend whose payers own none of the creative's products. */
export const UNKNOWN_PRODUCT = 'Unknown product'

/**
 * A node at a level, falling back upward: a missing subcategory takes the
 * category; a missing category takes the industry, marked "(industry level)"
 * because the product sits on the industry itself. The Unknown product has
 * no levels below it, so it keeps its own name.
 */
function nodeAt(group: string | null | undefined, industry: string | null | undefined, category: string | null | undefined, subcategory: string | null | undefined, level: ChartLevel): string {
  // No group recorded (a run from before, or a taxonomy whose top is the industry): the industry stands in.
  if (level === 'group') return group || (industry === UNKNOWN_PRODUCT ? industry : industry || UNCLASSIFIED)
  if (level === 'industry') return industry || UNCLASSIFIED
  const cat = category || (!industry ? UNCLASSIFIED : industry === UNKNOWN_PRODUCT ? industry : `${industry} (industry level)`)
  return level === 'subcategory' ? subcategory || cat : cat
}

/** The GPC node a flow lands on at a level; missing levels fall back as nodeAt does. */
export const nodeOf = (f: Flow, level: ChartLevel): string => nodeAt(f.industryGroup, f.industry, f.category, f.subcategory, level)

/** The source side's node a flow comes from at a level; missing levels fall back as nodeAt does. */
export const srcNodeOf = (f: Flow, level: ChartLevel): string => nodeAt(f.srcIndustryGroup, f.srcIndustry, f.srcCategory, f.srcSubcategory, level)

/** The source side's nodes by spend - the left bar's breakdown - or null for a run that did not record them. */
export function rankSrcNodes(flows: Flow[], level: ChartLevel): Ranked[] | null {
  if (flows.length && flows.every((f) => f.srcIndustry === undefined)) return null
  const by = new Map<string, Ranked>()
  for (const f of flows) {
    const key = srcNodeOf(f, level)
    const r = by.get(key) ?? { key, label: key, spend: 0 }
    r.spend += f.spend
    by.set(key, r)
  }
  return [...by.values()].sort((a, b) => b.spend - a.spend)
}

/** The middle column: the GPC advertiser a creative is assigned to, or the top of that advertiser's tree. */
export type GpcBy = 'advertiser' | 'parent'
export const GPC_BY_LABEL: Record<GpcBy, string> = { advertiser: 'Advertiser', parent: 'Top parent' }

export const advertiserKey = (f: Flow, by: GpcBy = 'advertiser') =>
  (by === 'parent' ? (f.gpcParentId ?? f.gpcId) : f.gpcId) ?? NO_GPC
const advertiserName = (f: Flow, by: GpcBy) => (by === 'parent' ? (f.gpcParentName ?? f.gpcName) : f.gpcName)

export interface Ranked {
  key: string
  label: string
  spend: number
}

/** GPC advertisers by spend, labelled with their id when two share a name. */
export function rankAdvertisers(flows: Flow[], gpcBy: GpcBy = 'advertiser', none: string = NO_GPC): Ranked[] {
  const by = new Map<string, Ranked>()
  for (const f of flows) {
    const key = advertiserKey(f, gpcBy)
    const r = by.get(key) ?? { key, label: advertiserName(f, gpcBy) ?? none, spend: 0 }
    r.spend += f.spend
    by.set(key, r)
  }
  const out = [...by.values()].sort((a, b) => b.spend - a.spend)
  const count = new Map<string, number>()
  for (const r of out) count.set(r.label, (count.get(r.label) ?? 0) + 1)
  for (const r of out) if (r.key !== NO_GPC && (count.get(r.label) ?? 0) > 1) r.label = `${r.label} #${r.key}`
  return out
}

/**
 * GPC products by spend (Scott, 9 November 2026), beside the advertisers.
 * Spend a creative with no payer carries sits under "No GPC advertiser", the
 * same dollars the advertiser list shows there. Null when the run predates
 * products: its flows never recorded them, and an empty list would read as
 * "no products".
 */
export function rankProducts(flows: Flow[]): Ranked[] | null {
  if (flows.length && flows.every((f) => f.gpcProductId === undefined)) return null
  const by = new Map<string, Ranked>()
  for (const f of flows) {
    const key = f.gpcProductId ?? NO_GPC
    const r = by.get(key) ?? { key, label: f.gpcProductName ?? NO_GPC, spend: 0 }
    r.spend += f.spend
    by.set(key, r)
  }
  const out = [...by.values()].sort((a, b) => b.spend - a.spend)
  const count = new Map<string, number>()
  for (const r of out) count.set(r.label, (count.get(r.label) ?? 0) + 1)
  for (const r of out) if (r.key !== NO_GPC && (count.get(r.label) ?? 0) > 1) r.label = `${r.label} #${r.key}`
  return out
}

/** The GPC Unknown product's id: spend whose payers own none of the creative's products. */
export const UNKNOWN_PRODUCT_ID = '0'

export function rankNodes(flows: Flow[], level: ChartLevel): Ranked[] {
  const by = new Map<string, Ranked>()
  for (const f of flows) {
    const key = nodeOf(f, level)
    const r = by.get(key) ?? { key, label: key, spend: 0 }
    r.spend += f.spend
    by.set(key, r)
  }
  return [...by.values()].sort((a, b) => b.spend - a.spend)
}

export interface SankeyData {
  total: number
  advertisers: Ranked[]
  nodes: Ranked[]
  links: { from: string; to: string; spend: number }[]
}

/**
 * The Sankey's three columns: the FROM entity, its top GPC advertisers and
 * its top GPC nodes. Past `top`, the rest fold into "Other"; "No GPC
 * advertiser" and "Unclassified" always stand on their own, because they are
 * the finding, not the tail.
 */
export function sankeyData(flows: Flow[], level: ChartLevel, top = 7, gpcBy: GpcBy = 'advertiser', none: string = NO_GPC): SankeyData {
  const keep = (ranked: Ranked[], special: string) => {
    const named = ranked.filter((r) => r.key !== special && r.spend > 0)
    const kept = named.slice(0, top)
    const rest = named.slice(top)
    const out = [...kept]
    if (rest.length) out.push({ key: OTHER, label: `${OTHER} (${rest.length})`, spend: rest.reduce((a, r) => a + r.spend, 0) })
    const sp = ranked.find((r) => r.key === special && r.spend > 0)
    if (sp) out.push(sp)
    return { out, keys: new Set([...kept.map((r) => r.key), ...(sp ? [special] : [])]) }
  }
  const adv = keep(rankAdvertisers(flows, gpcBy, none), NO_GPC)
  const nodes = keep(rankNodes(flows, level), UNCLASSIFIED)
  const links = new Map<string, { from: string; to: string; spend: number }>()
  for (const f of flows) {
    const from = adv.keys.has(advertiserKey(f, gpcBy)) ? advertiserKey(f, gpcBy) : OTHER
    const to = nodes.keys.has(nodeOf(f, level)) ? nodeOf(f, level) : OTHER
    const k = JSON.stringify([from, to])
    const l = links.get(k) ?? { from, to, spend: 0 }
    l.spend += f.spend
    links.set(k, l)
  }
  return { total: flowTotal(flows), advertisers: adv.out, nodes: nodes.out, links: [...links.values()].filter((l) => l.spend > 0) }
}

// --- a GPC entity's whole spend ------------------------------------------------

/**
 * One slice of a GPC entity's TOTAL Aug–Sep spend, by the FROM entity its
 * creatives belong to — including creatives of other FROM advertisers, which
 * the Sankey (following one FROM entity) never sees. fromId null: the
 * creatives have no entity in the FROM taxonomy. "OTHER": the long tail.
 */
export interface GpcTotalRow {
  fromId: string | null
  fromName: string | null
  /** VX1 only: the parent company ("P<id>"), so a parent-company FROM match can be recognised. */
  fromParentId?: string | null
  fromParentName?: string | null
  month: Month
  media: MediaType
  spend: number
}

/** Stored per run, keyed `${GpcBy}:${GPC id}`, so each entity is computed once however many advertisers reach it. */
export const gpcTotalKey = (by: GpcBy, key: string) => `${by}:${key}`

export const isOwnRow = (row: GpcTotalRow, entity: Resolved | null) =>
  Boolean(entity && (row.fromId === entity.id || (entity.id.startsWith('P') && row.fromParentId === entity.id)))

export interface GpcTotalView {
  total: number
  /** The part that comes from the FROM entity being compared: what the Sankey shows. */
  own: number
  rows: (Ranked & { own: boolean; parent?: string | null })[]
}

export function gpcTotalView(rows: GpcTotalRow[], filter: FlowFilter, entity: Resolved | null, from: FromTaxonomy): GpcTotalView {
  const by = new Map<string, Ranked & { own: boolean; parent?: string | null }>()
  let total = 0
  let own = 0
  for (const r of rows) {
    if ((filter.media && r.media !== filter.media) || (filter.month && r.month !== filter.month)) continue
    total += r.spend
    const mine = isOwnRow(r, entity)
    if (mine) own += r.spend
    const key = r.fromId ?? '∅'
    const label = r.fromId === OTHER.toUpperCase() ? `${OTHER} ${TAXONOMY_LABEL[from]} entities` : (r.fromName ?? `Not in ${TAXONOMY_LABEL[from]}`)
    const x = by.get(key) ?? { key, label, spend: 0, own: mine, parent: r.fromParentName }
    x.spend += r.spend
    by.set(key, x)
  }
  return { total, own, rows: [...by.values()].sort((a, b) => b.spend - a.spend) }
}

/** More than this beyond the FROM entity's own share, and a GPC entity gets its "total spend" button. */
export const hasMoreElsewhere = (v: GpcTotalView) => v.total - v.own > Math.max(1000, v.total * 0.001)

/** Below this share, a GPC advertiser is noise and does not make a split. */
export const SPLIT_SHARE = 0.05
/** Above this share of FROM dollars with no GPC advertiser, it is flagged. */
export const UNMAPPED_SHARE = 0.02

/**
 * The flags for one advertiser, computed — never left to the model — so the
 * same numbers always raise the same flags.
 */
export function computeFlags(
  r: Pick<AdvertiserResult, 'entity' | 'flows' | 'classicReported' | 'missing'>,
  from: FromTaxonomy,
  direction: Direction = 'to-gpc',
): Flag[] {
  const flags: Flag[] = []
  // Named for the side each is about: the source entity, the target advertisers.
  const { left, right } = sides(from, direction)
  const src = TAXONOMY_LABEL[left]
  const dst = TAXONOMY_LABEL[right]
  if (!r.entity) {
    flags.push({ kind: 'missing', text: `${src}: no matching advertiser found${r.missing ? ` — ${r.missing}` : ''}.` })
    return flags
  }
  if (r.entity.kind !== 'exact') {
    const level = r.entity.level ? ` (${r.entity.level.toLowerCase()})` : ''
    const close = r.entity.kind === 'close' ? ' — same name, different punctuation or suffix' : ''
    const reason = r.entity.reason ? ` — ${r.entity.reason.replace(/[.\s]+$/, '')}` : ''
    flags.push({ kind: 'name', text: `${src}: matched "${r.entity.name}"${level}${close}${reason}.` })
  }
  const total = flowTotal(r.flows)
  if (total > 0) {
    const ranked = rankAdvertisers(r.flows)
    const none = ranked.find((x) => x.key === NO_GPC)?.spend ?? 0
    if (none / total > UNMAPPED_SHARE) flags.push({ kind: 'unmapped', text: `${money(none)} (${pct(none / total)}) of the spend has no ${dst} advertiser.` })
    const material = ranked.filter((x) => x.key !== NO_GPC && x.spend / total >= SPLIT_SHARE)
    if (material.length > 1) {
      flags.push({ kind: 'split', text: `Spend splits across ${material.length} ${dst} advertisers: ${material.map((x) => `${x.label} ${pct(x.spend / total)}`).join(', ')}.` })
    }
  } else {
    flags.push({ kind: 'unmapped', text: `No creative spend found for this ${src} entity in Aug–Sep 2026.` })
  }
  if (left === 'Classic' && r.classicReported != null) {
    flags.push({
      kind: 'coverage',
      text: `Classic reports ${money(r.classicReported)}; its creatives, linked through Vivvix, carry ${money(total)} of occurrence spend. They are different estimates: compare the split, not the totals.`,
    })
  }
  return flags
}

export const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`

export function money(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${Math.round(v)}`
}

/** The whole comparison as CSV: one row per advertiser, month, media type, GPC advertiser and GPC leaf. */
export function toCsv(from: FromTaxonomy, results: AdvertiserResult[], direction: Direction = 'to-gpc'): string {
  // Columns named for their side: with the swap, the source is GPC and the target the legacy taxonomy.
  const { left, right } = sides(from, direction)
  const R = TAXONOMY_LABEL[right]
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    [
      'Advertiser (as entered)', 'FROM taxonomy', 'FROM entity', 'FROM level', 'FROM id', 'Month', 'Media type',
      `${R} advertiser`, `${R} id`, `${R} top parent`, `${R} top parent id`, `${R} product`, `${R} product id`,
      `${R} ${levelName(right, 'group').toLowerCase()}`, `${R} ${levelName(right, 'industry').toLowerCase()}`, `${R} ${levelName(right, 'category').toLowerCase()}`, `${R} ${levelName(right, 'subcategory').toLowerCase()}`,
      `FROM ${levelName(left, 'group').toLowerCase()}`, `FROM ${levelName(left, 'industry').toLowerCase()}`, `FROM ${levelName(left, 'category').toLowerCase()}`, `FROM ${levelName(left, 'subcategory').toLowerCase()}`,
      'Spend (USD)', 'Flags',
    ].join(','),
  ]
  for (const r of results) {
    const flagText = r.flags.map((f) => f.text).join(' | ')
    const head = [r.input, TAXONOMY_LABEL[left], r.entity?.name ?? 'not found', r.entity?.level ?? '', r.entity?.id ?? '']
    if (!r.flows.length) {
      lines.push([...head, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 0, flagText].map(esc).join(','))
      continue
    }
    const sorted = [...r.flows].sort((a, b) => a.month.localeCompare(b.month) || a.media.localeCompare(b.media) || b.spend - a.spend)
    for (const f of sorted) {
      lines.push(
        [
          ...head, MONTH_LABEL[f.month], f.media, f.gpcName ?? noneLabel(right), f.gpcId ?? '', f.gpcParentName ?? '', f.gpcParentId ?? '',
          f.gpcProductName ?? '', f.gpcProductId ?? '',
          f.industryGroup ?? '', f.industry ?? UNCLASSIFIED, f.category ?? '', f.subcategory ?? '',
          f.srcIndustryGroup ?? '', f.srcIndustry ?? '', f.srcCategory ?? '', f.srcSubcategory ?? '', Math.round(f.spend), flagText,
        ]
          .map(esc)
          .join(','),
      )
    }
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

// --- the short assessment ---------------------------------------------------------

/**
 * The tile a person reads first, and what Yaara posts in Slack (Scott, 2 November
 * 2026). Four facts, each cut to what matters:
 *
 *   1. the FROM advertiser's total spend;
 *   2. where it lands in GPC — each GPC advertiser (or "No GPC advertiser") with
 *      at least SUMMARY_SHARE of it, the rest as "Others";
 *   3. when one GPC advertiser takes at least DOMINANT_SHARE, that advertiser's
 *      WHOLE GPC spend, split into what followed from this FROM advertiser and
 *      what reached it from creatives the FROM taxonomy files elsewhere;
 *   4. the GPC industries it lands in, the same 10% rule.
 *
 * Computed, never the model's, so the same run always reads the same way.
 */
export const SUMMARY_SHARE = 0.1
export const DOMINANT_SHARE = 0.75

export interface Slice {
  label: string
  spend: number
  share: number
}

export interface Rest {
  count: number
  spend: number
  share: number
}

export interface AdvertiserSummary {
  input: string
  /** The FROM entity matched, or null when none was. */
  fromEntity: string | null
  fromLevel: string | null
  total: number
  gpc: Slice[]
  gpcOthers: Rest | null
  /** Set when one GPC advertiser takes DOMINANT_SHARE or more. gpcTotal is null when the run did not measure it. */
  dominant: {
    label: string
    share: number
    gpcTotal: number | null
    followed: number | null
    followedShare: number | null
    shifted: number | null
    shiftedShare: number | null
  } | null
  industries: Slice[]
  industryOthers: Rest | null
}

function cut(ranked: Ranked[], total: number): { kept: Slice[]; rest: Rest | null } {
  const kept: Slice[] = []
  let count = 0
  let spend = 0
  for (const r of ranked) {
    if (r.spend <= 0) continue
    if (r.spend / total >= SUMMARY_SHARE) kept.push({ label: r.label, spend: r.spend, share: r.spend / total })
    else {
      count++
      spend += r.spend
    }
  }
  return { kept, rest: count ? { count, spend, share: spend / total } : null }
}

export function summarise(a: AdvertiserResult, from: FromTaxonomy, totals: Record<string, GpcTotalRow[]> = {}): AdvertiserSummary {
  const total = flowTotal(a.flows)
  const base = { input: a.input, fromEntity: a.entity?.name ?? null, fromLevel: a.entity?.level ?? null, total }
  if (!a.entity || total <= 0) return { ...base, gpc: [], gpcOthers: null, dominant: null, industries: [], industryOthers: null }

  const advertisers = rankAdvertisers(a.flows, 'advertiser')
  const gpc = cut(advertisers, total)
  const industries = cut(rankNodes(a.flows, 'industry'), total)

  let dominant: AdvertiserSummary['dominant'] = null
  const top = advertisers[0]
  if (top && top.key !== NO_GPC && top.spend / total >= DOMINANT_SHARE) {
    const rows = totals[gpcTotalKey('advertiser', top.key)]
    const v = rows ? gpcTotalView(rows, {}, a.entity, from) : null
    dominant = {
      label: top.label,
      share: top.spend / total,
      gpcTotal: v ? v.total : null,
      followed: v ? v.own : null,
      followedShare: v && v.total ? v.own / v.total : null,
      shifted: v ? v.total - v.own : null,
      shiftedShare: v && v.total ? (v.total - v.own) / v.total : null,
    }
  }
  return { ...base, gpc: gpc.kept, gpcOthers: gpc.rest, dominant, industries: industries.kept, industryOthers: industries.rest }
}

/**
 * The same summary as plain text, for Slack and anything else without the
 * tile. Every line carries dollars AND a percent (Scott, 2 November 2026), so
 * no line has to be read against another to be understood: the section heads
 * carry the whole (100%), and the dominant GPC advertiser's percents are of
 * its own GPC total, which its line says.
 */
export function summaryText(s: AdvertiserSummary, from: FromTaxonomy): string {
  const name = TAXONOMY_LABEL[from]
  if (!s.fromEntity) return `${s.input}: not found in ${name}.`
  const all = `${money(s.total)} (100%)`
  const lines = [`${s.input} — ${name} "${s.fromEntity}"${s.fromLevel ? ` (${s.fromLevel.toLowerCase()})` : ''}: ${all}`]
  lines.push(`Total ${name} spend, Aug–Sep 2026: ${all}`)
  if (s.total <= 0) return [...lines, 'No creative spend in the window.'].join('\n')
  lines.push(`Where it lands in GPC: ${all}`)
  for (const g of s.gpc) lines.push(`  • ${g.label}: ${money(g.spend)} (${pct(g.share)})`)
  if (s.gpcOthers) lines.push(`  • Others (${s.gpcOthers.count}): ${money(s.gpcOthers.spend)} (${pct(s.gpcOthers.share)})`)
  const d = s.dominant
  if (d && d.gpcTotal != null && d.followed != null && d.shifted != null) {
    lines.push(`GPC "${d.label}" in total: ${money(d.gpcTotal)} (100% of its GPC spend)`)
    lines.push(`  • Followed from ${name} "${s.fromEntity}": ${money(d.followed)} (${pct(d.followedShare ?? 0)})`)
    lines.push(`  • From creatives ${name} files under other advertisers: ${money(d.shifted)} (${pct(d.shiftedShare ?? 0)})`)
  }
  lines.push(`GPC industries: ${all}`)
  for (const i of s.industries) lines.push(`  • ${i.label}: ${money(i.spend)} (${pct(i.share)})`)
  if (s.industryOthers) lines.push(`  • Other (${s.industryOthers.count}): ${money(s.industryOthers.spend)} (${pct(s.industryOthers.share)})`)
  return lines.join('\n')
}

// --- the shift, explained -----------------------------------------------------

/** A share with one decimal: near 100% the difference is the point ("99.6%"). */
const exact = (share: number) => `${(Math.floor(share * 1000) / 10).toFixed(1)}%`

export interface ShiftStory {
  /** One sentence: how much, and where most of it lands. */
  headline: string
  /** Why it is not cleaner, when it is not: related entities, unrelated ones, nothing at all, the category it changes to. */
  details: string[]
}

/** At or above this share an unrelated advertiser is worth naming. */
export const UNRELATED_SHARE = 0.05

/**
 * What happened to the spend, in sentences (Scott, 16 November 2026: the
 * narrative should try to explain big shifts). Computed from the flows, never
 * the model's, so it stands when the model is unavailable and reads the same
 * every time:
 *
 *   - the related entities it splits across: everything under the same top
 *     parent as the biggest, or named like it or like the source entity once
 *     legal suffixes go ("Progressive", "The Progressive Corporation") - and
 *     what one entity would take if they were one, with duplicate names said;
 *   - unrelated advertisers taking UNRELATED_SHARE or more each;
 *   - the share with no advertiser on the target side;
 *   - the industry it is mostly in on each side, when the source side's was
 *     recorded.
 */
export function explainShift(
  flows: Flow[],
  opts: { sourceName: string; left: FromTaxonomy | 'GPC'; right: FromTaxonomy | 'GPC' },
): ShiftStory | null {
  const total = flowTotal(flows)
  if (total <= 0) return null
  const right = TAXONOMY_LABEL[opts.right]
  const left = TAXONOMY_LABEL[opts.left]
  const ranked = rankAdvertisers(flows, 'advertiser').filter((r) => r.key !== NO_GPC)
  const top = ranked[0]
  const none = flows.filter((f) => !f.gpcId).reduce((a, f) => a + f.spend, 0)
  const details: string[] = []
  if (!top) return { headline: `${money(total)} of ${left} spend, none of it on a ${right} advertiser.`, details }

  // The family of the biggest: the same top parent, or the same name.
  const parentOf = new Map<string, string>()
  const nameOf = new Map<string, string>()
  for (const f of flows) {
    if (!f.gpcId) continue
    parentOf.set(f.gpcId, f.gpcParentId ?? f.gpcId)
    nameOf.set(f.gpcId, f.gpcName ?? '')
  }
  const names = new Set([normaliseName(nameOf.get(top.key) ?? ''), normaliseName(opts.sourceName)].filter(Boolean))
  const topParent = parentOf.get(top.key)
  const related = ranked.filter((r) => parentOf.get(r.key) === topParent || names.has(normaliseName(nameOf.get(r.key) ?? '')))
  const relatedSpend = related.reduce((a, r) => a + r.spend, 0)
  const topShare = top.spend / total

  const headline = `${money(total)} of ${left} spend; ${pct(topShare)} lands on ${top.label} in ${right}.`

  if (related.length > 1 && relatedSpend / total - topShare >= 0.005) {
    // Same display name, ids aside: "Progressive" three times is a duplicate;
    // "The Progressive Corporation" beside them is a related entity.
    const base = (r: Ranked) => r.label.replace(/ #\w+$/, '')
    const groups = new Map<string, Ranked[]>()
    for (const r of related) groups.set(base(r), [...(groups.get(base(r)) ?? []), r])
    const dupes = [...groups].filter(([, g]) => g.length > 1)
    const others = [...groups].filter(([, g]) => g.length === 1).map(([n]) => n)
    const shown = related.filter((r) => r.spend / total >= 0.0005)
    const list = shown
      .slice(0, 4)
      .map((r) => `${r.label} ${pct(r.spend / total)}`)
      .join(', ')
    const what = dupes.length
      ? `${right} has ${dupes.map(([n, g]) => `${g.length} entities named “${n}”`).join(' and ')}${others.length ? `, plus ${others.slice(0, 2).join(' and ')}` : ''}`
      : `${right} splits it across ${related.length} related entities`
    details.push(`${what} (${list}${shown.length > 4 ? ', …' : ''}). If they were aligned to a single ${right} entity, ${exact(relatedSpend / total)} of the spend would land on it.`)
  }

  const unrelated = ranked.filter((r) => !related.includes(r) && r.spend / total >= UNRELATED_SHARE)
  if (unrelated.length) {
    const u = unrelated.reduce((a, r) => a + r.spend, 0)
    details.push(
      `${pct(u / total)} lands on ${unrelated.length === 1 ? 'an unrelated advertiser' : `${unrelated.length} unrelated advertisers`}: ${unrelated
        .slice(0, 3)
        .map((r) => `${r.label} ${pct(r.spend / total)}`)
        .join(', ')} - creatives ${right} files under a different company.`,
    )
  }

  if (none / total >= 0.01) {
    details.push(
      opts.right === 'GPC'
        ? `${pct(none / total)} has no GPC advertiser: creatives with no paying entity in GPC.`
        : `${pct(none / total)} has no ${right} advertiser: creatives with no ${right} product.`,
    )
  }

  const src = rankSrcNodes(flows, 'industry')
  const dst = rankNodes(flows, 'industry').filter((r) => r.key !== UNCLASSIFIED)
  if (src && src[0] && src[0].key !== UNCLASSIFIED && dst[0]) {
    const a = src[0]
    const b = dst[0]
    details.push(`By industry: mostly ${a.label} in ${left} (${pct(a.spend / total)}), ${b.label} in ${right} (${pct(b.spend / total)}).`)
  }
  return { headline, details }
}

// --- progress ---------------------------------------------------------------

export type StepState = 'waiting' | 'running' | 'done' | 'failed'

export interface Step {
  key: string
  label: string
  state: StepState
  detail?: string
  startedAt?: string
  endedAt?: string
}

export function initialSteps(from: FromTaxonomy, direction: Direction = 'to-gpc'): Step[] {
  if (direction === 'from-gpc') {
    return [
      { key: 'candidates', label: 'Find candidate entities in GPC', state: 'waiting' },
      { key: 'match', label: 'Decide which entity is the advertiser', state: 'waiting' },
      { key: 'flows', label: `Follow its spend into ${TAXONOMY_LABEL[from]} (Databricks)`, state: 'waiting' },
      { key: 'commentary', label: 'Write the commentary', state: 'waiting' },
    ]
  }
  return [
    { key: 'candidates', label: `Find candidate advertisers in ${TAXONOMY_LABEL[from]}`, state: 'waiting' },
    { key: 'match', label: 'Decide which entity is the advertiser', state: 'waiting' },
    { key: 'flows', label: 'Follow its creatives into GPC (Databricks)', state: 'waiting' },
    { key: 'gpc-totals', label: "Check each GPC entity's total spend (Databricks)", state: 'waiting' },
    { key: 'commentary', label: 'Write the commentary', state: 'waiting' },
  ]
}
