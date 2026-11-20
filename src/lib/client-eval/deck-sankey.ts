/**
 * The Impact Deck's from → to Sankey, built from Taxonomy Comparison flows
 * (Client Evaluation, 20 November 2026). Pure, so it can be tested without a
 * database or Databricks.
 */
import type { FlowRaw } from '@/lib/taxonomy-dbx'

export interface SankeyNode {
  name: string
  spend: number
}
export interface SankeyData {
  /** Column titles, left to right. */
  columns: string[]
  /** Nodes per column, largest first ("Other" last). */
  nodes: SankeyNode[][]
  /** Links between adjacent columns, by node index. */
  links: Array<{ col: number; from: number; to: number; spend: number }>
}

const OTHER = 'Other'
/** The attribution's Unknown product (lib/taxonomy-dbx.ts UNKNOWN_NODE), said plainly. */
export const UNKNOWN = 'GPC product not identified'
export const catLabel = (f: FlowRaw) => (f.industry === 'Unknown product' ? UNKNOWN : (f.category ?? f.industry ?? 'Unclassified'))

/** The top n of a tally, the rest as Other. */
export function topN(tally: Map<string, number>, n: number, minShare = 0): { keep: string[]; total: number } {
  const sorted = [...tally].sort((a, b) => b[1] - a[1])
  const total = sorted.reduce((s, [, v]) => s + v, 0)
  // Slivers become Other: on a slide they are unreadable, and they crowd the labels.
  return { keep: sorted.filter(([, v]) => v >= total * minShare).slice(0, n).map(([k]) => k), total }
}

/** FROM entity → GPC advertiser (top parent) → GPC category; or FROM category → GPC category. */
export function sankeyOf(name: string, flows: FlowRaw[], kind: 'advertiser' | 'category', taxonomy: string): SankeyData {
  const advOf = (f: FlowRaw) => f.gpcParentName ?? f.gpcName ?? 'No GPC advertiser'
  const catOf = catLabel
  const advTally = new Map<string, number>()
  const catTally = new Map<string, number>()
  for (const f of flows) {
    advTally.set(advOf(f), (advTally.get(advOf(f)) ?? 0) + f.spend)
    catTally.set(catOf(f), (catTally.get(catOf(f)) ?? 0) + f.spend)
  }
  const advKeep = topN(advTally, 6, 0.03).keep
  const catKeep = topN(catTally, 7, 0.02).keep
  const advKey = (f: FlowRaw) => (advKeep.includes(advOf(f)) ? advOf(f) : OTHER)
  const catKey = (f: FlowRaw) => (catKeep.includes(catOf(f)) ? catOf(f) : OTHER)
  const order = (keep: string[], keyed: Map<string, number>) => [...keep.filter((k) => keyed.has(k)), ...(keyed.has(OTHER) ? [OTHER] : [])]

  const total = flows.reduce((s, f) => s + f.spend, 0)
  const advSpend = new Map<string, number>()
  const catSpend = new Map<string, number>()
  const ac = new Map<string, number>()
  for (const f of flows) {
    const a = advKey(f)
    const c = catKey(f)
    advSpend.set(a, (advSpend.get(a) ?? 0) + f.spend)
    catSpend.set(c, (catSpend.get(c) ?? 0) + f.spend)
    ac.set(`${a}\u0000${c}`, (ac.get(`${a}\u0000${c}`) ?? 0) + f.spend)
  }
  const advCol = order(advKeep, advSpend)
  const catCol = order(catKeep, catSpend)
  if (kind === 'category') {
    return {
      columns: [`${taxonomy} category`, 'GPC category'],
      nodes: [[{ name, spend: total }], catCol.map((c) => ({ name: c, spend: catSpend.get(c)! }))],
      links: catCol.map((c, i) => ({ col: 0, from: 0, to: i, spend: catSpend.get(c)! })),
    }
  }
  return {
    columns: [`${taxonomy} advertiser`, 'GPC advertiser', 'GPC category'],
    nodes: [[{ name, spend: total }], advCol.map((a) => ({ name: a, spend: advSpend.get(a)! })), catCol.map((c) => ({ name: c, spend: catSpend.get(c)! }))],
    links: [
      ...advCol.map((a, i) => ({ col: 0, from: 0, to: i, spend: advSpend.get(a)! })),
      ...[...ac].map(([k, v]) => {
        const [a, c] = k.split('\u0000')
        return { col: 1, from: advCol.indexOf(a!), to: catCol.indexOf(c!), spend: v }
      }),
    ],
  }
}

