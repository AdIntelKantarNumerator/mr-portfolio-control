/**
 * GET /taxonomy-comparison/tree?product=<id> | ?entity=<id>
 *
 * The rollup tree behind a tree icon (Scott, 9 November 2026): a GPC product
 * up through its brand to the parent company, or an entity up to its parent.
 * Read live from Databricks (lib/taxonomy-dbx.ts dbxRollup) and kept in this
 * process for an hour: the catalog changes slowly and the same few chains are
 * opened again and again while someone works through a list. Behind the
 * sign-in like every page.
 */
import { DatabricksError } from '@/lib/databricks'
import { dbxRollup, type Rollup } from '@/lib/taxonomy-dbx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HOUR = 3_600_000
const cache = new Map<string, { at: number; value: Rollup | null }>()

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const product = q.get('product') ?? undefined
  const entity = q.get('entity') ?? undefined
  const key = product ? `p:${product}` : `e:${entity ?? ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < HOUR) return Response.json(hit.value)
  try {
    const value = await dbxRollup({ product, entity })
    if (!value) return Response.json({ error: 'Nothing in GPC with that id.' }, { status: 404 })
    cache.set(key, { at: Date.now(), value })
    if (cache.size > 2000) cache.delete(cache.keys().next().value!)
    return Response.json(value, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    const message = err instanceof DatabricksError ? err.message : `Reading Databricks failed: ${(err as Error).message}`
    return Response.json({ error: message }, { status: 502 })
  }
}
