/**
 * Manual and scheduled Linear sync.
 *
 *   POST /api/sync/linear            start a full backfill, return immediately
 *   POST /api/sync/linear?since=1    incremental, from the last successful run
 *   POST /api/sync/linear?wait=1     run it inline and return the result
 *   GET  /api/sync/linear            status of the most recent run
 *
 * Protected by SYNC_TOKEN (Bearer).
 *
 * WHY THIS RETURNS BEFORE THE WORK IS DONE
 *
 * A first backfill of a busy workspace takes minutes, and every platform that
 * might host this puts a ceiling on how long one HTTP request may last —
 * Azure App Service cuts a request off at about 230 seconds and answers 502.
 * The sync would then be killed partway through, having already written some
 * of its rows, and the caller would be told it failed with no way to know how
 * far it got.
 *
 * So the request starts the run and answers 202 with its id. The run records
 * its own outcome in sync_runs, which GET reports — the same place you would
 * look anyway, and the only place that stays accurate when the caller has
 * already hung up. Pass ?wait=1 when you genuinely want the result in the
 * response and know the run is small.
 */
import { NextResponse } from 'next/server'
import { and, desc, eq, lt } from 'drizzle-orm'
import { db } from '@/db/client'
import { syncRuns } from '@/db/schema'
import { syncLinear } from '@/lib/sources/linear'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * A run still marked `running` after this long was killed — the container
 * restarted, or a request timed out and took the work with it. Without this,
 * one interrupted run would block every future sync forever.
 */
const STALE_RUN_MS = 20 * 60 * 1000

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  if (!process.env.LINEAR_API_KEY) {
    return NextResponse.json(
      { error: 'LINEAR_API_KEY is not set on the server' },
      { status: 503 },
    )
  }

  const params = new URL(req.url).searchParams
  const incremental = params.get('since') === '1'
  const wait = params.get('wait') === '1'

  await db
    .update(syncRuns)
    .set({
      status: 'failed',
      error: 'Interrupted — the run was still marked running when a later sync started.',
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(syncRuns.system, 'linear'),
        eq(syncRuns.status, 'running'),
        lt(syncRuns.startedAt, new Date(Date.now() - STALE_RUN_MS)),
      ),
    )

  /*
   * One sync at a time.
   *
   * Two runs that both find a project unmapped will both create it, and the
   * mapping write that lands second orphans the other row. The uniqueness
   * constraint protects the mapping table but cannot protect against that, so
   * the guard belongs here. It also stops a scheduler stacking up runs on an
   * app that is simply being slow.
   */
  const [inflight] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.system, 'linear'), eq(syncRuns.status, 'running')))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1)

  if (inflight) {
    return NextResponse.json(
      {
        error: 'A sync is already running.',
        runId: inflight.id,
        startedAt: inflight.startedAt,
      },
      { status: 409 },
    )
  }

  let since: Date | null = null
  if (incremental) {
    const [last] = await db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.system, 'linear'), eq(syncRuns.status, 'success')))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1)
    since = last?.cursor ?? null
  }

  const trigger = incremental ? 'schedule' : 'manual'

  if (wait) {
    const result = await syncLinear({ since, trigger })
    return NextResponse.json(result, { status: result.status === 'failed' ? 502 : 200 })
  }

  // Deliberately not awaited. This is a long-lived Node server, not a function
  // that is frozen once it responds, so the work continues after the reply.
  void syncLinear({ since, trigger }).catch((err) => {
    console.error('[sync] linear run failed outside the request', err)
  })

  return NextResponse.json(
    {
      status: 'started',
      message: 'Sync started. Poll GET /api/sync/linear for the outcome.',
    },
    { status: 202 },
  )
}

export async function GET(req: Request) {
  // Sync history names projects and failure reasons — not catastrophic, but
  // not something an anonymous caller has any business reading.
  if (!machineCallerAuthorised(req)) return unauthorised()

  // The last ten, not just the last one. When several runs have been started
  // — by a scheduler, or by a hand that clicked twice — the most recent row
  // is rarely the one that explains what happened.
  const runs = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(10)
  return NextResponse.json({
    configured: Boolean(process.env.LINEAR_API_KEY),
    protected: Boolean(process.env.SYNC_TOKEN),
    lastRun: runs[0] ?? null,
    recentRuns: runs,
  })
}
