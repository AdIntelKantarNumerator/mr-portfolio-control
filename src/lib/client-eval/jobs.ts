/**
 * Background jobs for Client Evaluation (Scott, 20 November 2026): the Impact
 * Deck and the client and user export take minutes, so they run in the
 * background of the server process that was asked, and write their progress
 * and finished file to ce_jobs. The page (or the deck's own window) polls the
 * job and downloads the file when it is done. Jobs older than a day are
 * deleted when the next one starts.
 *
 * The app runs on one B1 instance: one core, 1.75 GB. A job must never hold
 * the server (Scott, 20 November 2026: an export made the app unresponsive),
 * so files are written in 2 MB pieces as they are produced (ce_job_chunks)
 * and streamed back on download, and the work itself pauses often (export.ts).
 */
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import { db } from '@/db/client'
import { ceJobChunks, ceJobs } from '@/db/schema'

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

/** Where a job writes its file: write as it comes, drain now and then to store the full pieces. */
export interface JobOutput {
  write(chunk: Buffer): void
  /** Store every full 2 MB piece written so far. */
  drain(): Promise<void>
}

/** A job that has said nothing for this long died with its process. */
const STALE_MS = 15 * 60_000
const PIECE = 2 * 1024 * 1024

/** Start a job: the row is written, the work runs in the background, and the id comes back at once. */
export async function startJob(
  kind: JobKind,
  title: string,
  params: Record<string, unknown>,
  by: string | null,
  work: (progress: JobProgress, out: JobOutput) => Promise<{ fileName: string; fileType: string }>,
): Promise<string> {
  const old = await db
    .select({ id: ceJobs.id })
    .from(ceJobs)
    .where(lt(ceJobs.createdAt, new Date(Date.now() - 24 * 3600_000)))
    .catch(() => [])
  if (old.length) {
    const ids = old.map((o) => o.id)
    await db.delete(ceJobChunks).where(inArray(ceJobChunks.jobId, ids)).catch(() => {})
    await db.delete(ceJobs).where(inArray(ceJobs.id, ids)).catch(() => {})
  }
  const id = randomUUID()
  await db.insert(ceJobs).values({ id, kind, title, params, status: 'running', step: 'Starting', createdBy: by })
  let last = 0
  const progress: JobProgress = async (step, done = 0, total = 0) => {
    const now = Date.now()
    if (now - last < 700) return
    last = now
    await db.update(ceJobs).set({ step, done, total, updatedAt: new Date() }).where(eq(ceJobs.id, id))
  }

  let pending: Buffer[] = []
  let size = 0
  let seq = 0
  const store = async (piece: Buffer) => {
    await db.insert(ceJobChunks).values({ jobId: id, seq: seq++, data: piece })
  }
  const out: JobOutput = {
    write(chunk) {
      pending.push(chunk)
      size += chunk.length
    },
    async drain() {
      while (size >= PIECE) {
        const all = Buffer.concat(pending)
        await store(all.subarray(0, PIECE))
        const rest = all.subarray(PIECE)
        pending = rest.length ? [Buffer.from(rest)] : []
        size = rest.length
      }
    },
  }

  void (async () => {
    try {
      const meta = await work(progress, out)
      await out.drain()
      if (size) await store(Buffer.concat(pending))
      pending = []
      await db.update(ceJobs).set({ status: 'done', step: 'Done', fileName: meta.fileName, fileType: meta.fileType, updatedAt: new Date() }).where(eq(ceJobs.id, id))
    } catch (err) {
      console.error(`[client-eval] ${kind} job failed`, err)
      const e = ((err as { cause?: Error })?.cause ?? err) as Error
      await db
        .update(ceJobs)
        .set({ status: 'failed', error: String(e?.message ?? e).slice(0, 500), updatedAt: new Date() })
        .where(eq(ceJobs.id, id))
        .catch(() => {})
      await db.delete(ceJobChunks).where(eq(ceJobChunks.jobId, id)).catch(() => {})
    }
  })()
  return id
}

/** A job of this kind still running (and not stale): a second export rejoins it rather than start another. */
export async function runningJob(kind: JobKind): Promise<string | null> {
  const rows = await db.select({ id: ceJobs.id, updatedAt: ceJobs.updatedAt }).from(ceJobs).where(and(eq(ceJobs.kind, kind), eq(ceJobs.status, 'running')))
  const live = rows.filter((r) => Date.now() - r.updatedAt.getTime() < STALE_MS).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
  return live?.id ?? null
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

/** A finished job's file, as a stream of its pieces read one at a time. */
export async function readJobFile(id: string): Promise<{ stream: ReadableStream<Uint8Array>; fileName: string; fileType: string } | null> {
  const [r] = await db.select({ status: ceJobs.status, fileName: ceJobs.fileName, fileType: ceJobs.fileType, file: ceJobs.file }).from(ceJobs).where(eq(ceJobs.id, id)).limit(1)
  if (!r || r.status !== 'done' || !r.fileName) return null
  const fileType = r.fileType ?? 'application/octet-stream'
  // Jobs from before the pieces (drizzle/0053) kept the file whole.
  if (r.file)
    return {
      fileName: r.fileName,
      fileType,
      stream: new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(r.file!))
          c.close()
        },
      }),
    }
  const seqs = (await db.select({ seq: ceJobChunks.seq }).from(ceJobChunks).where(eq(ceJobChunks.jobId, id)).orderBy(asc(ceJobChunks.seq))).map((s) => s.seq)
  let i = 0
  return {
    fileName: r.fileName,
    fileType,
    stream: new ReadableStream({
      async pull(c) {
        if (i >= seqs.length) return c.close()
        const [piece] = await db.select({ data: ceJobChunks.data }).from(ceJobChunks).where(and(eq(ceJobChunks.jobId, id), eq(ceJobChunks.seq, seqs[i++]!))).limit(1)
        if (piece) c.enqueue(new Uint8Array(piece.data))
      },
    }),
  }
}
