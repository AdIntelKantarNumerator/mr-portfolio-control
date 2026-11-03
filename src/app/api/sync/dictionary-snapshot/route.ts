/**
 * A copy of a ClickHouse catalog, sent from a laptop on the VPN
 * (Scott, 2 November 2026).
 *
 *   POST /api/sync/dictionary-snapshot   { env, takenAt, takenBy, catalog, columns }
 *
 * SYNC_TOKEN only. Prod ClickHouse is on a private address this site cannot
 * reach yet; scripts/dictionary-snapshot.ts reads it from a machine that can
 * and sends the result here. The Data Dictionary shows it while
 * CLICKHOUSE_<ENV>_SOURCE=snapshot, marked static with this time: names,
 * types, row counts, last writes, and the first rows of each table.
 */
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { saveSnapshot } from '@/lib/dictionary'
import { parseSnapshot } from '@/lib/dictionary-snapshot'
import { logChange } from '@/lib/portfolio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'The body must be JSON.' }, { status: 400 })
  }
  const snap = parseSnapshot(body)
  if (typeof snap === 'string') return Response.json({ error: snap }, { status: 400 })
  await saveSnapshot(snap)
  const columns = Object.values(snap.columns).reduce((n, c) => n + c.length, 0)
  const samples = snap.previews ? Object.values(snap.previews).filter((p) => !('error' in p)).length : 0
  await logChange({
    actor: snap.takenBy ?? 'Snapshot',
    kind: 'change',
    summary: `Data Dictionary: ${snap.env} copy updated (${snap.catalog.tables.length} tables, ${columns} columns, ${samples} samples, taken ${snap.takenAt.toISOString()})`,
  })
  return Response.json({ env: snap.env, tables: snap.catalog.tables.length, columns, samples, takenAt: snap.takenAt.toISOString() })
}
