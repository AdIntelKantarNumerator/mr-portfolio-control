/**
 * The client and user export, kept ready (Scott, 20 November 2026: "build it
 * after each refresh"). Building it takes several minutes on the B1 plan, and
 * its data changes only when a snapshot is refreshed or someone merges or
 * splits clients. So it is built once per change of the data and kept; the
 * button downloads the kept one at once.
 *
 * The data's version is the latest of the snapshots' load times and the newest
 * merge or split. An export job records the version it was built from
 * (params.basis). ensureExport, called after every refresh in the app and
 * whenever the page asks (which catches Classic's laptop refreshes), starts a
 * build when the kept export is behind and none is running.
 */
import { and, desc, eq, max } from 'drizzle-orm'
import { db } from '@/db/client'
import { ceJobs, ceOverrides, ceSources } from '@/db/schema'
import { buildExport } from './export'
import { runningJob, startJob } from './jobs'

/** The data's version: the latest snapshot load or merge/split, as an ISO time. */
export async function dataBasis(): Promise<string> {
  const [s] = await db.select({ t: max(ceSources.loadedAt) }).from(ceSources)
  const [o] = await db.select({ t: max(ceOverrides.at) }).from(ceOverrides)
  const times = [s?.t, o?.t].filter((t): t is Date => t instanceof Date).map((t) => t.getTime())
  return new Date(times.length ? Math.max(...times) : 0).toISOString()
}

export interface ExportState {
  /** The kept export, when there is one: current or not. */
  ready: { id: string; fileName: string; builtAt: string; current: boolean } | null
  /** A build in progress. */
  building: string | null
}

/** The kept export, and a build started if it is behind the data and none is running. */
export async function ensureExport(by: string | null): Promise<ExportState> {
  const basis = await dataBasis()
  const done = await db
    .select({ id: ceJobs.id, fileName: ceJobs.fileName, params: ceJobs.params, updatedAt: ceJobs.updatedAt })
    .from(ceJobs)
    .where(eqKind('export', 'done'))
    .orderBy(desc(ceJobs.updatedAt))
    .limit(1)
  const last = done[0]
  const lastBasis = (last?.params as { basis?: string } | null)?.basis ?? ''
  const current = !!last && lastBasis >= basis
  let building = await runningJob('export')
  if (!current && !building) building = await startExport(basis, by)
  return {
    ready: last?.fileName ? { id: last.id, fileName: last.fileName, builtAt: last.updatedAt.toISOString(), current } : null,
    building,
  }
}

function eqKind(kind: string, status: string) {
  return and(eq(ceJobs.kind, kind), eq(ceJobs.status, status))
}

async function startExport(basis: string, by: string | null): Promise<string> {
  const day = new Date().toISOString().slice(0, 10)
  return startJob('export', 'Clients and users export', { basis }, by, async (progress, out) => {
    await buildExport(db, progress, out)
    return { fileName: `Client Evaluation - clients and users ${day}.xlsx`, fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  })
}

