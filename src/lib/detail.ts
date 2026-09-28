/**
 * Everything a detail page shows, shaped identically for all three tiers.
 *
 * WHY THIS EXISTS
 *
 * The three detail pages were written one at a time and diverged: the project
 * page had fourteen sections, the workstream page fifteen in a different
 * order, and the initiative page five. The same fact — an open blocker — was
 * a table row on one, a card on another and absent from the third. Somebody
 * moving between tiers had to re-learn the page each time.
 *
 * So the page files are now thin: they fetch this, and render the same tiles
 * in the same order. What differs between tiers is what rolls up, and that
 * decision lives here rather than in three JSX files.
 *
 * WHAT ROLLS UP
 *
 * An initiative owns almost no records directly — the grouping exists only in
 * this app, and every blocker, decision and dependency is filed against the
 * work underneath. An initiative page that showed only its own rows would be
 * blank on an initiative in serious trouble. So each tier shows its own plus
 * everything beneath it, which is the same rule the milestone panel uses.
 */
import { cache } from 'react'
import { and, eq, inArray, isNull, desc } from 'drizzle-orm'
import { db } from '@/db/client'
import { actionItemLinks, actionItems, agentObservations, assessments, people } from '@/db/schema'
import { getPortfolio } from './portfolio'
import { getHomeCards } from './home'
import { getReadiness, statusFor, type ReadinessModel } from './readiness'
import type { TileItem } from '@/components/detail/tile'
import type { Evidence, UpdateBullet } from '@/components/detail/health-tile'
import type { ReadinessGateView } from '@/components/detail/readiness-tile'

export type Level = 'initiative' | 'project' | 'workstream'

const DEC_TONE: Record<string, string> = {
  open: 'var(--c3)',
  watch: 'var(--c2)',
  resolved: 'var(--c5)',
  closed: 'var(--line-2)',
}

/** "14 Nov", or "14 Nov 2027" when it is not this year. */
function shortDate(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return null
  const thisYear = date.getUTCFullYear() === new Date().getUTCFullYear()
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    ...(thisYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(date)
}

export interface DetailData {
  health: {
    assessmentId: string | null
    rag: string | null
    confidence: string | null
    summary: string | null
    authoredBy: string | null
    pct: number
    expected: number
  }
  stakeholder: UpdateBullet[]
  engineering: UpdateBullet[]
  evidence: Evidence[]
  updates: TileItem[]
  blockers: TileItem[]
  decisions: TileItem[]
  actions: TileItem[]
  dependencies: TileItem[]
  /** Null when there is nothing outstanding, or nothing to be ready for. */
  readiness: { workstreamId: string; gates: ReadinessGateView[] } | null
}

/** Every entity id at or beneath this one, and the workstreams among them. */
function scopeOf(
  level: Level,
  id: string,
  p: Awaited<ReturnType<typeof getPortfolio>>,
): { ids: Set<string>; workstreamIds: string[] } {
  if (level === 'workstream') return { ids: new Set([id]), workstreamIds: [id] }

  if (level === 'project') {
    const proj = p.projects.find((x) => x.id === id)
    const ws = proj?.workstreams.map((w) => w.id) ?? []
    return { ids: new Set([id, ...ws]), workstreamIds: ws }
  }

  const projs = p.projects.filter((x) => x.initiativeId === id)
  const ws = projs.flatMap((x) => x.workstreams.map((w) => w.id))
  return { ids: new Set([id, ...projs.map((x) => x.id), ...ws]), workstreamIds: ws }
}

function readinessFor(model: ReadinessModel, workstreamIds: string[]): DetailData['readiness'] {
  if (workstreamIds.length === 0) return null

  // One workstream's checklist is the checklist. Several roll up to the first
  // one that still has something outstanding, because a merged checklist
  // across six workstreams is a list nobody can act on — the tick has to
  // belong to a specific piece of work.
  const behind = workstreamIds.find((wid) =>
    model.items.some((it) => it.required && statusFor(model, wid, it.id) !== 'done' && statusFor(model, wid, it.id) !== 'na'),
  )
  if (!behind) return null

  const gates: ReadinessGateView[] = model.gates.map((g) => ({
    id: g.id,
    label: g.name,
    items: g.items.map((it) => {
      const s = statusFor(model, behind, it.id)
      const row = model.byProject.get(behind)?.get(it.id)
      return {
        id: it.id,
        label: it.label,
        required: it.required,
        done: s === 'done' || s === 'na',
        detail: [row?.note, row?.link].filter(Boolean).join(' · ') || undefined,
      }
    }),
  }))
  return { workstreamId: behind, gates: gates.filter((g) => g.items.length > 0) }
}

export const getDetail = cache(async (level: Level, id: string): Promise<DetailData> => {
  const [p, cards, model, obsRows, assessRows, folk] = await Promise.all([
    getPortfolio(),
    getHomeCards(level),
    getReadiness(),
    db
      .select()
      .from(agentObservations)
      .where(isNull(agentObservations.supersededAt))
      .orderBy(desc(agentObservations.generatedAt)),
    db.select().from(assessments).where(eq(assessments.current, true)).orderBy(desc(assessments.asOf)),
    db.select({ id: people.id, name: people.name }).from(people),
  ])

  const { ids, workstreamIds } = scopeOf(level, id, p)
  const card = cards.find((c) => c.id === id) ?? null
  const personName = new Map(folk.map((x) => [x.id, x.name]))

  // --- what Yaara said -----------------------------------------------------
  const parse = <T,>(raw: string | null, fallback: T): T => {
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  // Observations at this entity, and at everything under it. The tier's own
  // come first so its summary wins where it has one.
  const mineFirst = [...obsRows]
    .filter((o) => ids.has(o.entityId))
    .sort((a, b) => (a.entityId === id ? -1 : b.entityId === id ? 1 : 0))

  const items = mineFirst.flatMap((o) =>
    parse<Array<{ kind: string; audience: string; text: string; citations?: string[] }>>(o.items, []).map((it, ix) => ({
      ...it,
      id: `${o.id}-${ix}`,
      sources: parse<Evidence[]>(o.evidence, []),
    })),
  )

  const evidence = mineFirst.flatMap((o) => parse<Evidence[]>(o.evidence, []))

  const bulletsFor = (audience: string): UpdateBullet[] =>
    items
      .filter((it) => it.audience === audience)
      .slice(0, 3)
      .map((it) => {
        const cited = (it.citations ?? [])
          .map((c) => it.sources.find((s) => s.id === c))
          .filter(Boolean) as Evidence[]
        return {
          id: it.id,
          kind: it.kind,
          text: it.text,
          detail: cited.map((c) => `${c.source}: ${c.title}`).join(' · ') || undefined,
        }
      })

  const assess = assessRows.find((a) => a.entityId === id) ?? null

  // --- recent updates ------------------------------------------------------
  const updates: TileItem[] = mineFirst
    .flatMap((o) =>
      parse<Array<{ text: string; at: string | null; source: string | null; citations?: string[] }>>(o.recent, []).map(
        (r, ix) => ({ ...r, id: `${o.id}-r${ix}`, at: r.at }),
      ),
    )
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    .filter((r, ix, all) => all.findIndex((x) => x.text.trim() === r.text.trim()) === ix)
    .map((r) => ({
      id: r.id,
      text: r.text,
      meta: shortDate(r.at),
      tone: 'var(--c1)',
      detail: r.source ?? undefined,
    }))

  // --- the register --------------------------------------------------------
  const regs = p.decisions.filter((d) => d.entityId && ids.has(d.entityId))
  const open = (s: string) => s !== 'resolved' && s !== 'closed'

  const blockers: TileItem[] = regs
    .filter((d) => d.kind === 'blocker' && open(d.status))
    .map((d) => ({
      id: d.id,
      text: d.title,
      meta: shortDate(d.raisedAt),
      tone: DEC_TONE[d.status] ?? 'var(--c3)',
      toneLabel: d.status,
      detail: [d.ref, d.ownerText ? `owner ${d.ownerText}` : null, d.body].filter(Boolean).join(' · ') || undefined,
      href: `/decisions?ref=${d.ref}`,
    }))

  const decisions: TileItem[] = regs
    .filter((d) => d.kind === 'decision')
    .map((d) => ({
      id: d.id,
      text: d.title,
      meta: shortDate(d.raisedAt),
      tone: DEC_TONE[d.status] ?? 'var(--line-2)',
      toneLabel: d.status,
      detail: [d.ref, d.body, d.nextAction ? `next: ${d.nextAction}` : null].filter(Boolean).join(' · ') || undefined,
      href: `/decisions?ref=${d.ref}`,
    }))

  // --- action items --------------------------------------------------------
  const links = await db.select().from(actionItemLinks).where(inArray(actionItemLinks.entityId, [...ids]))
  const actRows = links.length
    ? await db
        .select()
        .from(actionItems)
        .where(and(eq(actionItems.status, 'open'), inArray(actionItems.id, links.map((l) => l.actionItemId))))
    : []

  const actions: TileItem[] = actRows.map((a) => ({
    id: a.id,
    text: a.text,
    meta: shortDate(a.dueDate),
    tone: a.dueDate && a.dueDate.getTime() < Date.now() ? 'var(--c3)' : 'var(--c5)',
    toneLabel: a.dueDate && a.dueDate.getTime() < Date.now() ? 'overdue' : 'open',
    detail: [a.ownerId ? personName.get(a.ownerId) : a.ownerName, a.sourceTitle].filter(Boolean).join(' · ') || undefined,
    href: '/actions',
  }))

  // --- dependencies --------------------------------------------------------
  const deps = p.dependencies.filter((d) => ids.has(d.fromId) || ids.has(d.toId))
  const nameOf = (type: string, entityId: string): string => {
    if (type === 'workstream') return p.workstreams.find((w) => w.id === entityId)?.name ?? 'something'
    if (type === 'project') return p.projects.find((x) => x.id === entityId)?.name ?? 'something'
    return 'something'
  }

  const dependencies: TileItem[] = deps
    .filter((d) => d.status !== 'resolved' && d.status !== 'dropped')
    .map((d) => {
      const outward = ids.has(d.fromId)
      return {
        id: d.id,
        text: outward
          ? `Waiting on ${nameOf(d.toType, d.toId)}`
          : `${nameOf(d.fromType, d.fromId)} is waiting on this`,
        meta: shortDate(d.dueDate),
        tone: d.status === 'blocked' ? 'var(--c3)' : 'var(--c2)',
        toneLabel: d.status,
        detail: d.description ?? undefined,
        href: '/dependencies',
      }
    })

  return {
    health: {
      assessmentId: assess?.id ?? null,
      rag: assess?.rag ?? null,
      confidence: assess?.confidence ?? null,
      summary: assess?.rationale ?? null,
      authoredBy: assess?.authoredBy ?? null,
      pct: card?.next?.pct ?? 0,
      expected: card?.next?.expected ?? 0,
    },
    stakeholder: bulletsFor('stakeholder'),
    engineering: bulletsFor('engineering'),
    evidence: evidence.filter((e, ix, all) => all.findIndex((x) => x.id === e.id) === ix),
    updates,
    blockers,
    decisions,
    actions,
    dependencies,
    readiness: readinessFor(model, workstreamIds),
  }
})
