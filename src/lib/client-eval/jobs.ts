/**
 * Background jobs for Client Evaluation (Scott, 20 November 2026): the Impact
 * Deck and the client and user export take minutes, so they run in the
 * background of the server process that was asked, and write their progress
 * and finished file to ce_jobs. The page (or the deck's own window) polls the
 * job and downloads the file when it is done. Jobs older than a day are
 * deleted when the next one starts.
 */
import { randomUUID } from 'node:crypto'
import { eq, lt } from 'drizzle-orm'
import { db } from '@/db/client'
import { ceJobs } from '@/db/schema'

export type JobKind = 'deck' | 'export'

export interface JobView {
  id: string
  kind: JobKind
  title: string
  status: 'running' | 'done' | 'failed'
  step: string | null
  done: number
  total: number
  error: string | null
  fileName: string | null
}

export type JobProgress = (step: string, done?: number, total?: number) => Promise<void>

/** A job that has said nothing for this long died with its process. */
const STALE_MS = 15 * 60_000

/** Start a job: the row is written, the work runs in the background, and the id comes back at once. */
export async function startJob(
  kind: JobKind,
  title: string,
  params: Record<string, unknown>,
  by: string | null,
  work: (progress: JobProgress) => Promise<{ file: Buffer; fileName: string; fileType: string }>,
): Promise<string> {
  await db.delete(ceJobs).where(lt(ceJobs.createdAt, new Date(Date.now() - 24 * 3600_000))).catch(() => {})
  const id = randomUUID()
  await db.insert(ceJobs).values({ id, kind, title, params, status: 'running', step: 'Starting', createdBy: by })
  let last = 0
  const progress: JobProgress = async (step, done = 0, total = 0) => {
    const now = Date.now()
    if (now - last < 700) return
    last = now
    await db.update(ceJobs).set({ step, done, total, updatedAt: new Date() }).where(eq(ceJobs.id, id))
  }
  void (async () => {
    try {
      const out = await work(progress)
      await db.update(ceJobs).set({ status: 'done', step: 'Done', file: out.file, fileName: out.fileName, fileType: out.fileType, updatedAt: new Date() }).where(eq(ceJobs.id, id))
    } catch (err) {
      console.error(`[client-eval] ${kind} job failed`, err)
      const e = ((err as { cause?: Error })?.cause ?? err) as Error
      await db
        .update(ceJobs)
        .set({ status: 'failed', error: String(e?.message ?? e).slice(0, 500), updatedAt: new Date() })
        .where(eq(ceJobs.id, id))
        .catch(() => {})
    }
  })()
  return id
}

export async function readJob(id: string): Promise<JobView | null> {
  const [r] = await db
    .select({ id: ceJobs.id, kind: ceJobs.kind, title: ceJobs.title, status: ceJobs.status, step: ceJobs.step, done: ceJobs.done, total: ceJobs.total, error: ceJobs.error, fileName: ceJobs.fileName, updatedAt: ceJobs.updatedAt })
    .from(ceJobs)
    .where(eq(ceJobs.id, id))
    .limit(1)
  if (!r) return null
  const stale = r.status === 'running' && Date.now() - r.updatedAt.getTime() > STALE_MS
  return {
    id: r.id,
    kind: r.kind as JobKind,
    title: r.title,
    status: stale ? 'failed' : (r.status as JobView['status']),
    step: r.step,
    done: r.done,
    total: r.total,
    error: stale ? 'The job stopped without finishing. Please try again.' : r.error,
    fileName: r.fileName,
  }
}

export async function readJobFile(id: string): Promise<{ file: Buffer; fileName: string; fileType: string } | null> {
  const [r] = await db.select({ file: ceJobs.file, fileName: ceJobs.fileName, fileType: ceJobs.fileType }).from(ceJobs).where(eq(ceJobs.id, id)).limit(1)
  if (!r?.file || !r.fileName) return null
  return { file: r.file, fileName: r.fileName, fileType: r.fileType ?? 'application/octet-stream' }
}
