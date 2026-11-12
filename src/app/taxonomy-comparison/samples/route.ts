/**
 * GET /taxonomy-comparison/samples?run=<id>&input=<advertiser>&by=advertiser|parent&key=<GPC id>
 * GET /taxonomy-comparison/samples?run=<id>&input=<advertiser>&level=industry|category|subcategory&node=<name>
 *
 * The biggest creatives behind one node of an advertiser's Sankey, each with
 * an image or video to show (lib/taxonomy-run.ts runSamples; Scott, 12
 * November 2026). Read from Databricks when a node is clicked. Behind the
 * sign-in like every page.
 */
import { DatabricksError } from '@/lib/databricks'
import type { SampleTarget } from '@/lib/taxonomy-dbx'
import { readRun, runSamples } from '@/lib/taxonomy-run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const run = await readRun(q.get('run') ?? '')
  if (!run?.result) return Response.json({ error: 'No finished comparison with that id.' }, { status: 404 })
  const input = q.get('input') ?? ''
  const by = q.get('by')
  const level = q.get('level')
  let target: SampleTarget
  if ((by === 'advertiser' || by === 'parent') && q.get('key')) target = { by, key: q.get('key')!.slice(0, 200) }
  else if ((level === 'industry' || level === 'category' || level === 'subcategory') && q.get('node')) target = { level, node: q.get('node')!.slice(0, 300) }
  else return Response.json({ error: 'Say which node: by and key, or level and node.' }, { status: 400 })
  try {
    return Response.json(await runSamples(run, input, target), { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    const message = err instanceof DatabricksError ? err.message : `Reading Databricks failed: ${(err as Error).message}`
    return Response.json({ error: message }, { status: 502 })
  }
}
