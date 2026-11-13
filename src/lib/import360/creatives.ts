/**
 * Finding a 360 name in GPC by its creatives (12 November 2026).
 *
 * Scott: when a 360 advertiser ("McDonalds Restaurant", "Michelob Ultra")
 * is not found in GPC by name, follow a sample of its creatives in the
 * Databricks Gold layer and take a best guess at the GPC entity; if it is
 * still uncertain, suggest matches and let the person pick one, or drop it.
 *
 * 360's ids are VX1's: an advertiser is brandcentral source_advertiser_id, a
 * parent is P<source_company_id>, a brand is B<product.brand_id>. Each is
 * followed through gold.creative into the GPC serving model's attribution
 * (lib/taxonomy-dbx.ts dbxFlows, the Taxonomy Comparison's own path), for
 * the months it covers. Where those dollars land says who the entity is in
 * GPC: McDonalds Restaurant puts 98.7% of its spend on GPC's "McDonald's".
 *
 * Pure: the landing comes in; `decide` says whether it is sure.
 */
import type { DimKey } from '@/lib/report-builder/data/types'

/** The 360 entity types a creative can be followed from, and how they read in GPC. */
export const FOLLOWS: Record<number, { prefix: string; level: 'advertiser' | 'top_parent' | 'product' }> = {
  118: { prefix: '', level: 'advertiser' },
  102: { prefix: 'P', level: 'top_parent' },
  139: { prefix: 'B', level: 'product' },
}

export interface Landed {
  id: string
  name: string
  context?: string
  spend: number
  share: number
}
/** Where one 360 entity's creatives' dollars land in GPC, at each level. */
export interface Landing {
  total: number
  advertiser: Landed[]
  top_parent: Landed[]
  product: Landed[]
}

export interface Suggestion extends Landed {
  /** How it was found: by its creatives, or by its name. */
  via: 'creatives' | 'name'
}
export interface Resolution {
  status: 'matched' | 'uncertain'
  /** When matched: the GPC ids to use, their names, and why. */
  pick?: { ids: string[]; names: string[]; why: string }
  suggestions: Suggestion[]
  /** Spend followed, for saying how much was looked at. */
  followed: number
}

/** Flows as dbxFlows returns them, summed per GPC entity at each level. */
type F = string | null | undefined
export function landingOf(flows: Array<{ gpcId: F; gpcName: F; gpcParentId?: F; gpcParentName?: F; gpcProductId?: F; gpcProductName?: F; spend: number }>): Landing {
  const sum = (key: (f: (typeof flows)[number]) => [F, F], dim: DimKey, context?: (f: (typeof flows)[number]) => string | undefined) => {
    const m = new Map<string, Landed>()
    for (const f of flows) {
      const [id, name] = key(f)
      if (!id || id === '0' || !name) continue
      const k = `${dim}:${id}`
      const cur = m.get(k) ?? { id: k, name, context: context?.(f), spend: 0, share: 0 }
      cur.spend += f.spend
      m.set(k, cur)
    }
    return [...m.values()]
  }
  const total = flows.reduce((a, f) => a + f.spend, 0)
  const shares = (xs: Landed[]) => xs.map((x) => ({ ...x, share: total ? x.spend / total : 0 })).sort((a, b) => b.spend - a.spend)
  return {
    total,
    advertiser: shares(sum((f) => [f.gpcId, f.gpcName], 'advertiser', (f) => (f.gpcParentName && f.gpcParentName !== f.gpcName ? f.gpcParentName : undefined))),
    top_parent: shares(sum((f) => [f.gpcParentId, f.gpcParentName], 'top_parent')),
    product: shares(sum((f) => [f.gpcProductId, f.gpcProductName], 'product', (f) => f.gpcName ?? undefined)),
  }
}

const SURE = 0.8
const MAX_PRODUCTS = 6
const pct = (x: number) => `${Math.round(x * 100)}%`

/**
 * Whether the landing settles it. One GPC entity taking most of the spend
 * does; for an advertiser, that entity must not be far bigger in GPC than the
 * 360 advertiser (a brand-named advertiser landing on its whole parent
 * company), or the few GPC products that hold the spend are used instead.
 * `gpcSize` gives an entity's GPC spend over the same span, when known.
 */
export function decide(e: number, l: Landing, gpcSize?: (id: string) => number | undefined): Resolution {
  const f = FOLLOWS[e]
  const followed = l.total
  const top = (xs: Landed[], n: number): Suggestion[] => xs.slice(0, n).map((x) => ({ ...x, via: 'creatives' as const }))
  const products = () => {
    let acc = 0
    const set: Landed[] = []
    for (const p of l.product) {
      if (acc >= SURE || set.length >= MAX_PRODUCTS) break
      set.push(p)
      acc += p.share
    }
    return acc >= SURE ? { set, acc } : null
  }
  const suggestions = f ? [...top(l[f.level], 5), ...top(f.level === 'product' ? l.advertiser : l.product, 3)] : []
  if (!f || !l.total) return { status: 'uncertain', suggestions, followed }

  if (f.level === 'product') {
    const p = products()
    if (p) return { status: 'matched', pick: { ids: p.set.map((x) => x.id), names: p.set.map((x) => x.name), why: `${pct(p.acc)} of its creatives' spend is on ${p.set.length === 1 ? 'this GPC product' : `these ${p.set.length} GPC products`}` }, suggestions, followed }
    return { status: 'uncertain', suggestions, followed }
  }
  const best = l[f.level][0]
  if (!best || best.share < SURE) return { status: 'uncertain', suggestions, followed }
  const size = gpcSize?.(best.id)
  // Far bigger in GPC than what this entity spent (360's span is two months of the three): its products instead.
  if (f.level === 'advertiser' && size != null && size > 3 * l.total * 1.5) {
    const p = products()
    if (p) return { status: 'matched', pick: { ids: p.set.map((x) => x.id), names: p.set.map((x) => x.name), why: `its creatives land on ${best.name}, which is much bigger in GPC, so the ${p.set.length === 1 ? 'GPC product' : `${p.set.length} GPC products`} holding ${pct(p.acc)} of its spend are used` }, suggestions, followed }
    return { status: 'uncertain', suggestions, followed }
  }
  return { status: 'matched', pick: { ids: [best.id], names: [best.name], why: `${pct(best.share)} of its creatives' spend is on ${best.name} in GPC` }, suggestions, followed }
}
