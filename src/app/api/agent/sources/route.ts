/**
 * Which things out in the world belong to which piece of work.
 *
 *   GET /api/agent/sources
 *
 * Protected by SYNC_TOKEN.
 *
 * WHY THIS EXISTS
 *
 * Linear is easy: the sync records the external id, so an update can be
 * attached to a project with certainty. Everything else was being attached by
 * looking for the project's name in the text — which is a guess presented as a
 * fact, and which silently fails for every project whose name nobody writes
 * out.
 *
 * Meanwhile the repos to read at all lived in the agent's own configuration,
 * which meant the same question — what belongs to this project — was answered
 * in two places, and the two could disagree with nobody noticing.
 *
 * This is the one answer: a person attached it, their name is on it, and the
 * agent reads the list rather than being told it separately.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { conversationSources, initiatives, projects } from '@/db/schema'
import { isRepoKind, SOURCE_KIND } from '@/lib/domain'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  const [rows, inits, projs] = await Promise.all([
    db.select().from(conversationSources).where(eq(conversationSources.active, true)),
    db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives),
    db.select({ id: projects.id, name: projects.name }).from(projects),
  ])

  const entityName = new Map<string, string>([
    ...inits.map((i) => [`initiative:${i.id}`, i.name] as const),
    ...projs.map((p) => [`project:${p.id}`, p.name] as const),
  ])

  return Response.json({
    sources: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      isRepo: isRepoKind(r.kind),
      entityType: r.entityType,
      entityId: r.entityId,
      entityName: entityName.get(`${r.entityType}:${r.entityId}`) ?? null,
      label: r.label,
      /** owner/name for a repo, C… for a Slack channel — whatever identifies it. */
      externalId: r.externalId,
      url: r.url,
      /**
       * Reading is opt-in per source and off until someone turns it on. The
       * agent must honour this: an attached source is a statement about what
       * belongs together, not permission to read it.
       */
      ingestEnabled: r.ingestEnabled,
      addedBy: r.addedBy,
    })),
  })
}

/**
 * The agent recording that something belongs to a piece of work.
 *
 *   POST /api/agent/sources   { kind, entityType, entityId, label, externalId, url, notes }
 *
 * WHY SHE MAY DO THIS AT ALL
 *
 * Finding that `org/clickhouse-serving` is the Ratings project is tedious, and
 * she is well placed to notice it — she reads both. Making a person do that
 * lookup by hand for every repo is how the links never get made, and unmade
 * links are why evidence falls back to guessing at names.
 *
 * WHY IT IS STILL NOT THE SAME AS A PERSON DOING IT
 *
 * A declared link is exclusive: it attaches evidence to one thing and suppresses
 * the name matching that would have attached it elsewhere. That is exactly the
 * authority that must not be self-granted, or "declared" quietly degrades into
 * "the model guessed, and wrote it down where it looks official".
 *
 * So two things are forced here, whatever the caller sends:
 *
 *   ingest_enabled = false   she may say what belongs together; she may not
 *                            decide she is allowed to read it. That toggle is
 *                            in the UI, it records who flipped it, and it is
 *                            the human half of this.
 *   added_by       = agent   the screen shows who attached every source, so a
 *                            machine-made link is visibly a machine-made link.
 */

interface IncomingSource {
  kind?: string
  entityType?: string
  entityId?: string
  label?: string
  externalId?: string | null
  url?: string | null
  notes?: string | null
  agent?: string
}

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  let body: IncomingSource
  try {
    body = (await req.json()) as IncomingSource
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const kind = String(body.kind ?? '')
  const entityType = String(body.entityType ?? '')
  const entityId = String(body.entityId ?? '')
  const label = String(body.label ?? '').trim()

  if (!(SOURCE_KIND as readonly string[]).includes(kind)) {
    return Response.json(
      { error: `kind must be one of ${SOURCE_KIND.join(', ')}.` },
      { status: 400 },
    )
  }
  if (entityType !== 'initiative' && entityType !== 'project') {
    return Response.json({ error: 'entityType must be initiative or project.' }, { status: 400 })
  }
  if (!label) return Response.json({ error: 'label is required.' }, { status: 400 })

  // The entity has to exist. Otherwise a mistyped id creates a link to nothing,
  // which is invisible on every screen and silently suppresses name matching.
  const exists =
    entityType === 'initiative'
      ? (await db.select({ id: initiatives.id }).from(initiatives).where(eq(initiatives.id, entityId))).length > 0
      : (await db.select({ id: projects.id }).from(projects).where(eq(projects.id, entityId))).length > 0
  if (!exists) return Response.json({ error: `No ${entityType} with id ${entityId}.` }, { status: 404 })

  const externalId = body.externalId ? String(body.externalId).trim() : null

  // Same source twice is not an error; it is the agent noticing the same thing
  // again. Report the existing row rather than creating a duplicate.
  if (externalId) {
    const [already] = await db
      .select()
      .from(conversationSources)
      .where(and(eq(conversationSources.kind, kind), eq(conversationSources.externalId, externalId)))
      .limit(1)
    if (already) {
      return Response.json({ source: already, created: false, note: 'Already attached.' })
    }
  }

  const [row] = await db
    .insert(conversationSources)
    .values({
      kind,
      entityType,
      entityId,
      label: label.slice(0, 200),
      externalId,
      url: body.url ? String(body.url).slice(0, 500) : null,
      notes: body.notes ? String(body.notes).slice(0, 500) : null,
      // Forced. See the note above.
      ingestEnabled: false,
      addedBy: `${(body.agent ?? 'yaara').slice(0, 32)} (agent)`,
    })
    .returning()

  return Response.json({
    source: row,
    created: true,
    note: 'Attached, but not being read: someone has to turn ingestion on in the app.',
  })
}

/**
 * Remove a link the agent made, or any other.
 *
 *   DELETE /api/agent/sources?id=...
 *
 * Detaching is not destructive — the transcripts and observations it produced
 * stay — so this needs no ceremony beyond the token.
 */
export async function DELETE(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id is required.' }, { status: 400 })

  const [row] = await db
    .delete(conversationSources)
    .where(eq(conversationSources.id, id))
    .returning()

  if (!row) return Response.json({ error: `No source ${id}.` }, { status: 404 })
  return Response.json({ detached: row.label })
}
