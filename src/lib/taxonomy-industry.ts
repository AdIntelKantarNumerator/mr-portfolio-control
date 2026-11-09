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
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { taxonomyIndustry } from '@/db/schema'
import { dbxNodeSpenders, dbxTaxonomyTree } from './taxonomy-dbx'
import { industryResult, KEPT_SPENDERS, pathTo, type IndustryResult, type TaxNode } from './taxonomy-industry-rules'
import type { Step } from './taxonomy-rules'

export const TREE_KEY = 'tree'
export const nodeKey = (id: string) => `node:${id}`

/**
 * A read still marked running after this long was cut off - the process
 * restarted part way - and is started again rather than waited on forever.
 */
const STALE_MS = 15 * 60_000

function stepsFor(key: string): Step[] {
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
  if (key !== TREE_KEY && !/^node:\d{1,12}$/.test(key)) throw new Error(`Not something the Industry View reads: ${key}`)
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
    await note(`${out.counts.product.toLocaleString('en-US')} products, ${out.counts.advertiser.toLocaleString('en-US')} advertisers`)
    return out
  })
  await finish(result)
}
