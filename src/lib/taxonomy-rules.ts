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
  industry: string | null
  category: string | null
  subcategory: string | null
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

export const NODE_LEVELS = ['industry', 'category', 'subcategory'] as const
export type NodeLevel = (typeof NODE_LEVELS)[number]
export const NODE_LEVEL_LABEL: Record<NodeLevel, string> = { industry: 'Industry', category: 'Category', subcategory: 'Subcategory' }

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

/** The GPC node a flow lands on at a level; a missing subcategory falls back to the category. */
export function nodeOf(f: Flow, level: NodeLevel): string {
  if (level === 'subcategory') return f.subcategory || f.category || UNCLASSIFIED
  if (level === 'category') return f.category || UNCLASSIFIED
  return f.industry || UNCLASSIFIED
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
export function rankAdvertisers(flows: Flow[], gpcBy: GpcBy = 'advertiser'): Ranked[] {
  const by = new Map<string, Ranked>()
  for (const f of flows) {
    const key = advertiserKey(f, gpcBy)
    const r = by.get(key) ?? { key, label: advertiserName(f, gpcBy) ?? NO_GPC, spend: 0 }
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

export function rankNodes(flows: Flow[], level: NodeLevel): Ranked[] {
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
export function sankeyData(flows: Flow[], level: NodeLevel, top = 7, gpcBy: GpcBy = 'advertiser'): SankeyData {
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
  const adv = keep(rankAdvertisers(flows, gpcBy), NO_GPC)
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
): Flag[] {
  const flags: Flag[] = []
  if (!r.entity) {
    flags.push({ kind: 'missing', text: `${TAXONOMY_LABEL[from]}: no matching advertiser found${r.missing ? ` — ${r.missing}` : ''}.` })
    return flags
  }
  if (r.entity.kind !== 'exact') {
    const level = r.entity.level ? ` (${r.entity.level.toLowerCase()})` : ''
    const close = r.entity.kind === 'close' ? ' — same name, different punctuation or suffix' : ''
    const reason = r.entity.reason ? ` — ${r.entity.reason.replace(/[.\s]+$/, '')}` : ''
    flags.push({ kind: 'name', text: `${TAXONOMY_LABEL[from]}: matched "${r.entity.name}"${level}${close}${reason}.` })
  }
  const total = flowTotal(r.flows)
  if (total > 0) {
    const ranked = rankAdvertisers(r.flows)
    const none = ranked.find((x) => x.key === NO_GPC)?.spend ?? 0
    if (none / total > UNMAPPED_SHARE) flags.push({ kind: 'unmapped', text: `${money(none)} (${pct(none / total)}) of the spend has no GPC advertiser.` })
    const material = ranked.filter((x) => x.key !== NO_GPC && x.spend / total >= SPLIT_SHARE)
    if (material.length > 1) {
      flags.push({ kind: 'split', text: `Spend splits across ${material.length} GPC advertisers: ${material.map((x) => `${x.label} ${pct(x.spend / total)}`).join(', ')}.` })
    }
  } else {
    flags.push({ kind: 'unmapped', text: `No creative spend found for this ${TAXONOMY_LABEL[from]} entity in Aug–Sep 2026.` })
  }
  if (from === 'Classic' && r.classicReported != null) {
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
export function toCsv(from: FromTaxonomy, results: AdvertiserResult[]): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    [
      'Advertiser (as entered)', 'FROM taxonomy', 'FROM entity', 'FROM level', 'FROM id', 'Month', 'Media type',
      'GPC advertiser', 'GPC id', 'GPC top parent', 'GPC top parent id', 'GPC product', 'GPC product id', 'GPC industry', 'GPC category', 'GPC subcategory', 'Spend (USD)', 'Flags',
    ].join(','),
  ]
  for (const r of results) {
    const flagText = r.flags.map((f) => f.text).join(' | ')
    const head = [r.input, TAXONOMY_LABEL[from], r.entity?.name ?? 'not found', r.entity?.level ?? '', r.entity?.id ?? '']
    if (!r.flows.length) {
      lines.push([...head, '', '', '', '', '', '', '', '', '', '', '', 0, flagText].map(esc).join(','))
      continue
    }
    const sorted = [...r.flows].sort((a, b) => a.month.localeCompare(b.month) || a.media.localeCompare(b.media) || b.spend - a.spend)
    for (const f of sorted) {
      lines.push(
        [
          ...head, MONTH_LABEL[f.month], f.media, f.gpcName ?? NO_GPC, f.gpcId ?? '', f.gpcParentName ?? '', f.gpcParentId ?? '',
          f.gpcProductName ?? '', f.gpcProductId ?? '',
          f.industry ?? UNCLASSIFIED, f.category ?? '', f.subcategory ?? '', Math.round(f.spend), flagText,
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

export function initialSteps(from: FromTaxonomy): Step[] {
  return [
    { key: 'candidates', label: `Find candidate advertisers in ${TAXONOMY_LABEL[from]}`, state: 'waiting' },
    { key: 'match', label: 'Decide which entity is the advertiser', state: 'waiting' },
    { key: 'flows', label: 'Follow its creatives into GPC (Databricks)', state: 'waiting' },
    { key: 'gpc-totals', label: "Check each GPC entity's total spend (Databricks)", state: 'waiting' },
    { key: 'commentary', label: 'Write the commentary', state: 'waiting' },
  ]
}
