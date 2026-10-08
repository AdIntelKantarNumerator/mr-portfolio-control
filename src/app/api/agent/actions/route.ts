/**
 * Action items read out of meeting notes.
 *
 *   GET  /api/agent/actions?status=open
 *   POST /api/agent/actions   { items: [...], source: {...} }
 *
 * Protected by SYNC_TOKEN.
 *
 * WHAT AN ACTION ITEM IS HERE
 *
 * A person, a thing, and a date. That is the whole definition, and it is why
 * this is a separate register from decisions and blockers: a blocker is
 * something in the way, a decision is something settled, and an action item is
 * somebody having said out loud that they would do a thing. The three get
 * confused constantly in notes, and merging them would mean "who owes me what"
 * has no answer.
 *
 * WHY AN ITEM WITH NO OWNER IS STILL WRITTEN
 *
 * Plenty of real commitments are made without a name attached — "we should
 * check the backfill window" — and dropping those would quietly lose the
 * unowned work, which is the work most likely to rot. They are written with
 * `ownerName` null and surface as unowned, which is a reportable state rather
 * than a gap in the record. Same for a missing date.
 *
 * WHY AN ITEM CAN HANG OFF THREE LEVELS AT ONCE
 *
 * One commitment can be relevant to a project, its initiative, and the
 * objective above it, and forcing a single home means somebody reading at the
 * wrong level never sees it. Links are a separate table for that reason, and
 * every level named has to exist — an item attached to nothing is an item that
 * appears on no page.
 *
 * WHAT IT REFUSES
 *
 * Text that is empty or a paragraph, a level outside the three, an entity that
 * does not exist, and a source with no title. It never deletes and never
 * reopens: closing an action item is a person's call, made on the page.
 */
import { readTier, vocabularyOf } from '@/lib/tier-aliases'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { actionItemEvents, actionItems, actionItemLinks, objectives, initiatives, people, projects } from '@/db/schema'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { logChange } from '@/lib/portfolio'
import { nextRef } from '@/lib/util'
import { closest, exact } from '@/lib/match-name'
import { diffChanges, encodeChanges } from '@/lib/item-changes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LEVELS = new Set(['objective', 'initiative', 'project'])
const MAX_TEXT = 300

interface IncomingLink {
  level?: string
  entityId?: string
  entityName?: string
}

interface IncomingItem {
  /**
   * An item already on record that this is the same commitment as. Set by
   * the caller, who was shown the open items; checked here, never trusted.
   */
  ref?: string | null
  /**
   * What the document did to it: mentioned it again, changed it (a new
   * owner, date or scope), or said it was done. Only a change may rewrite the
   * text, owner or date.
   */
  event?: 'mentioned' | 'changed' | 'done' | null
  /** What was said about it, in a sentence. Becomes the history entry's note. */
  note?: string | null
  text?: string
  owner?: string | null
  dueDate?: string | null
  raisedAt?: string | null
  links?: IncomingLink[]
}

interface Incoming {
  agent?: string
  source?: { kind?: string; title?: string; url?: string | null }
  items?: IncomingItem[]
}

function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Two ways of writing the same commitment.
 *
 * Notes repeat: the same action appears in the minutes and again in somebody's
 * summary, worded slightly differently. Comparing on lowercased letters and
 * digits catches "Priya to confirm the backfill window." against "Priya to
 * confirm the backfill window" without pretending to understand either.
 */
function fingerprint(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  const url = new URL(req.url)
  const status = url.searchParams.get('status')

  const [rows, links, folk] = await Promise.all([
    status
      ? db.select().from(actionItems).where(eq(actionItems.status, status)).orderBy(desc(actionItems.createdAt))
      : db.select().from(actionItems).orderBy(desc(actionItems.createdAt)),
    db.select().from(actionItemLinks),
    db.select({ id: people.id, name: people.name }).from(people),
  ])

  const nameOf = new Map(folk.map((p) => [p.id, p.name]))
  const linksFor = new Map<string, IncomingLink[]>()
  for (const l of links) {
    linksFor.set(l.actionItemId, [...(linksFor.get(l.actionItemId) ?? []), { level: l.level, entityId: l.entityId }])
  }

  return Response.json({
    actions: rows.map((a) => ({
      id: a.id,
      ref: a.ref,
      text: a.text,
      owner: a.ownerId ? (nameOf.get(a.ownerId) ?? a.ownerName) : a.ownerName,
      unowned: !a.ownerId && !a.ownerName,
      dueDate: a.dueDate ? a.dueDate.toISOString().slice(0, 10) : null,
      status: a.status,
      source: a.sourceTitle,
      sourceUrl: a.sourceUrl,
      raisedAt: a.raisedAt ? a.raisedAt.toISOString() : null,
      links: linksFor.get(a.id) ?? [],
    })),
  })
}

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  // Read once for the whole request: a caller speaks one vocabulary, not one
  // per link.
  const legacy = vocabularyOf(req.headers)

  let body: Incoming
  try {
    body = (await req.json()) as Incoming
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const agent = (body.agent ?? 'yaara').slice(0, 64)
  const sourceTitle = String(body.source?.title ?? '').trim()
  if (!sourceTitle) {
    return Response.json(
      { error: 'source.title is required — an action item with no provenance cannot be checked by anyone.' },
      { status: 400 },
    )
  }
  const sourceKind = String(body.source?.kind ?? 'document').slice(0, 32)
  const sourceUrl = body.source?.url ? String(body.source.url).slice(0, 1000) : null

  const incoming = Array.isArray(body.items) ? body.items : []
  if (incoming.length === 0) return Response.json({ written: [], skipped: [], dropped: [] })

  const [existing, folk, groups, projs, streams] = await Promise.all([
    db.select().from(actionItems),
    db.select({ id: people.id, name: people.name }).from(people),
    db.select({ id: objectives.id, name: objectives.name }).from(objectives),
    db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives),
    db.select({ id: projects.id, name: projects.name }).from(projects),
  ])

  const byLevel = { objective: groups, initiative: projs, project: streams } as const
  const realIds = new Map<string, Set<string>>(
    Object.entries(byLevel).map(([level, rows]) => [level, new Set(rows.map((r) => r.id))]),
  )

  // What is already on record, and what this batch has written so far. Both
  // matter: a set of notes repeats itself as often as two sets of notes do.
  const seen = new Map(existing.map((a) => [fingerprint(a.text), { id: a.id, ref: a.ref }]))
  const refs = existing.map((a) => a.ref ?? '').filter(Boolean)

  const written: string[] = []
  const updated: string[] = []
  const skipped: string[] = []
  const dropped: string[] = []
  const notes: string[] = []

  for (const raw of incoming) {
    const text = String(raw.text ?? '').trim()
    if (!text) {
      dropped.push('an item with no text')
      continue
    }
    if (text.length > MAX_TEXT) {
      dropped.push(`"${text.slice(0, 60)}…" — ${text.length} characters; an action item is one line, not a paragraph`)
      continue
    }

    // Resolve the links first. An item whose every link is bad is not written
    // at all: it would exist in the table and appear on no page, which is
    // worse than being told it was dropped.
    const wanted: { level: string; entityId: string }[] = []
    for (const l of raw.links ?? []) {
      // Read through the vocabulary shim, so a Yaara that has not been
      // redeployed yet can still file against the tier she means. See
      // lib/tier-aliases.ts.
      const read = readTier(l.level == null ? null : String(l.level), legacy)
      if (!read.tier || !LEVELS.has(read.tier)) {
        dropped.push(`"${text.slice(0, 40)}…" — ${read.problem ?? `"${String(l.level)}" is not a level`}`)
        continue
      }
      const level = read.tier
      const rows = byLevel[level as keyof typeof byLevel]
      let id = l.entityId ? String(l.entityId) : ''
      if (id && !realIds.get(level)!.has(id)) id = ''
      if (!id && l.entityName) {
        const found = exact(String(l.entityName), rows)
        if (found) {
          id = found.id
        } else {
          const near = closest(String(l.entityName), rows)
          dropped.push(
            near.length
              ? `"${text.slice(0, 40)}…" — no ${level} called "${l.entityName}"; did you mean ${near.map((n) => n.name).join(', or ')}?`
              : `"${text.slice(0, 40)}…" — no ${level} called "${l.entityName}"`,
          )
        }
      }
      if (id && !wanted.some((w) => w.level === level && w.entityId === id)) wanted.push({ level, entityId: id })
    }

    if (wanted.length === 0) {
      dropped.push(`"${text.slice(0, 60)}…" — nothing to attach it to`)
      continue
    }

    // A continuation: the caller says this is an item already on record.
    //
    // Before 8 October 2026 the only test was the wording, so Ashley's
    // running doc, read three times as it grew, filed the same competitor
    // follow-up three times in three phrasings, and a meeting that changed a
    // commitment's owner or date could only add a new item beside the old one.
    const askedRef = String(raw.ref ?? '').trim().toUpperCase()
    const continued = askedRef ? existing.find((a) => (a.ref ?? '').toUpperCase() === askedRef) : undefined
    if (askedRef && !continued) notes.push(`${askedRef} does not exist, so "${text.slice(0, 50)}" was recorded as new.`)
    if (continued) {
      const changing = raw.event === 'changed'
      const finishing = raw.event === 'done' && continued.status === 'open'
      const ownerAsked = raw.owner ? String(raw.owner).trim() : ''
      const person = ownerAsked ? exact(ownerAsked, folk) : null
      const nameOf = (id: string | null) => (id ? (folk.find((p) => p.id === id)?.name ?? null) : null)
      const due = asDate(raw.dueDate)

      const patch: Partial<typeof actionItems.$inferInsert> = { lastActivityAt: new Date() }
      if (changing) {
        patch.text = text
        if (ownerAsked) {
          patch.ownerId = person?.id ?? null
          patch.ownerName = person ? null : ownerAsked
        }
        if (due) patch.dueDate = due
      }
      if (finishing) {
        patch.status = 'done'
        patch.completedAt = new Date()
      }

      const changes = diffChanges(
        {
          text: continued.text,
          owner: nameOf(continued.ownerId) ?? continued.ownerName,
          dueDate: continued.dueDate?.toISOString().slice(0, 10) ?? null,
          status: continued.status,
        },
        {
          text: patch.text,
          owner: changing && ownerAsked ? (person?.name ?? ownerAsked) : undefined,
          dueDate: patch.dueDate ? (patch.dueDate as Date).toISOString().slice(0, 10) : undefined,
          status: patch.status,
        },
        ['text', 'owner', 'dueDate', 'status'],
      )

      // One more place it came up (lib/importance.ts), whatever else changed.
      await db
        .update(actionItems)
        .set({ ...patch, mentions: sql`${actionItems.mentions} + 1` })
        .where(eq(actionItems.id, continued.id))
      const have = await db.select().from(actionItemLinks).where(eq(actionItemLinks.actionItemId, continued.id))
      const fresh = wanted.filter((w) => !have.some((h) => h.level === w.level && h.entityId === w.entityId))
      if (fresh.length) await db.insert(actionItemLinks).values(fresh.map((w) => ({ actionItemId: continued.id, ...w })))

      const said = raw.note ? String(raw.note).trim().slice(0, 1000) : ''
      await db.insert(actionItemEvents).values({
        actionItemId: continued.id,
        kind: finishing ? 'done' : changes.length ? 'changed' : 'updated',
        // When it was said, not when it was recorded: the history answers
        // "when did this change", and a document read an hour after the
        // meeting would otherwise put the change in the wrong place.
        occurredAt: asDate(raw.raisedAt) ?? new Date(),
        actor: ownerAsked || null,
        // What was said, when the caller says it. "Came up again" only when
        // it does not, because a history of that line answers nothing.
        note: said || 'Came up again.',
        sourceTitle,
        sourceUrl,
        recordedBy: agent,
        changes: encodeChanges(changes),
      })
      seen.set(fingerprint(patch.text ?? continued.text), { id: continued.id, ref: continued.ref })
      updated.push(continued.ref ?? continued.id)
      continue
    }

    const print = fingerprint(text)
    const already = seen.get(print)
    if (already) {
      // The same commitment read twice. The item is left alone — its owner and
      // date may have been corrected by a person since — but any new link is
      // added, because the second reading may have placed it better.
      const have = await db.select().from(actionItemLinks).where(eq(actionItemLinks.actionItemId, already.id))
      const fresh = wanted.filter((w) => !have.some((h) => h.level === w.level && h.entityId === w.entityId))
      if (fresh.length) {
        await db.insert(actionItemLinks).values(fresh.map((w) => ({ actionItemId: already.id, ...w })))
      }
      // Said again somewhere else: that is activity, and one more mention
      // (lib/importance.ts). Owner and date stay as they are.
      await db
        .update(actionItems)
        .set({ lastActivityAt: new Date(), mentions: sql`${actionItems.mentions} + 1` })
        .where(eq(actionItems.id, already.id))
      await db.insert(actionItemEvents).values({
        actionItemId: already.id,
        kind: 'updated',
        actor: agent,
        note: (raw.note ? String(raw.note).trim().slice(0, 1000) : '') || 'Came up again.',
        sourceTitle,
        sourceUrl,
        recordedBy: agent,
      })
      skipped.push(`${already.ref ?? already.id}: already recorded${fresh.length ? `, ${fresh.length} link(s) added` : ''}`)
      continue
    }

    const ownerAsked = raw.owner ? String(raw.owner).trim() : ''
    const person = ownerAsked ? exact(ownerAsked, folk) : null

    const ref = nextRef('A', refs)
    refs.push(ref)

    const [row] = await db
      .insert(actionItems)
      .values({
        ref,
        text,
        ownerId: person?.id ?? null,
        // Kept even when it matches nobody: "Vendor to confirm" is a real
        // commitment and losing the name would make it look unowned.
        ownerName: person ? null : ownerAsked || null,
        dueDate: asDate(raw.dueDate),
        raisedAt: asDate(raw.raisedAt) ?? new Date(),
        status: 'open',
        sourceKind,
        sourceTitle,
        sourceUrl,
        authoredBy: agent,
      })
      .returning({ id: actionItems.id })

    await db.insert(actionItemLinks).values(wanted.map((w) => ({ actionItemId: row.id, ...w })))
    await db.insert(actionItemEvents).values({
      actionItemId: row.id,
      kind: 'raised',
      actor: ownerAsked || null,
      sourceTitle,
      sourceUrl,
      recordedBy: agent,
    })
    seen.set(print, { id: row.id, ref })
    written.push(ref)

    await logChange({
      actor: agent,
      kind: 'note',
      summary: `${ref}: action item recorded — ${text.slice(0, 80)}`,
      detail: [
        `owner: ${person?.name ?? (ownerAsked || 'nobody named')}`,
        `due: ${raw.dueDate ?? 'no date given'}`,
        `from: ${sourceTitle}`,
      ].join('\n'),
      entityType: wanted[0].level,
      entityId: wanted[0].entityId,
    })
  }

  return Response.json({ written, updated, skipped, dropped, notes })
}

/**
 * Close an action item, or reopen one.
 *
 *   PATCH /api/agent/actions   { id | ref, status, note }
 *
 * Narrower than POST on purpose. An agent may record that a note said a thing
 * was done, because that is an observation; it may not drop an item, because
 * abandoning somebody's commitment is a decision with a person's name on it.
 */
export async function PATCH(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  let body: { agent?: string; id?: string; ref?: string; status?: string; note?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const agent = (body.agent ?? 'yaara').slice(0, 64)
  const status = String(body.status ?? '')
  if (status !== 'done' && status !== 'open') {
    return Response.json(
      { error: 'status must be "done" or "open". Dropping an action item is a person\'s call, made on the page.' },
      { status: 400 },
    )
  }

  const key = String(body.id ?? body.ref ?? '')
  if (!key) return Response.json({ error: 'Give an id or a ref.' }, { status: 400 })

  const [row] = await db
    .select()
    .from(actionItems)
    .where(body.id ? eq(actionItems.id, key) : eq(actionItems.ref, key))
    .limit(1)
  if (!row) return Response.json({ error: `No action item ${key}.` }, { status: 404 })
  if (row.status === status) return Response.json({ ref: row.ref, changed: false })

  await db
    .update(actionItems)
    .set({
      status,
      completedAt: status === 'done' ? new Date() : null,
      updatedAt: new Date(),
      lastActivityAt: new Date(),
    })
    .where(eq(actionItems.id, row.id))
  await db.insert(actionItemEvents).values({
    actionItemId: row.id,
    kind: status === 'done' ? 'done' : 'reopened',
    actor: agent,
    note: body.note ? String(body.note).slice(0, 1000) : null,
    recordedBy: agent,
  })

  const [firstLink] = await db
    .select()
    .from(actionItemLinks)
    .where(eq(actionItemLinks.actionItemId, row.id))
    .limit(1)

  await logChange({
    actor: agent,
    kind: 'note',
    summary: `${row.ref ?? row.id}: action item ${status === 'done' ? 'closed' : 'reopened'}`,
    detail: body.note ? String(body.note).slice(0, 1000) : null,
    entityType: firstLink?.level ?? null,
    entityId: firstLink?.entityId ?? null,
  })

  return Response.json({ ref: row.ref, changed: true })
}
