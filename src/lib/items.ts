/**
 * Blockers, decisions and action items as one list of "items", for the work in
 * progress dashboards, the home page counts, and Yaara's follow-up.
 *
 * Blockers and decisions live in `decisions`, action items in `action_items`,
 * and they have always been read separately. Following them up is the same
 * job for all three: is it still open, is anybody moving it, how much does it
 * matter, who should be asked. So this reads both tables into one shape, and
 * applyItemUpdate is the one way anything changes one, from the app or from
 * Yaara, so every change leaves the same trail: an event on the item, a line
 * in Activity, and a fresh last-activity date when it counts as activity.
 *
 * The rules are elsewhere and pure: importance.ts (the score), item-activity.ts
 * (inactive, health).
 */
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  actionItemEvents,
  actionItemLinks,
  actionItems,
  decisionEvents,
  decisions,
  initiatives,
  objectives,
  people,
  projects,
} from '@/db/schema'
import { logChange } from './portfolio'
import { matchPerson } from './register'
import { ADJUST_STEP, bandOf, isFactor, parseFactors, parseReasons, scoreOf, type Band, type FactorKey, type ItemKind, type Reason } from './importance'
import { isInactive } from './item-activity'
import { idsAtOrBelow, type Tier } from './hierarchy'

export interface Item {
  kind: ItemKind
  id: string
  ref: string
  title: string
  body: string | null
  /** As stored: open | watch | decided | dropped for the register, open | done | dropped for actions. */
  status: string
  open: boolean
  inactive: boolean
  ownerName: string | null
  /** Where it sits. A blocker or decision has one; an action may have several. */
  places: Array<{ level: Tier; id: string; name: string }>
  /** Whoever owns the work it sits on, for an item with no owner of its own. */
  placeOwner: string | null
  createdAt: Date
  lastActivityAt: Date
  closedAt: Date | null
  dueDate: Date | null
  score: number | null
  band: Band | null
  factors: FactorKey[]
  reasons: Reason[]
  adjust: number
  mentions: number
  nudgedAt: Date | null
  mergedInto: string | null
  sourceTitle: string | null
  sourceUrl: string | null
  href: string
}

const REGISTER_CLOSED = new Set(['decided', 'dropped'])

/**
 * Every item, or those of some kinds. Closed items only when asked for, and
 * then only those closed since a date: there are more of them every week and
 * nothing here needs the old ones.
 */
export async function loadItems(opts: { kinds?: ItemKind[]; closedSince?: Date | null; now?: Date } = {}): Promise<Item[]> {
  const kinds = new Set(opts.kinds ?? ['blocker', 'decision', 'action'])
  const now = opts.now ?? new Date()

  const [folk, objs, inits, projs] = await Promise.all([
    db.select({ id: people.id, name: people.name }).from(people),
    db.select({ id: objectives.id, name: objectives.name, ownerId: objectives.ownerId }).from(objectives),
    db.select({ id: initiatives.id, name: initiatives.name, ownerId: initiatives.ownerId, objectiveId: initiatives.objectiveId }).from(initiatives),
    db.select({ id: projects.id, name: projects.name, leadId: projects.leadId, initiativeId: projects.initiativeId }).from(projects),
  ])
  const nameOf = new Map(folk.map((p) => [p.id, p.name]))
  const place = new Map<string, { level: Tier; name: string; ownerId: string | null; parent: string | null }>()
  for (const o of objs) place.set(o.id, { level: 'objective', name: o.name, ownerId: o.ownerId, parent: null })
  for (const i of inits) place.set(i.id, { level: 'initiative', name: i.name, ownerId: i.ownerId, parent: i.objectiveId })
  for (const p of projs) place.set(p.id, { level: 'project', name: p.name, ownerId: p.leadId, parent: p.initiativeId })

  /** The nearest owner at or above a place: the project's lead, else its initiative's owner, else its objective's. */
  const ownerAbove = (id: string | null | undefined): string | null => {
    let at = id ? place.get(id) : undefined
    let cursor = id ?? null
    for (let i = 0; at && i < 3; i++) {
      if (at.ownerId && nameOf.get(at.ownerId)) return nameOf.get(at.ownerId)!
      cursor = at.parent
      at = cursor ? place.get(cursor) : undefined
    }
    return null
  }

  const out: Item[] = []

  if (kinds.has('blocker') || kinds.has('decision')) {
    const rows = await db.select().from(decisions)
    for (const r of rows) {
      const kind = r.kind === 'blocker' ? 'blocker' : 'decision'
      if (!kinds.has(kind)) continue
      const open = !REGISTER_CLOSED.has(r.status)
      if (!open && !(opts.closedSince && r.resolvedAt && r.resolvedAt >= opts.closedSince)) continue
      const at = r.entityId ? place.get(r.entityId) : undefined
      out.push({
        kind,
        id: r.id,
        ref: r.ref,
        title: r.title,
        body: r.body,
        status: r.status,
        open,
        inactive: open && isInactive(r.lastActivityAt, now),
        ownerName: (r.ownerId && nameOf.get(r.ownerId)) || r.ownerText || null,
        places: at && r.entityId ? [{ level: at.level, id: r.entityId, name: at.name }] : [],
        placeOwner: ownerAbove(r.entityId),
        createdAt: r.raisedAt ?? r.createdAt,
        lastActivityAt: r.lastActivityAt,
        closedAt: r.resolvedAt,
        dueDate: null,
        score: r.importanceScore,
        band: bandOf(r.importanceScore),
        factors: parseFactors(r.importanceFactors),
        reasons: parseReasons(r.importanceReasons),
        adjust: r.importanceAdjust,
        mentions: r.mentions,
        nudgedAt: r.nudgedAt,
        mergedInto: r.mergedInto,
        sourceTitle: r.raisedAtMeeting,
        sourceUrl: null,
        href: `/${kind === 'blocker' ? 'blockers' : 'decisions'}#${r.ref}`,
      })
    }
  }

  if (kinds.has('action')) {
    const rows = await db.select().from(actionItems)
    const links = await db.select().from(actionItemLinks)
    const linksOf = new Map<string, Array<{ level: string; entityId: string }>>()
    for (const l of links) linksOf.set(l.actionItemId, [...(linksOf.get(l.actionItemId) ?? []), l])
    for (const r of rows) {
      const open = r.status === 'open'
      if (!open && !(opts.closedSince && r.completedAt && r.completedAt >= opts.closedSince)) continue
      const places = (linksOf.get(r.id) ?? [])
        .map((l) => ({ l, at: place.get(l.entityId) }))
        .filter((x) => x.at)
        .map((x) => ({ level: x.at!.level, id: x.l.entityId, name: x.at!.name }))
      // The most specific place's owner: a project's lead before an initiative's owner.
      const order = { project: 0, initiative: 1, objective: 2 } as const
      const nearest = [...places].sort((a, b) => order[a.level] - order[b.level])[0]
      out.push({
        kind: 'action',
        id: r.id,
        ref: r.ref ?? r.id.slice(0, 8),
        title: r.text,
        body: null,
        status: r.status,
        open,
        inactive: open && isInactive(r.lastActivityAt, now),
        ownerName: (r.ownerId && nameOf.get(r.ownerId)) || r.ownerName || null,
        places,
        placeOwner: ownerAbove(nearest?.id),
        createdAt: r.raisedAt ?? r.createdAt,
        lastActivityAt: r.lastActivityAt,
        closedAt: r.completedAt,
        dueDate: r.dueDate,
        score: r.importanceScore,
        band: bandOf(r.importanceScore),
        factors: parseFactors(r.importanceFactors),
        reasons: parseReasons(r.importanceReasons),
        adjust: r.importanceAdjust,
        mentions: r.mentions,
        nudgedAt: r.nudgedAt,
        mergedInto: r.mergedInto,
        sourceTitle: r.sourceTitle,
        sourceUrl: r.sourceUrl,
        href: `/actions#${r.ref ?? r.id}`,
      })
    }
  }

  return out
}

/** Items sitting on any of these ids. */
export function inScope(items: readonly Item[], ids: ReadonlySet<string> | null): Item[] {
  if (!ids) return [...items]
  return items.filter((i) => i.places.some((p) => ids.has(p.id)))
}

/** Highest score first; unscored after scored; then oldest first. */
export function byImportance(a: Item, b: Item): number {
  const sa = a.score ?? -1
  const sb = b.score ?? -1
  if (sa !== sb) return sb - sa
  return a.createdAt.getTime() - b.createdAt.getTime()
}

// ---------------------------------------------------------------- changes

export type ItemAction =
  | 'resolve' // blocker or decision settled; action done
  | 'drop' // withdrawn
  | 'reopen'
  | 'progress' // something happened; note says what
  | 'duplicate' // the same as duplicateOf, which survives
  | 'owner'
  | 'score' // Yaara's factors
  | 'adjust' // a person's +/- (delta)
  | 'nudged' // its owner was reminded; not activity

export interface ItemUpdate {
  ref: string
  action: ItemAction
  note?: string | null
  /** Who did it, as a person reads it: "Scott Bernberg", "Yaara". */
  actor: string
  source?: { title?: string | null; url?: string | null } | null
  duplicateOf?: string | null
  owner?: string | null
  factors?: string[] | null
  reasons?: Reason[] | null
  /** For adjust: +1 more important, -1 less. */
  delta?: number | null
  occurredAt?: Date | null
}

export interface UpdateResult {
  ref: string
  ok: boolean
  error?: string
  status?: string
  score?: number | null
}

interface Found {
  kind: ItemKind
  row: typeof decisions.$inferSelect | typeof actionItems.$inferSelect
}

async function findByRef(ref: string): Promise<Found | null> {
  const r = ref.trim()
  if (!r) return null
  if (/^A\d+$/i.test(r)) {
    const [row] = await db.select().from(actionItems).where(sql`upper(${actionItems.ref}) = ${r.toUpperCase()}`).limit(1)
    return row ? { kind: 'action', row } : null
  }
  const [row] = await db.select().from(decisions).where(sql`upper(${decisions.ref}) = ${r.toUpperCase()}`).limit(1)
  return row ? { kind: row.kind === 'blocker' ? 'blocker' : 'decision', row } : null
}

async function addEvent(found: Found, kind: string, u: ItemUpdate, note: string | null) {
  const at = u.occurredAt ?? new Date()
  if (found.kind === 'action') {
    await db.insert(actionItemEvents).values({
      actionItemId: found.row.id,
      kind,
      occurredAt: at,
      actor: u.actor.slice(0, 200),
      note: note?.slice(0, 1000) ?? null,
      sourceTitle: u.source?.title?.slice(0, 300) ?? null,
      sourceUrl: u.source?.url?.slice(0, 500) ?? null,
      recordedBy: u.actor.slice(0, 200),
    })
  } else {
    // decision_events' kinds were raised | discussed | updated | resolved |
    // reopened; owner, importance, merged, dropped and nudged join them.
    await db.insert(decisionEvents).values({
      decisionId: found.row.id,
      kind,
      occurredAt: at,
      meeting: u.source?.title?.slice(0, 300) ?? null,
      url: u.source?.url?.slice(0, 500) ?? null,
      actor: u.actor.slice(0, 200),
      note: note?.slice(0, 1000) ?? null,
      recordedBy: u.actor.slice(0, 200),
    })
  }
}

async function patchRow(found: Found, patch: Record<string, unknown>) {
  if (found.kind === 'action') await db.update(actionItems).set(patch).where(eq(actionItems.id, found.row.id))
  else await db.update(decisions).set(patch).where(eq(decisions.id, found.row.id))
}

function titleOf(found: Found): string {
  return 'text' in found.row ? found.row.text : found.row.title
}

function isOpen(found: Found): boolean {
  return found.kind === 'action' ? found.row.status === 'open' : !REGISTER_CLOSED.has(found.row.status)
}

/**
 * Apply one change. The one way anything changes an item, so every change
 * leaves the same trail.
 */
export async function applyItemUpdate(u: ItemUpdate): Promise<UpdateResult> {
  const found = await findByRef(u.ref)
  if (!found) return { ref: u.ref, ok: false, error: `No item ${u.ref}.` }
  const now = u.occurredAt ?? new Date()
  const note = u.note?.trim() || null
  const name = `${found.row.ref ?? u.ref} ${titleOf(found).slice(0, 80)}`
  const log = (summary: string) =>
    logChange({ actor: u.actor, summary, detail: note, entityType: found.kind === 'action' ? 'action_item' : 'decision', entityId: found.row.id })

  switch (u.action) {
    case 'resolve': {
      if (!isOpen(found)) return { ref: u.ref, ok: true, status: found.row.status }
      if (found.kind === 'action') {
        await patchRow(found, { status: 'done', completedAt: now, lastActivityAt: now })
        await addEvent(found, 'done', u, note)
      } else {
        await patchRow(found, { status: 'decided', resolvedAt: now, resolvedAtMeeting: u.source?.title ?? null, lastActivityAt: now })
        await addEvent(found, 'resolved', u, note)
      }
      await log(`${found.kind === 'action' ? 'Done' : 'Resolved'}: ${name}`)
      return { ref: u.ref, ok: true, status: found.kind === 'action' ? 'done' : 'decided' }
    }
    case 'drop': {
      if (!isOpen(found)) return { ref: u.ref, ok: true, status: found.row.status }
      if (found.kind === 'action') await patchRow(found, { status: 'dropped', completedAt: now, lastActivityAt: now })
      else await patchRow(found, { status: 'dropped', resolvedAt: now, lastActivityAt: now })
      await addEvent(found, 'dropped', u, note)
      await log(`Withdrawn: ${name}`)
      return { ref: u.ref, ok: true, status: 'dropped' }
    }
    case 'reopen': {
      if (isOpen(found)) return { ref: u.ref, ok: true, status: found.row.status }
      if (found.kind === 'action') await patchRow(found, { status: 'open', completedAt: null, mergedInto: null, lastActivityAt: now })
      else await patchRow(found, { status: 'open', resolvedAt: null, mergedInto: null, lastActivityAt: now })
      await addEvent(found, 'reopened', u, note)
      await log(`Reopened: ${name}`)
      return { ref: u.ref, ok: true, status: 'open' }
    }
    case 'progress': {
      if (!note) return { ref: u.ref, ok: false, error: 'An update needs a note saying what happened.' }
      await patchRow(found, { lastActivityAt: now, mentions: sql`${found.kind === 'action' ? actionItems.mentions : decisions.mentions} + 1` })
      await addEvent(found, 'updated', u, note)
      return { ref: u.ref, ok: true, status: found.row.status }
    }
    case 'duplicate': {
      const keep = u.duplicateOf ? await findByRef(u.duplicateOf) : null
      if (!keep) return { ref: u.ref, ok: false, error: `No item ${u.duplicateOf ?? '(none given)'} to merge into.` }
      if (keep.row.id === found.row.id) return { ref: u.ref, ok: false, error: 'An item cannot duplicate itself.' }
      const keepRef = keep.row.ref ?? u.duplicateOf!
      const why = note ?? `The same as ${keepRef}.`
      if (found.kind === 'action') await patchRow(found, { status: 'dropped', completedAt: now, mergedInto: keepRef, lastActivityAt: now })
      else await patchRow(found, { status: 'dropped', resolvedAt: now, mergedInto: keepRef, lastActivityAt: now })
      await addEvent(found, 'merged', u, `Merged into ${keepRef}. ${why}`)
      // The survivor has now come up in one more place, at least.
      const mentions = Math.max(1, found.row.mentions)
      await patchRow(keep, {
        lastActivityAt: now,
        mentions: sql`${keep.kind === 'action' ? actionItems.mentions : decisions.mentions} + ${mentions}`,
      })
      await addEvent(keep, 'merged', u, `${found.row.ref ?? u.ref} merged into this. ${why}`)
      await rescore(keep)
      await log(`Merged ${found.row.ref ?? u.ref} into ${keepRef} as a duplicate`)
      return { ref: u.ref, ok: true, status: 'dropped' }
    }
    case 'owner': {
      const asked = u.owner?.trim()
      if (!asked) return { ref: u.ref, ok: false, error: 'Who should own it?' }
      const roster = await db.select({ id: people.id, name: people.name }).from(people)
      const personId = matchPerson(asked, roster)
      if (found.kind === 'action') await patchRow(found, { ownerId: personId, ownerName: personId ? null : asked, lastActivityAt: now })
      else await patchRow(found, { ownerId: personId, ownerText: personId ? null : asked, lastActivityAt: now })
      await addEvent(found, 'owner', u, `Owner: ${asked}${note ? `. ${note}` : ''}`)
      await log(`${asked} now owns ${name}`)
      return { ref: u.ref, ok: true, status: found.row.status }
    }
    case 'score': {
      const factors = [...new Set((u.factors ?? []).filter(isFactor))]
      const reasons = (u.reasons ?? []).filter((r) => isFactor(r.factor)).slice(0, 12)
      const score = scoreOf(found.kind, factors, found.row.mentions, found.row.importanceAdjust)
      const before = found.row.importanceScore
      const firstTime = before == null
      // The first score is bookkeeping, not news about the item; a change
      // after that is activity (Scott: a score change counts as an update).
      const changed = !firstTime && before !== score
      await patchRow(found, {
        importanceFactors: JSON.stringify(factors),
        importanceReasons: JSON.stringify(reasons),
        importanceScore: score,
        ...(changed ? { lastActivityAt: now } : {}),
      })
      if (changed) await addEvent(found, 'importance', u, `Importance ${before} → ${score}${note ? `. ${note}` : ''}`)
      return { ref: u.ref, ok: true, status: found.row.status, score }
    }
    case 'adjust': {
      const delta = Math.sign(u.delta ?? 0)
      if (!delta) return { ref: u.ref, ok: false, error: 'Say more important (+1) or less (-1).' }
      const adjust = found.row.importanceAdjust + delta * ADJUST_STEP
      const score = scoreOf(found.kind, parseFactors(found.row.importanceFactors), found.row.mentions, adjust)
      await patchRow(found, { importanceAdjust: adjust, importanceScore: score, lastActivityAt: now })
      await addEvent(found, 'importance', u, `${delta > 0 ? 'More' : 'Less'} important, by hand: now ${score}${note ? `. ${note}` : ''}`)
      await log(`Marked ${name} ${delta > 0 ? 'more' : 'less'} important (${score})`)
      return { ref: u.ref, ok: true, status: found.row.status, score }
    }
    case 'nudged': {
      // A reminder is not an update: last_activity_at is left alone.
      await patchRow(found, { nudgedAt: now })
      await addEvent(found, 'nudged', u, note)
      return { ref: u.ref, ok: true, status: found.row.status }
    }
  }
  return { ref: u.ref, ok: false, error: `Unknown action ${String(u.action)}.` }
}

/** Recompute after mentions changed. Not activity in itself. */
async function rescore(found: Found) {
  const fresh = await findByRef(found.row.ref ?? '')
  if (!fresh || fresh.row.importanceScore == null) return
  const score = scoreOf(fresh.kind, parseFactors(fresh.row.importanceFactors), fresh.row.mentions, fresh.row.importanceAdjust)
  if (score !== fresh.row.importanceScore) await patchRow(fresh, { importanceScore: score })
}

/** An item's history, newest first, for the popup. */
export async function itemHistory(ref: string): Promise<Array<{ kind: string; at: Date; actor: string | null; note: string | null; source: string | null; url: string | null }>> {
  const found = await findByRef(ref)
  if (!found) return []
  if (found.kind === 'action') {
    const rows = await db.select().from(actionItemEvents).where(eq(actionItemEvents.actionItemId, found.row.id)).orderBy(desc(actionItemEvents.occurredAt))
    return rows.map((r) => ({ kind: r.kind, at: r.occurredAt, actor: r.actor, note: r.note, source: r.sourceTitle, url: r.sourceUrl }))
  }
  const rows = await db.select().from(decisionEvents).where(eq(decisionEvents.decisionId, found.row.id)).orderBy(desc(decisionEvents.occurredAt))
  return rows.map((r) => ({ kind: r.kind, at: r.occurredAt ?? r.createdAt, actor: r.actor, note: r.note, source: r.meeting, url: r.url }))
}

/** Every open item of one kind in scope that has gone inactive: the "withdraw all" set. */
export async function inactiveRefs(kind: ItemKind, ids: ReadonlySet<string> | null): Promise<string[]> {
  const items = inScope(await loadItems({ kinds: [kind] }), ids)
  return items.filter((i) => i.open && i.inactive).map((i) => i.ref)
}

/** For the agent route: rows by id, so an update can be checked against what exists. */
export async function refsExist(refs: string[]): Promise<Set<string>> {
  const upper = refs.map((r) => r.toUpperCase())
  const a = await db.select({ ref: actionItems.ref }).from(actionItems).where(inArray(sql`upper(${actionItems.ref})`, upper))
  const d = await db.select({ ref: decisions.ref }).from(decisions).where(inArray(sql`upper(${decisions.ref})`, upper))
  return new Set([...a, ...d].map((r) => (r.ref ?? '').toUpperCase()))
}


/** Every id at or beneath one record, for narrowing a list to it. */
export async function scopeIds(level: Tier, id: string): Promise<Set<string>> {
  const [inits, projs] = await Promise.all([
    db.select({ id: initiatives.id, objectiveId: initiatives.objectiveId }).from(initiatives),
    db.select({ id: projects.id, initiativeId: projects.initiativeId }).from(projects),
  ])
  const group = <T extends { id: string }>(rows: T[], parent: (r: T) => string | null) => {
    const m = new Map<string, string[]>()
    for (const r of rows) {
      const p = parent(r)
      if (p) m.set(p, [...(m.get(p) ?? []), r.id])
    }
    return m
  }
  return idsAtOrBelow(level, id, {
    initiativesIn: group(inits, (r) => r.objectiveId),
    projectsIn: group(projs, (r) => r.initiativeId),
  })
}
