/**
 * Taxonomy Comparison, Industry View: reading the tree and a node's spenders,
 * and keeping them (Scott, 9 November 2026).
 *
 * Like a comparison run (lib/taxonomy-run.ts), each read is a row - in
 * taxonomy_industry, keyed "tree" or "node:<id>" - that the work writes its
 * progress to while the screen polls it. Unlike a run it is kept and shared:
 * the window is a fixed Aug–Sep 2026, so a node read once is the answer for
 * everybody until someone asks for it to be read again. A node takes 13 to 22
 * seconds warm and minutes on a cold warehouse; nobody should wait twice.
 */
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { classicBrandSpend, classicCategories, classicVxCategories, taxonomyIndustry } from '@/db/schema'
import { dbxLegacyNodeName, dbxLegacySpenders, dbxNodeSpenders, dbxTaxonomyTree, type NodeSpenderRaw } from './taxonomy-dbx'
import {
  industryResult,
  KEPT_SPENDERS,
  LEGACY_LABEL,
  LEGACY_LEVELS,
  legacyPlacement,
  pathTo,
  type IndustryResult,
  type LegacyTaxonomy,
  type TaxNode,
} from './taxonomy-industry-rules'
import type { Step } from './taxonomy-rules'

export const TREE_KEY = 'tree'
export const nodeKey = (id: string) => `node:${id}`
/** A legacy node read for "Compare to": "legacy:VX1:industry:123", "legacy:Classic:2:4165". */
export const legacyKey = (tax: LegacyTaxonomy, level: string, id: string) => `legacy:${tax}:${level}:${id}`
const LEGACY_KEY = /^legacy:(VX1|VX2|Classic):([a-z0-9]+):(\d{1,12})$/

/**
 * A read still marked running after this long was cut off - the process
 * restarted part way - and is started again rather than waited on forever.
 */
const STALE_MS = 15 * 60_000

function stepsFor(key: string): Step[] {
  const legacy = LEGACY_KEY.exec(key)
  if (legacy) {
    const tax = legacy[1] as LegacyTaxonomy
    return tax === 'Classic'
      ? [{ key: 'spend', label: 'Add up the Classic snapshot by brand and company', state: 'waiting' }]
      : [
          { key: 'tree', label: `Find the ${tax} node`, state: 'waiting' },
          { key: 'spend', label: `Read all its Aug–Sep spend by ${tax} product (Databricks)`, state: 'waiting' },
          { key: 'rank', label: 'Rank the spenders', state: 'waiting' },
        ]
  }
  return key === TREE_KEY
    ? [{ key: 'tree', label: 'Read the GPC taxonomy (Databricks)', state: 'waiting' }]
    : [
        { key: 'tree', label: 'Find the node and everything under it', state: 'waiting' },
        { key: 'spend', label: "Attribute its products' Aug–Sep spend (Databricks)", state: 'waiting' },
        { key: 'rank', label: 'Rank the spenders', state: 'waiting' },
      ]
}

export interface IndustryView<T> {
  key: string
  status: 'running' | 'done' | 'failed'
  steps: Step[]
  result: T | null
  error: string | null
  askedBy: string | null
  updatedAt: string
}

export async function readIndustry<T = unknown>(key: string): Promise<IndustryView<T> | null> {
  const [row] = await db.select().from(taxonomyIndustry).where(eq(taxonomyIndustry.key, key))
  if (!row) return null
  return {
    key: row.key,
    status: row.status as IndustryView<T>['status'],
    steps: JSON.parse(row.progress) as Step[],
    result: row.result ? (JSON.parse(row.result) as T) : null,
    error: row.error,
    askedBy: row.askedBy,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Start reading the tree or a node, unless it is already read (and `again`
 * is not asked) or being read now. Returns at once; the work carries on in
 * this process.
 */
export async function startIndustry(key: string, askedBy: string | null, again = false): Promise<void> {
  if (key !== TREE_KEY && !/^node:\d{1,12}$/.test(key) && !LEGACY_KEY.test(key)) throw new Error(`Not something the Industry View reads: ${key}`)
  const now = await readIndustry(key)
  if (now?.status === 'running' && Date.now() - Date.parse(now.updatedAt) < STALE_MS) return
  if (now?.status === 'done' && !again) return

  const steps = stepsFor(key)
  const values = { key, status: 'running', progress: JSON.stringify(steps), result: null, error: null, askedBy, updatedAt: new Date() }
  await db.insert(taxonomyIndustry).values(values).onConflictDoUpdate({ target: taxonomyIndustry.key, set: values })
  void execute(key, steps).catch(async (err) => {
    console.error('[taxonomy industry] read failed', err)
    await db
      .update(taxonomyIndustry)
      .set({ status: 'failed', error: (err as Error).message?.slice(0, 1000) ?? 'Failed', updatedAt: new Date() })
      .where(eq(taxonomyIndustry.key, key))
  })
}

async function execute(key: string, steps: Step[]): Promise<void> {
  const save = () => db.update(taxonomyIndustry).set({ progress: JSON.stringify(steps), updatedAt: new Date() }).where(eq(taxonomyIndustry.key, key))
  const step = async <T>(k: string, work: (note: (detail: string) => Promise<void>) => Promise<T>): Promise<T> => {
    const s = steps.find((x) => x.key === k)!
    s.state = 'running'
    s.startedAt = new Date().toISOString()
    await save()
    const note = async (detail: string) => {
      s.detail = detail
      await save()
    }
    try {
      const out = await work(note)
      s.state = 'done'
      s.endedAt = new Date().toISOString()
      await save()
      return out
    } catch (err) {
      s.state = 'failed'
      s.detail = (err as Error).message
      s.endedAt = new Date().toISOString()
      await save()
      throw err
    }
  }

  const finish = (result: unknown) =>
    db.update(taxonomyIndustry).set({ status: 'done', result: JSON.stringify(result), updatedAt: new Date() }).where(eq(taxonomyIndustry.key, key))

  if (key === TREE_KEY) {
    const nodes = await step('tree', async (note) => {
      const out = await dbxTaxonomyTree((s) => note(`Query running… ${s}s`))
      await note(`${out.length} nodes`)
      return out
    })
    await finish(nodes)
    return
  }

  const legacy = LEGACY_KEY.exec(key)
  if (legacy) {
    await finish(await readLegacy(legacy[1] as LegacyTaxonomy, legacy[2]!, legacy[3]!, step))
    return
  }

  const id = key.slice('node:'.length)
  const node = await step('tree', async (note) => {
    // The tree read for the page, when there is one; it holds every active node.
    const tree = (await readIndustry<TaxNode[]>(TREE_KEY))?.result ?? (await dbxTaxonomyTree())
    const found = tree.find((n) => n.id === id)
    if (!found) throw new Error(`There is no active taxonomy node ${id}.`)
    const path = pathTo(tree, id)
    await note(path.join(' › '))
    return { id, name: found.name, level: found.level, path }
  })
  const raw = await step('spend', (note) => dbxNodeSpenders(id, KEPT_SPENDERS, (s) => note(`Query running… ${s}s`)))
  const result = await step('rank', async (note) => {
    const out: IndustryResult = industryResult(node, raw, new Date().toISOString())
    // Where the node's spend falls in VX1 and VX2 came with the read; Classic
    // is placed here, from the snapshot, by each creative's VX0 product.
    const legacy = raw
      .filter((r) => r.gby === 'legacy' && r.key)
      .map((r) => {
        const [tax, level, lid] = r.key!.split('|')
        return { tax: tax!, level: level!, id: lid!, name: r.name ?? `#${lid}`, spend: r.spend }
      })
    out.legacy = legacyPlacement([...legacy, ...(await classicPlacement(raw.filter((r) => r.gby === 'vx0')))])
    await note(`${out.counts.product.toLocaleString('en-US')} products, ${out.counts.advertiser.toLocaleString('en-US')} advertisers`)
    return out
  })
  await finish(result)
}

type StepFn = <T>(k: string, work: (note: (detail: string) => Promise<void>) => Promise<T>) => Promise<T>

/**
 * A GPC node's spend placed in Classic's categories: each VX0 product's share
 * goes to the category of the Classic brand Vivvix maps it to (split evenly
 * when it maps to several), and counts at that category and every one above
 * it. Products with no Classic brand are not placed.
 */
async function classicPlacement(rows: readonly NodeSpenderRaw[]): Promise<{ tax: string; level: string; id: string; name: string; spend: number }[]> {
  const spendOf = new Map<number, number>()
  for (const r of rows) if (r.key && /^\d+$/.test(r.key)) spendOf.set(Number(r.key), (spendOf.get(Number(r.key)) ?? 0) + r.spend)
  if (!spendOf.size) return []
  const links: { vxProductId: number; categoryId: number }[] = []
  const ids = [...spendOf.keys()]
  for (let i = 0; i < ids.length; i += 5000) {
    links.push(...(await db.select().from(classicVxCategories).where(inArray(classicVxCategories.vxProductId, ids.slice(i, i + 5000)))))
  }
  if (!links.length) return []
  const cats = new Map((await db.select().from(classicCategories)).map((c) => [c.id, c]))
  const perProduct = new Map<number, number>()
  for (const l of links) perProduct.set(l.vxProductId, (perProduct.get(l.vxProductId) ?? 0) + 1)
  const at = new Map<number, number>()
  for (const l of links) {
    const share = (spendOf.get(l.vxProductId) ?? 0) / perProduct.get(l.vxProductId)!
    const seen = new Set<number>()
    for (let c = cats.get(l.categoryId); c && !seen.has(c.id); c = c.parentId != null ? cats.get(c.parentId) : undefined) {
      seen.add(c.id)
      if (c.depth >= 1) at.set(c.id, (at.get(c.id) ?? 0) + share)
    }
  }
  return [...at].map(([id, spend]) => {
    const c = cats.get(id)!
    return { tax: 'Classic', level: String(c.depth), id: String(id), name: c.name, spend }
  })
}

/** One legacy node's spenders: VX1 and VX2 from Databricks, Classic from its snapshot. */
async function readLegacy(tax: LegacyTaxonomy, level: string, id: string, step: StepFn): Promise<IndustryResult> {
  const levelLabel = LEGACY_LEVELS[tax].find((l) => l.key === level)?.label ?? level
  if (tax === 'Classic') return step('spend', (note) => readClassic(id, levelLabel, note))
  const named = await step('tree', async (note) => {
    const found = await dbxLegacyNodeName(tax, level, id)
    if (!found) throw new Error(`There is no ${LEGACY_LABEL[tax]} ${levelLabel.toLowerCase()} ${id}.`)
    await note(found.path.join(' › '))
    return found
  })
  const raw = await step('spend', (note) => dbxLegacySpenders(tax, level, id, KEPT_SPENDERS, (s) => note(`Query running… ${s}s`)))
  return step('rank', async (note) => {
    const out = industryResult({ id: `${tax}:${level}:${id}`, name: named.name, level: levelLabel, path: named.path }, raw, new Date().toISOString())
    await note(`${out.counts.advertiser.toLocaleString('en-US')} advertisers`)
    return out
  })
}

/**
 * A Classic category's spenders, from the snapshot: every brand in the
 * category or below it. Classic's advertiser is the top of its company tree,
 * so the Advertiser and Parent views are the same list; it has no products.
 */
async function readClassic(id: string, levelLabel: string, note: (d: string) => Promise<void>): Promise<IndustryResult> {
  const cats = await db.select().from(classicCategories)
  const node = cats.find((c) => c.id === Number(id))
  if (!node) throw new Error(`There is no Classic category ${id} in the snapshot. Load it again (npm run load:classic).`)
  const under = new Set([node.id])
  for (let grew = true; grew; ) {
    grew = false
    for (const c of cats) {
      if (c.parentId != null && under.has(c.parentId) && !under.has(c.id)) {
        under.add(c.id)
        grew = true
      }
    }
  }
  const rows = await db.select().from(classicBrandSpend).where(inArray(classicBrandSpend.categoryId, [...under]))
  const sums = new Map<string, NodeSpenderRaw>()
  const add = (gby: string, key: string | null, name: string | null, media: string, month: string, spend: number) => {
    const k = `${gby}|${key}|${media}|${month}`
    const prior = sums.get(k)
    if (prior) prior.spend += spend
    else sums.set(k, { gby, key, name, media, month: month.replace('-', ''), spend })
  }
  const brands = new Set<number>()
  const companies = new Set<number>()
  for (const r of rows) {
    add('brand', String(r.brandId), r.brandName, r.mediaType, r.month, r.spend)
    add('advertiser', String(r.advertiserId), r.advertiserName, r.mediaType, r.month, r.spend)
    add('parent', String(r.advertiserId), r.advertiserName, r.mediaType, r.month, r.spend)
    add('total', null, null, r.mediaType, r.month, r.spend)
    brands.add(r.brandId)
    companies.add(r.advertiserId)
  }
  const raw = [
    ...sums.values(),
    { gby: 'count', key: 'brand', name: null, media: null, month: null, spend: brands.size },
    { gby: 'count', key: 'advertiser', name: null, media: null, month: null, spend: companies.size },
    { gby: 'count', key: 'parent', name: null, media: null, month: null, spend: companies.size },
  ]
  await note(`${brands.size.toLocaleString('en-US')} brands, ${companies.size.toLocaleString('en-US')} companies`)
  const out = industryResult({ id: `Classic:${node.depth}:${id}`, name: node.name, level: levelLabel, path: node.chain.split('>').map((x) => x.trim()) }, raw, new Date().toISOString())
  // Keep the biggest per view, as a Databricks read does.
  const total = (x: { cells: { spend: number }[] }) => x.cells.reduce((a, c) => a + c.spend, 0)
  for (const by of ['brand', 'advertiser', 'parent'] as const) out.views[by] = out.views[by].sort((a, b) => total(b) - total(a)).slice(0, KEPT_SPENDERS)
  return out
}
