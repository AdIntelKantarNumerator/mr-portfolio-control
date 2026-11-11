/**
 * The Release Calendar's feed (Scott, 11 November 2026).
 *
 *   POST /api/agent/releases  { releases: [...], complete: true }
 *        -> { releases: [{ linearId, identifier, announce, previousDate, links }], removed }
 *   POST /api/agent/releases  { announced: [{ linearId, targetDate }] }
 *        -> { announced: n }
 *
 * Yaara sends every Linear ticket labelled as a production release each pass
 * (yaara/src/follow/releases.ts, through src/publish/portfolio.ts). The answer
 * says which to announce in #mr-production-deployments - new, or moved - and
 * the portfolio links for the message. She confirms each post with
 * `announced`; one that failed is still owed and comes back next pass.
 *
 * A change here is a change to both repos (../CLAUDE.md). Protected by the
 * machine token, like every agent route.
 */
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { parseRelease, type IncomingRelease } from '@/lib/release-rules'
import { markAnnounced, saveReleases } from '@/lib/releases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  let body: { releases?: unknown; complete?: unknown; announced?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  if (Array.isArray(body.announced)) {
    const posted = body.announced
      .map((a) => a as { linearId?: unknown; targetDate?: unknown })
      .filter((a) => typeof a.linearId === 'string')
      .map((a) => ({ linearId: a.linearId as string, targetDate: typeof a.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.targetDate) ? a.targetDate : null }))
    return Response.json({ announced: await markAnnounced(posted) })
  }

  if (!Array.isArray(body.releases)) return Response.json({ error: 'Send "releases" (an array) or "announced".' }, { status: 400 })
  const list: IncomingRelease[] = []
  const rejected: string[] = []
  for (const r of body.releases) {
    const parsed = parseRelease(r)
    if (typeof parsed === 'string') rejected.push(parsed)
    else list.push(parsed)
  }
  // A list with any refused row is not the complete list, so nothing is
  // taken off the calendar on its say-so.
  const { outcomes, removed } = await saveReleases(list, body.complete === true && rejected.length === 0)
  return Response.json({ releases: outcomes, removed, rejected })
}
