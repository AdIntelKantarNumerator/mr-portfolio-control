/**
 * Which documents have already been read, and at what revision.
 *
 *   GET /api/agent/documents
 *
 * Protected by SYNC_TOKEN.
 *
 * WHY THIS IS HERE AND NOT IN A FILE ON THE AGENT'S DISK
 *
 * The agent could remember what it has read. It should not be the only thing
 * that does. Re-reading a document is cheap and harmless; FORGETTING that it
 * was read is not, because the second reading files every blocker in it again
 * as new — and duplicate blockers with different refs are exactly the failure
 * that makes a register stop being believed.
 *
 * So the record lives beside the rows it produced. A pod that loses its volume,
 * or a second agent, or a rebuild from a fresh image, all still know.
 *
 * `revision` is the document's own modified time when it was last read. An
 * edited document is new information and should be read again; the same
 * document seen in another pass is not.
 */
import { desc } from 'drizzle-orm'
import { db } from '@/db/client'
import { sourceDocuments } from '@/db/schema'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Enough to cover any sane reading window without returning years of history. */
const LIMIT = 500

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  const rows = await db
    .select()
    .from(sourceDocuments)
    .orderBy(desc(sourceDocuments.readAt))
    .limit(LIMIT)

  return Response.json({
    documents: rows.map((d) => ({
      origin: d.origin,
      externalId: d.externalId,
      title: d.title,
      revision: d.revision,
      readAt: d.readAt?.toISOString() ?? null,
      occurredAt: d.occurredAt?.toISOString() ?? null,
      url: d.url,
      // What was in this document and deliberately not filed. The answer to
      // "I put a blocker in that meeting and it never showed up".
      notRecorded: d.notRecorded,
    })),
    truncated: rows.length === LIMIT,
  })
}
