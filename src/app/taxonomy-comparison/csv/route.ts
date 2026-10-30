/**
 * GET /taxonomy-comparison/csv?run=<id>
 *
 * A finished comparison as CSV (lib/taxonomy-rules.ts toCsv). Behind the
 * sign-in like every page.
 */
import { toCsv } from '@/lib/taxonomy-rules'
import { readRun } from '@/lib/taxonomy-run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('run') ?? ''
  const run = id ? await readRun(id) : null
  if (!run?.result) return new Response('No finished comparison with that id.', { status: 404 })
  const day = run.createdAt.slice(0, 10)
  return new Response(toCsv(run.result.from, run.result.advertisers), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="taxonomy-${run.result.from.toLowerCase()}-to-gpc-${day}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
