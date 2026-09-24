/**
 * Decisions and blockers, written from what was said in a document.
 *
 *   POST /api/agent/register
 *   GET  /api/agent/register?entity=Ratings&kind=blocker
 *
 * Protected by SYNC_TOKEN.
 *
 * WHAT THIS ENFORCES RATHER THAN TRUSTING THE CALLER TO
 *
 * 1. Nothing is recorded without a citation. Every entry must arrive with an
 *    event carrying a note — the sentence from the document it came from. An
 *    entry with no note is dropped here, not just at the agent. A register of
 *    blockers nobody can trace back is worse than no register, because people
 *    act on it.
 *
 * 2. Machine-written is recorded as machine-written. `authoredBy` is set to the
 *    agent's name and `reviewedBy` to null, and there is no field in the
 *    payload that lets a caller say otherwise.
 *
 * 3. A continuation must name an entry that exists AND belongs to the same
 *    piece of work. The same blocker raised in three meetings should be one
 *    live item with three events, and getting that matching wrong silently
 *    merges two different problems into one — which is the failure mode that
 *    makes the whole register untrustworthy. So a `ref` that does not resolve
 *    becomes a NEW entry and says so in the response, rather than being
 *    attached to whatever it happened to look like.
 *
 * 4. A person's name is only turned into a Person record on an unambiguous
 *    match. "Who raised this" attached to the wrong colleague is a worse
 *    answer than "Priya", and the text column exists precisely so an
 *    unmatched name is kept as what was written.
 *
 * The response says what was dropped and why. A caller that silently loses half
 * its entries learns nothing; one that gets told will get fixed.
 */
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  decisionEvents,
  decisions,
  entityThemes,
  initiatives,
  people,
  projects,
  sourceDocuments,
} from '@/db/schema'
import {
  DECISION_CATEGORY,
  DECISION_EVENT_KIND,
  DECISION_KIND,
  DECISION_STATUS,
  DOCUMENT_ORIGIN,
} from '@/lib/domain'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { matchPerson, nextRef } from '@/lib/register'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS = new Set<string>(DECISION_KIND)
const EVENT_KINDS = new Set<string>(DECISION_EVENT_KIND)
const STATUSES = new Set<string>(DECISION_STATUS)
const CATEGORIES = new Set<string>(DECISION_CATEGORY)
const ORIGINS = new Set<string>(DOCUMENT_ORIGIN)
const ENTITY_TYPES = new Set(['initiative', 'project'])

/** Resolving an entry sets its status to this; it is not the caller's choice. */
const RESOLVED_STATUS = 'decided'

interface IncomingEvent {
  kind?: string
  actor?: string | null
  note?: string | null
  occurredAt?: string | null
}

interface IncomingEntry {
  ref?: string | null
  kind?: string
  category?: string
  title?: string
  body?: string
  status?: string
  entityType?: string
  entityId?: string
  raisedBy?: string | null
  owner?: string | null
  dueBy?: string | null
  nextAction?: string | null
  contested?: boolean
  history?: string | null
  event?: IncomingEvent
}

interface IncomingTheme {
  entityType?: string
  entityId?: string
  theme?: string
  summary?: string
}

interface Incoming {
  agent?: string
  document?: {
    origin?: string
    externalId?: string
    title?: string
    url?: string | null
    occurredAt?: string | null
    revision?: string | null
  }
  entries?: IncomingEntry[]
  themes?: IncomingTheme[]
}

function when(value: string | null | undefined, fallback: Date | null = null): Date | null {
  if (!value) return fallback
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? fallback : d
}

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  let body: Incoming
  try {
    body = (await req.json()) as Incoming
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const agent = (body.agent ?? 'yaara').slice(0, 64)
  const dropped: string[] = []
  const notes: string[] = []

  // The document first: it is the citation everything else hangs off, and an
  // entry written without one would be unattributable the moment it is read.
  const doc = body.document
  if (!doc?.externalId || !doc?.title) {
    return Response.json(
      { error: 'document.externalId and document.title are required — every entry is cited to one.' },
      { status: 400 },
    )
  }

  const origin = ORIGINS.has(String(doc.origin)) ? String(doc.origin) : 'google_drive'
  const occurredAt = when(doc.occurredAt)
  const docValues = {
    origin,
    externalId: String(doc.externalId).slice(0, 300),
    title: String(doc.title).slice(0, 500),
    url: doc.url ? String(doc.url) : null,
    occurredAt,
    revision: doc.revision ? String(doc.revision) : null,
    readAt: new Date(),
    readBy: agent,
  }

  const [document] = await db
    .insert(sourceDocuments)
    .values(docValues)
    .onConflictDoUpdate({
      target: [sourceDocuments.origin, sourceDocuments.externalId],
      set: {
        title: docValues.title,
        url: docValues.url,
        occurredAt: docValues.occurredAt,
        revision: docValues.revision,
        readAt: docValues.readAt,
        readBy: docValues.readBy,
        updatedAt: new Date(),
      },
    })
    .returning()

  const roster = await db.select({ id: people.id, name: people.name }).from(people)

  // Every existing ref, so a new one cannot collide with a row this request is
  // about to leave alone.
  const existingRefs = (await db.select({ ref: decisions.ref }).from(decisions)).map((r) => r.ref)
  const claimed = new Set(existingRefs)

  const created: string[] = []
  const updated: string[] = []
  const resolved: string[] = []

  for (const raw of body.entries ?? []) {
    const kind = KINDS.has(String(raw.kind)) ? String(raw.kind) : 'decision'
    const title = String(raw.title ?? '').trim()
    const text = String(raw.body ?? '').trim()
    const entityType = String(raw.entityType ?? '')
    const entityId = String(raw.entityId ?? '')

    if (!title) {
      dropped.push('an entry with no title')
      continue
    }
    if (!ENTITY_TYPES.has(entityType) || !entityId) {
      dropped.push(`"${title.slice(0, 60)}" — no initiative or project it belongs to`)
      continue
    }

    // The citation bar. An entry with no note is a claim with no source, and a
    // register of unsourced blockers is one nobody can safely act on.
    const event = raw.event ?? {}
    const note = String(event.note ?? '').trim()
    if (!note) {
      dropped.push(`"${title.slice(0, 60)}" — no note saying what was actually said`)
      continue
    }
    const eventKind = EVENT_KINDS.has(String(event.kind)) ? String(event.kind) : 'discussed'
    const eventAt = when(event.occurredAt, occurredAt)

    // A continuation has to name a row that exists and belongs to the same work.
    // Anything else becomes its own entry and is reported, because a wrong merge
    // is invisible once it has happened.
    let existing: typeof decisions.$inferSelect | undefined
    const askedRef = String(raw.ref ?? '').trim()
    if (askedRef) {
      const [found] = await db.select().from(decisions).where(eq(decisions.ref, askedRef)).limit(1)
      if (!found) {
        notes.push(`${askedRef} does not exist, so "${title.slice(0, 50)}" was recorded as new.`)
      } else if (found.entityType !== entityType || found.entityId !== entityId) {
        notes.push(
          `${askedRef} belongs to a different piece of work, so "${title.slice(0, 50)}" was recorded as new rather than merged into it.`,
        )
      } else {
        existing = found
      }
    }

    const raisedById = matchPerson(raw.raisedBy, roster)
    const ownerId = matchPerson(raw.owner, roster)
    const resolving = eventKind === 'resolved'

    if (existing) {
      const patch: Partial<typeof decisions.$inferInsert> = {
        // The body and the story so far are what a later meeting actually
        // changes. The title stays put: renaming a live item on every mention
        // is how a register stops being recognisable to the people in it.
        body: text || existing.body,
        history: raw.history ? String(raw.history).slice(0, 4000) : existing.history,
        updatedAt: new Date(),
      }

      // An owner that was unknown and is now named is the single most useful
      // update this can make. One that is already set is left alone.
      if (!existing.ownerId && !existing.ownerText && raw.owner) {
        patch.ownerId = ownerId
        patch.ownerText = ownerId ? null : String(raw.owner).slice(0, 200)
      }
      if (!existing.raisedById && !existing.raisedByText && raw.raisedBy) {
        patch.raisedById = raisedById
        patch.raisedByText = raisedById ? null : String(raw.raisedBy).slice(0, 200)
      }
      if (raw.nextAction) patch.nextAction = String(raw.nextAction).slice(0, 500)
      if (raw.dueBy) patch.dueBy = String(raw.dueBy).slice(0, 120)

      if (resolving) {
        patch.status = RESOLVED_STATUS
        patch.resolvedAt = eventAt
        patch.resolvedAtMeeting = document.title
        patch.resolvedDocumentId = document.id
        resolved.push(existing.ref)
      } else if (STATUSES.has(String(raw.status))) {
        patch.status = String(raw.status)
      }

      await db.update(decisions).set(patch).where(eq(decisions.id, existing.id))
      await db.insert(decisionEvents).values({
        decisionId: existing.id,
        kind: eventKind,
        occurredAt: eventAt,
        meeting: document.title,
        documentId: document.id,
        url: document.url,
        actor: event.actor ? String(event.actor).slice(0, 200) : null,
        note: note.slice(0, 1000),
        recordedBy: agent,
      })
      if (!resolving) updated.push(existing.ref)
      continue
    }

    const ref = nextRef(kind, [...claimed])
    claimed.add(ref)

    const status = resolving
      ? RESOLVED_STATUS
      : STATUSES.has(String(raw.status))
        ? String(raw.status)
        : 'open'

    const [row] = await db
      .insert(decisions)
      .values({
        ref,
        kind,
        category: CATEGORIES.has(String(raw.category)) ? String(raw.category) : 'delivery',
        title: title.slice(0, 300),
        body: (text || note).slice(0, 4000),
        status,
        contested: raw.contested === true,
        ownerId,
        ownerText: ownerId ? null : raw.owner ? String(raw.owner).slice(0, 200) : null,
        raisedById,
        raisedByText: raisedById ? null : raw.raisedBy ? String(raw.raisedBy).slice(0, 200) : null,
        dueBy: raw.dueBy ? String(raw.dueBy).slice(0, 120) : null,
        nextAction: raw.nextAction ? String(raw.nextAction).slice(0, 500) : null,
        evidence: document.url ?? document.title,
        history: raw.history ? String(raw.history).slice(0, 4000) : null,
        // First seen here, so this document is where it was raised — unless it
        // arrived already resolved, in which case it is both.
        raisedAt: eventAt,
        raisedAtMeeting: document.title,
        raisedDocumentId: document.id,
        resolvedAt: resolving ? eventAt : null,
        resolvedAtMeeting: resolving ? document.title : null,
        resolvedDocumentId: resolving ? document.id : null,
        // The flag that keeps this honest. Nothing in the payload can set it.
        authoredBy: agent,
        reviewedBy: null,
        reviewedAt: null,
        entityType,
        entityId,
      })
      .returning()

    await db.insert(decisionEvents).values({
      decisionId: row.id,
      kind: resolving ? 'resolved' : 'raised',
      occurredAt: eventAt,
      meeting: document.title,
      documentId: document.id,
      url: document.url,
      actor: event.actor ? String(event.actor).slice(0, 200) : null,
      note: note.slice(0, 1000),
      recordedBy: agent,
    })

    created.push(ref)
  }

  // Themes: everything discussed that is neither a decision nor a blocker, and
  // which otherwise vanishes the moment the document leaves the window an agent
  // reads. One rolling row per theme, rewritten rather than appended to.
  let themesWritten = 0
  for (const t of body.themes ?? []) {
    const entityType = String(t.entityType ?? '')
    const entityId = String(t.entityId ?? '')
    const theme = String(t.theme ?? '').trim().slice(0, 120)
    const summary = String(t.summary ?? '').trim().slice(0, 2000)

    if (!ENTITY_TYPES.has(entityType) || !entityId || !theme || !summary) {
      if (theme) dropped.push(`theme "${theme}" — incomplete`)
      continue
    }

    await db
      .insert(entityThemes)
      .values({
        entityType,
        entityId,
        theme,
        summary,
        mentions: 1,
        firstSeenAt: occurredAt ?? new Date(),
        lastSeenAt: occurredAt ?? new Date(),
        lastMeeting: document.title,
        lastDocumentId: document.id,
        authoredBy: agent,
      })
      .onConflictDoUpdate({
        target: [entityThemes.entityType, entityThemes.entityId, entityThemes.theme],
        set: {
          summary,
          mentions: sql`${entityThemes.mentions} + 1`,
          lastSeenAt: occurredAt ?? new Date(),
          lastMeeting: document.title,
          lastDocumentId: document.id,
          updatedAt: new Date(),
        },
      })
    themesWritten++
  }

  return Response.json({
    document: { id: document.id, title: document.title },
    created,
    updated,
    resolved,
    themes: themesWritten,
    dropped,
    notes,
  })
}

/**
 * The register, with the provenance that makes it answerable.
 *
 *   GET /api/agent/register?entity=Ratings&kind=blocker&status=open
 *
 * "When was this raised, and in which meeting" is the question this endpoint
 * exists for. The dates are on every row; `events` carries the full history
 * for a single entry when one is asked about by ref.
 */
export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  const params = new URL(req.url).searchParams
  const needle = (params.get('entity') ?? '').trim().toLowerCase()
  const kind = params.get('kind')
  const status = params.get('status')
  const ref = (params.get('ref') ?? '').trim()

  const [rows, folk, inits, projs] = await Promise.all([
    db.select().from(decisions).orderBy(desc(decisions.raisedAt), decisions.ref),
    db.select({ id: people.id, name: people.name }).from(people),
    db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives),
    db.select({ id: projects.id, name: projects.name }).from(projects),
  ])

  const personName = new Map(folk.map((p) => [p.id, p.name]))
  const entityName = new Map<string, string>([
    ...inits.map((i) => [`initiative:${i.id}`, i.name] as const),
    ...projs.map((p) => [`project:${p.id}`, p.name] as const),
  ])

  const matches = rows.filter((d) => {
    if (ref) return d.ref.toLowerCase() === ref.toLowerCase()
    if (kind && d.kind !== kind) return false
    if (status && d.status !== status) return false
    if (!needle) return true
    const name = d.entityType && d.entityId ? entityName.get(`${d.entityType}:${d.entityId}`) : null
    return (name ?? '').toLowerCase().includes(needle)
  })

  // The event history is the expensive part, so it is fetched only for a
  // shortlist — a question about one blocker, or a filter that narrowed things
  // down. Asking for the whole register gets the dates without the transcript.
  const withEvents = matches.length <= 12 ? matches.map((d) => d.id) : []
  const events = withEvents.length
    ? await db
        .select()
        .from(decisionEvents)
        .where(inArray(decisionEvents.decisionId, withEvents))
        .orderBy(decisionEvents.occurredAt)
    : []

  const byDecision = new Map<string, typeof events>()
  for (const e of events) {
    const list = byDecision.get(e.decisionId) ?? []
    list.push(e)
    byDecision.set(e.decisionId, list)
  }

  const themes = needle
    ? await db.select().from(entityThemes).orderBy(desc(entityThemes.lastSeenAt))
    : []

  return Response.json({
    entries: matches.slice(0, 60).map((d) => ({
      ref: d.ref,
      kind: d.kind,
      title: d.title,
      body: d.body,
      status: d.status,
      category: d.category,
      contested: d.contested,
      entityType: d.entityType,
      entityId: d.entityId,
      entityName:
        d.entityType && d.entityId ? (entityName.get(`${d.entityType}:${d.entityId}`) ?? null) : null,
      owner: d.ownerId ? (personName.get(d.ownerId) ?? null) : (d.ownerText ?? null),
      unowned: !d.ownerId && !d.ownerText,
      raisedBy: d.raisedById ? (personName.get(d.raisedById) ?? null) : (d.raisedByText ?? null),
      raisedAt: d.raisedAt?.toISOString() ?? null,
      raisedAtMeeting: d.raisedAtMeeting,
      resolvedAt: d.resolvedAt?.toISOString() ?? null,
      resolvedAtMeeting: d.resolvedAtMeeting,
      // Days spent blocked is the number people actually want, and it is only
      // honest when both ends are known.
      openDays:
        d.raisedAt && (d.resolvedAt ?? new Date())
          ? Math.round(((d.resolvedAt ?? new Date()).getTime() - d.raisedAt.getTime()) / 86_400_000)
          : null,
      dueBy: d.dueBy,
      nextAction: d.nextAction,
      history: d.history,
      authoredBy: d.authoredBy,
      reviewed: Boolean(d.reviewedBy),
      events: (byDecision.get(d.id) ?? []).map((e) => ({
        kind: e.kind,
        occurredAt: e.occurredAt?.toISOString() ?? null,
        meeting: e.meeting,
        url: e.url,
        actor: e.actor,
        note: e.note,
      })),
    })),
    themes: themes
      .filter((t) => {
        const name = entityName.get(`${t.entityType}:${t.entityId}`)
        return (name ?? '').toLowerCase().includes(needle)
      })
      .slice(0, 20)
      .map((t) => ({
        entityName: entityName.get(`${t.entityType}:${t.entityId}`) ?? null,
        theme: t.theme,
        summary: t.summary,
        mentions: t.mentions,
        firstSeenAt: t.firstSeenAt?.toISOString() ?? null,
        lastSeenAt: t.lastSeenAt?.toISOString() ?? null,
        lastMeeting: t.lastMeeting,
      })),
  })
}
