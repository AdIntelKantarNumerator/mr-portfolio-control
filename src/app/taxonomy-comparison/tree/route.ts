/**
 * GET /taxonomy-comparison/tree?product=<id> | ?entity=<id>   the family tree
 * GET /taxonomy-comparison/tree?products=<entity id>[&first=<product id>]   one entity's products
 *
 * Behind the tree icon (Scott, 9 and 10 November 2026): the whole family a GPC
 * product or entity belongs to, from the top parent down, and the products of
 * an entity when it is opened. Read live from Databricks (lib/taxonomy-dbx.ts
 * dbxFamily, dbxEntityProducts) and kept in this process for an hour: the
 * catalog changes slowly, and the same families are opened again and again
 * while someone works through a list. Behind the sign-in like every page.
 */
import { DatabricksError } from '@/lib/databricks'
import { dbxEntityProducts, dbxFamily } from '@/lib/taxonomy-dbx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HOUR = 3_600_000
const cache = new Map<string, { at: number; value: unknown }>()

async function cached<T>(key: string, read: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < HOUR) return hit.value as T
  const value = await read()
  cache.set(key, { at: Date.now(), value })
  if (cache.size > 2000) cache.delete(cache.keys().next().value!)
  return value
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const product = q.get('product') ?? undefined
  const entity = q.get('entity') ?? undefined
  const products = q.get('products')
  try {
    const first = q.get('first')
    if (products) return Response.json(await cached(`ps:${products}:${first ?? ''}`, () => dbxEntityProducts(products, first)))
    const value = await cached(product ? `p:${product}` : `e:${entity ?? ''}`, () => dbxFamily({ product, entity }))
    if (!value) return Response.json({ error: 'Nothing in GPC with that id.' }, { status: 404 })
    return Response.json(value, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    const message = err instanceof DatabricksError ? err.message : `Reading Databricks failed: ${(err as Error).message}`
    return Response.json({ error: message }, { status: 502 })
  }
}
