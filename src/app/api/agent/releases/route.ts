/**
 * The Release Calendar's feed (Scott, 11 November 2026).
 *
 *   POST /api/agent/releases  { releases: [...], complete: true, statuses: true }
 *        -> { releases: [{ linearId, identifier, announce, previousDate, previousStatus, links }], removed }
 *   POST /api/agent/releases  { announced: [{ linearId, targetDate, status }] }
 *        -> { announced: n }
 *
 * Yaara sends every Linear ticket labelled as a production release each pass
 * (yaara/src/follow/releases.ts, through src/publish/portfolio.ts). The answer
 * says which to announce in #mr-production-deployments - new, moved, or (for
 * a caller that sends `statuses: true`) its Linear status changed - and the
 * portfolio links for the message. A caller that does not ask is never told
 * "status", so one not yet redeployed cannot post it under the wrong heading. She confirms each post with
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
  let body: { releases?: unknown; complete?: unknown; statuses?: unknown; announced?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  if (Array.isArray(body.announced)) {
    const posted = body.announced
      .map((a) => a as { linearId?: unknown; targetDate?: unknown; status?: unknown })
      .filter((a) => typeof a.linearId === 'string')
      .map((a) => ({
        linearId: a.linearId as string,
        targetDate: typeof a.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.targetDate) ? a.targetDate : null,
        // Absent: an older caller; the status stored this pass is recorded. Null: the release has none.
        ...('status' in a ? { status: typeof a.status === 'string' && a.status.trim() ? a.status.trim().slice(0, 80) : null } : {}),
      }))
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
  const { outcomes, removed } = await saveReleases(list, body.complete === true && rejected.length === 0, body.statuses === true)
  return Response.json({ releases: outcomes, removed, rejected })
}
