/**
 * GET /taxonomy-comparison/samples?run=<id>&input=<advertiser>&by=advertiser|parent&key=<GPC id>
 * GET /taxonomy-comparison/samples?run=<id>&input=<advertiser>&level=industry|category|subcategory&node=<name>
 *     either with &media=<Digital|Social|Linear TV|CTV> and &month=<2026-08|2026-09>, the chart's filters
 *
 * The biggest creatives behind one node of an advertiser's Sankey, under the
 * chart's media and month filters (lib/taxonomy-run.ts runSamples; Scott, 12
 * November 2026). Read from Databricks when a node is clicked; the page shows
 * each through creative/[id]. Behind the sign-in like every page.
 */
import { DatabricksError } from '@/lib/databricks'
import type { SampleTarget } from '@/lib/taxonomy-dbx'
import { readRun, runSamples } from '@/lib/taxonomy-run'
import { MEDIA_TYPES, MONTHS, type MediaType, type Month } from '@/lib/taxonomy-rules'

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
    const media = q.get('media')
    const month = q.get('month')
    const filter = {
      media: media && (MEDIA_TYPES as readonly string[]).includes(media) ? (media as MediaType) : null,
      month: month && (MONTHS as readonly string[]).includes(month) ? (month as Month) : null,
    }
    return Response.json(await runSamples(run, input, target, filter), { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    const message = err instanceof DatabricksError ? err.message : `Reading Databricks failed: ${(err as Error).message}`
    return Response.json({ error: message }, { status: 502 })
  }
}
