/**
 * The rest of the portfolio, read-only, one area at a time.
 *
 *   GET /api/agent/lookup?area=<area>&q=<words>
 *   GET /api/agent/lookup            the list of areas and what each holds
 *
 * Protected by SYNC_TOKEN. Wider than /api/agent/portfolio on purpose, for
 * the chat; lib/agent-lookup.ts says why and where it stops.
 */
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { AREA_HELP, LOOKUP_AREAS, lookup, readArea } from '@/lib/agent-lookup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const params = new URL(req.url).searchParams
  const raw = params.get('area')
  if (!raw) return Response.json({ areas: LOOKUP_AREAS.map((a) => ({ area: a, holds: AREA_HELP[a] })) })
  const area = readArea(raw)
  if (!area) return Response.json({ error: `No area "${raw}". Areas: ${LOOKUP_AREAS.join(', ')}.` }, { status: 400 })
  return Response.json(await lookup(area, params.get('q')))
}
