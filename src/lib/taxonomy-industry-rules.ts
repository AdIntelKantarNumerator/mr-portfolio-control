/**
 * Taxonomy Comparison, Industry View: the pure rules (Scott, 9 November 2026).
 *
 * Pick a node in the GPC taxonomy - Industry Group › Industry › Category ›
 * Subcategory - and see its top 50 spenders in Aug–Sep 2026, as products,
 * brands, advertisers or parent companies.
 *
 * Only a product carries a taxonomy node, so a node's spend is the spend
 * attributed to the products classified anywhere under it (the node and every
 * node below), by the same attribution as the advertiser comparison
 * (lib/taxonomy-dbx.ts ATTRIBUTION). Click Streaming Media and Apple's dollars
 * are the share of Apple's creatives' spend that went to Apple products in
 * Streaming Media - not everything Apple spent on creatives that also showed
 * a streaming product.
 *
 *   product     the GPC product
 *   brand       the entity on the product (product.entity_id)
 *   advertiser  the payer the product's share went to
 *   parent      the top of the advertiser's chain - which is the brand's top
 *               too, since a payer is the brand or one of its ancestors
 *
 * The Unknown product (id 0) has no node, so spend that went to it counts for
 * no node; nor does a product with no classification.
 *
 * No database, no network: the page, the run and the tests read these.
 */
import { MEDIA_TYPES, MONTHS, type FlowFilter, type MediaType, type Month } from './taxonomy-rules'

export const INDUSTRY_BY = ['product', 'brand', 'advertiser', 'parent'] as const
export type IndustryBy = (typeof INDUSTRY_BY)[number]
export const INDUSTRY_BY_LABEL: Record<IndustryBy, string> = { product: 'Product', brand: 'Brand', advertiser: 'Advertiser', parent: 'Parent' }

/** Spenders listed for a node (Scott: the top 50). */
export const TOP_SPENDERS = 50
/**
 * Spenders kept per view when a node is read: more than are shown, so the
 * media and month filters can re-rank without another read. A spender outside
 * the 300 biggest overall who would make the top 50 for one month or medium
 * alone is not seen; at 300 that would take a very lopsided node.
 */
export const KEPT_SPENDERS = 300

/** The levels GPC's taxonomy_node uses, top first. "Major" is defined but holds no nodes (9 November 2026). */
export const TAXONOMY_LEVELS = ['Industry Group', 'Industry', 'Major', 'Category', 'Subcategory'] as const

export interface TaxNode {
  id: string
  parentId: string | null
  level: string
  name: string
}

export interface TreeNode {
  id: string
  level: string
  name: string
  children: TreeNode[]
}

/**
 * The active nodes as a tree, each level sorted by name. A node whose parent
 * is not among them (an active child of an inactive parent) is shown at the
 * top rather than lost.
 */
export function buildTree(nodes: readonly TaxNode[]): TreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, { id: n.id, level: n.level, name: n.name, children: [] as TreeNode[] }]))
  const roots: TreeNode[] = []
  for (const n of nodes) {
    const t = byId.get(n.id)!
    const parent = n.parentId && n.parentId !== n.id ? byId.get(n.parentId) : undefined
    if (parent) parent.children.push(t)
    else roots.push(t)
  }
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name))
    for (const t of list) sort(t.children)
  }
  sort(roots)
  return roots
}

/** The names from the top of the tree down to a node: "Media › Streaming Media › Video Streaming Media". */
export function pathTo(nodes: readonly TaxNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out: string[] = []
  const seen = new Set<string>()
  for (let n = byId.get(id); n && !seen.has(n.id); n = n.parentId ? byId.get(n.parentId) : undefined) {
    seen.add(n.id)
    out.unshift(n.name)
  }
  return out
}

/** Spend in one month on one media type. */
export interface Cell {
  media: MediaType
  month: Month
  spend: number
}

export interface IndustryRow {
  key: string
  label: string
  cells: Cell[]
}

/** One node read: its spend by month and media, and its biggest spenders in each view. */
export interface IndustryResult {
  nodeId: string
  name: string
  level: string
  path: string[]
  totals: Cell[]
  views: Record<IndustryBy, IndustryRow[]>
  /** How many spenders each view has in all, before KEPT_SPENDERS. */
  counts: Record<IndustryBy, number>
  finishedAt: string
}

const keep = (c: Cell, f: FlowFilter) => (!f.media || c.media === f.media) && (!f.month || c.month === f.month)
const sumCells = (cells: readonly Cell[], f: FlowFilter) => cells.reduce((a, c) => a + (keep(c, f) ? c.spend : 0), 0)

export interface RankedSpender {
  key: string
  label: string
  spend: number
  /** Of the node's whole spend under the same filter. */
  share: number
}

export interface IndustryRanking {
  total: number
  rows: RankedSpender[]
  /** What the rows listed take together, of the total. */
  listedShare: number
  /** How many spenders the view has in all. */
  count: number
}

/** A node's top spenders in a view, for a media type and month (both optional). */
export function rankIndustry(r: IndustryResult, by: IndustryBy, f: FlowFilter = {}, top = TOP_SPENDERS): IndustryRanking {
  const total = sumCells(r.totals, f)
  const rows = r.views[by]
    .map((x) => ({ key: x.key, label: x.label, spend: sumCells(x.cells, f) }))
    .filter((x) => x.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, top)
  // Two spenders with one name (two "Apple" entities) are told apart by id.
  const count = new Map<string, number>()
  for (const x of rows) count.set(x.label, (count.get(x.label) ?? 0) + 1)
  const listed = rows.reduce((a, x) => a + x.spend, 0)
  return {
    total,
    rows: rows.map((x) => ({ ...x, label: (count.get(x.label) ?? 0) > 1 ? `${x.label} #${x.key}` : x.label, share: total ? x.spend / total : 0 })),
    listedShare: total ? listed / total : 0,
    count: r.counts[by],
  }
}

/** Raw rows from Databricks (lib/taxonomy-dbx.ts dbxNodeSpenders) into a result. */
export function industryResult(
  node: { id: string; name: string; level: string; path: string[] },
  raw: readonly { gby: string; key: string | null; name: string | null; media: string | null; month: string | null; spend: number }[],
  finishedAt: string,
): IndustryResult {
  const views = Object.fromEntries(INDUSTRY_BY.map((b) => [b, new Map<string, IndustryRow>()])) as Record<IndustryBy, Map<string, IndustryRow>>
  const counts = Object.fromEntries(INDUSTRY_BY.map((b) => [b, 0])) as Record<IndustryBy, number>
  const totals: Cell[] = []
  for (const x of raw) {
    if (x.gby === 'count') {
      if ((INDUSTRY_BY as readonly string[]).includes(x.key ?? '')) counts[x.key as IndustryBy] = x.spend
      continue
    }
    const month = x.month ? (`${x.month.slice(0, 4)}-${x.month.slice(4, 6)}` as Month) : null
    const media = x.media as MediaType | null
    if (!month || !(MONTHS as readonly string[]).includes(month) || !media || !(MEDIA_TYPES as readonly string[]).includes(media) || !x.spend) continue
    const cell = { media, month, spend: x.spend }
    if (x.gby === 'total') {
      totals.push(cell)
      continue
    }
    if (!(INDUSTRY_BY as readonly string[]).includes(x.gby) || !x.key) continue
    const m = views[x.gby as IndustryBy]
    const row = m.get(x.key) ?? { key: x.key, label: x.name || `#${x.key}`, cells: [] }
    row.cells.push(cell)
    m.set(x.key, row)
  }
  return {
    nodeId: node.id,
    name: node.name,
    level: node.level,
    path: node.path,
    totals,
    views: Object.fromEntries(INDUSTRY_BY.map((b) => [b, [...views[b].values()]])) as Record<IndustryBy, IndustryRow[]>,
    counts,
    finishedAt,
  }
}
