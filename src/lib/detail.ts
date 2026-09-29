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
import { timelineModel } from './timeline-source'
import type { TimelineModel } from './timeline-model'
import { getReadiness, statusFor, type ReadinessModel } from './readiness'
import type { TileItem } from '@/components/detail/tile'
import { progressPercent } from './progress'
import type { Evidence, UpdateBullet } from '@/components/detail/health-tile'
import type { ReadinessGateView } from '@/components/detail/readiness-tile'

export type Level = 'initiative' | 'project' | 'workstream'

/** Assessed health as a bullet colour, so a child list reads like the rest. */
const RAG_TONE: Record<string, string> = {
  green: 'var(--c5)',
  amber: 'var(--c2)',
  red: 'var(--c3)',
  unknown: 'var(--line-2)',
}

/** States that mean a workstream is no longer live, for the "N live" count. */
const ENDED_WS = new Set(['completed', 'canceled', 'cancelled', 'withdrawn'])

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
  }
  stakeholder: UpdateBullet[]
  engineering: UpdateBullet[]
  evidence: Evidence[]
  updates: TileItem[]
  blockers: TileItem[]
  decisions: TileItem[]
  actions: TileItem[]
  dependencies: TileItem[]
  /**
   * This record's own lane on the timeline chart — the same drawing the
   * Timeline page makes, narrowed to the thing being looked at.
   */
  timeline: TimelineModel | null
  /**
   * Null only when this page covers no workstream that has a checklist at all.
   * `workstreamId` is where to start; `streams` is everything it could show.
   */
  readiness: {
    workstreamId: string
    streams: Array<{ id: string; name: string; gates: ReadinessGateView[]; done: number; total: number }>
  } | null
  /**
   * The tier directly beneath, linked.
   *
   * An initiative lists its projects and a project lists its workstreams. A
   * workstream has nothing below it that carries a name and a page, so this
   * is null there and the layout gives the space back to the updates.
   */
  children: { title: string; items: TileItem[] } | null
}

/** Every entity id at or beneath this one, and the workstreams among them. */
function scopeOf(
  level: Level,
  id: string,
  p: Awaited<ReturnType<typeof getPortfolio>>,
): { ids: Set<string>; workstreams: Array<{ id: string; name: string }> } {
  if (level === 'workstream') {
    const w = p.projects.flatMap((x) => x.workstreams).find((x) => x.id === id)
    return { ids: new Set([id]), workstreams: w ? [{ id: w.id, name: w.name }] : [] }
  }

  if (level === 'project') {
    const proj = p.projects.find((x) => x.id === id)
    const ws = proj?.workstreams.map((w) => ({ id: w.id, name: w.name })) ?? []
    return { ids: new Set([id, ...ws.map((w) => w.id)]), workstreams: ws }
  }

  const projs = p.projects.filter((x) => x.initiativeId === id)
  const ws = projs.flatMap((x) => x.workstreams.map((w) => ({ id: w.id, name: w.name })))
  return { ids: new Set([id, ...projs.map((x) => x.id), ...ws.map((w) => w.id)]), workstreams: ws }
}

/**
 * The readiness checklist for a detail page.
 *
 * WHAT WAS WRONG
 *
 * A checklist belongs to a workstream — the tick has to be against a specific
 * piece of work — but a project or initiative page covers several. This used to
 * resolve that by showing "the first workstream that still has something
 * outstanding", and returning null when there was none.
 *
 * Both halves of that misbehave at exactly the moment somebody finishes a
 * checklist, which is the worst possible moment. Tick the last box on a project
 * page and the tile silently swapped to a DIFFERENT workstream, whose boxes are
 * all empty: you ticked fourteen things and watched all fourteen go blank. On a
 * workstream page it did not swap, it disappeared. Both read as "it unchecked
 * everything", and both were reported as that.
 *
 * So: every workstream this page covers is returned, each with its own
 * checklist and its own count, and the tile lets the reader choose between them
 * and holds that choice. The default is still the first one with something
 * outstanding, because that is the useful place to land — but it is now a
 * starting point rather than something that moves underneath them.
 */
function readinessFor(
  model: ReadinessModel,
  streams: Array<{ id: string; name: string }>,
): DetailData['readiness'] {
  if (streams.length === 0) return null

  const gatesFor = (wid: string): ReadinessGateView[] =>
    model.gates
      .map((g) => ({
        id: g.id,
        label: g.name,
        items: g.items.map((it) => {
          const s = statusFor(model, wid, it.id)
          const row = model.byProject.get(wid)?.get(it.id)
          return {
            id: it.id,
            label: it.label,
            required: it.required,
            done: s === 'done' || s === 'na',
            detail: [row?.note, row?.link].filter(Boolean).join(' · ') || undefined,
          }
        }),
      }))
      .filter((g) => g.items.length > 0)

  const views = streams
    .map((w) => {
      const gates = gatesFor(w.id)
      const required = gates.flatMap((g) => g.items.filter((i) => i.required))
      return {
        id: w.id,
        name: w.name,
        gates,
        done: required.filter((i) => i.done).length,
        total: required.length,
      }
    })
    .filter((v) => v.gates.length > 0)

  if (views.length === 0) return null

  // The first with something left to do, or — when everything is finished —
  // the first, so that a completed checklist is still shown as completed
  // rather than vanishing.
  const start = views.find((v) => v.done < v.total) ?? views[0]!
  return { workstreamId: start.id, streams: views }
}

export const getDetail = cache(async (level: Level, id: string): Promise<DetailData> => {
  // getHomeCards used to be in here, for the two numbers the health ring
  // needed. The ring is gone, and with it a whole board computation on every
  // detail page render.
  const [p, model, obsRows, assessRows, folk, timeline] = await Promise.all([
    getPortfolio(),
    getReadiness(),
    db
      .select()
      .from(agentObservations)
      .where(isNull(agentObservations.supersededAt))
      .orderBy(desc(agentObservations.generatedAt)),
    db.select().from(assessments).where(eq(assessments.current, true)).orderBy(desc(assessments.asOf)),
    db.select({ id: people.id, name: people.name }).from(people),
    /*
     * This record's own lane, drawn the way the Timeline page draws it.
     *
     * `includeEnded` because a detail page is about one thing and its
     * finished children are part of its story — hiding them here would leave
     * gaps in a chart whose whole job is to show the shape of the work. The
     * whole-board view filters them because it is a screen full of other
     * people's work; this is not.
     */
    timelineModel({ level, only: id, includeEnded: true }),
  ])

  const { ids, workstreams: scopeStreams } = scopeOf(level, id, p)
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
        (r, ix) => ({ ...r, id: `${o.id}-r${ix}`, at: r.at, citations: r.citations ?? [] }),
      ),
    )
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    .filter((r, ix, all) => all.findIndex((x) => x.text.trim() === r.text.trim()) === ix)
    .map((r) => {
      // Everything known about this line, for the hover: which meeting or
      // channel it came from, the ticket or document behind it, and when
      // that happened. It was showing the bare source name, which told you
      // "slack" and not which channel.
      const citedRows = (r.citations ?? [])
        .map((c) => evidence.find((e) => e.id === c))
        .filter((e): e is Evidence => Boolean(e))
      const cited = citedRows.map((e) =>
        [e.source, e.title, e.occurredAt ? e.occurredAt.slice(0, 10) : null].filter(Boolean).join(' · '),
      )
      const parts = [
        r.source ? `From ${r.source}` : null,
        r.at ? `Reported ${shortDate(r.at)}` : null,
        ...cited,
      ].filter(Boolean) as string[]

      // The first citation that says WHERE it came from, which is what a
      // routing rule matches on. A line with no such citation gets no
      // correction button: "slack" on its own is not something anyone can
      // usefully write a rule about, and offering a control that would be
      // refused on submit is worse than not offering it.
      const locatable = citedRows.find((e) => e.location || e.author)
      return {
        id: r.id,
        text: r.text,
        meta: shortDate(r.at),
        tone: 'var(--c1)',
        // One per line: a single run-on string is unreadable in a tooltip.
        detail: parts.length ? parts.join('\n') : undefined,
        misroute: locatable
          ? {
              source: locatable.source,
              location: locatable.location ?? null,
              author: locatable.author ?? null,
              evidenceId: locatable.id,
              evidenceTitle: locatable.title,
            }
          : undefined,
      }
    })

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
    },
    stakeholder: bulletsFor('stakeholder'),
    engineering: bulletsFor('engineering'),
    evidence: evidence.filter((e, ix, all) => all.findIndex((x) => x.id === e.id) === ix),
    updates,
    blockers,
    decisions,
    actions,
    dependencies,
    readiness: readinessFor(model, scopeStreams),
    timeline,
    children:
      level === 'initiative'
        ? {
            title: 'Projects',
            items: p.projects
              .filter((x) => x.initiativeId === id)
              .map((x) => ({
                id: x.id,
                text: x.name,
                meta: `${x.workstreams.filter((w) => !ENDED_WS.has(w.status)).length} live`,
                tone: RAG_TONE[x.health.rag] ?? 'var(--line-2)',
                toneLabel: x.status,
                detail: [x.owner?.name ? `Owner ${x.owner.name}` : 'No owner', x.health.rationale]
                  .filter(Boolean)
                  .join('\n'),
                href: `/projects/${x.id}`,
              })),
          }
        : level === 'project'
          ? {
              title: 'Workstreams',
              items: (p.projects.find((x) => x.id === id)?.workstreams ?? []).map((w) => ({
                id: w.id,
                text: w.name,
                meta: w.progress ? `${progressPercent(w.progress)}%` : null,
                tone: RAG_TONE[w.health.rag] ?? 'var(--line-2)',
                toneLabel: w.status,
                detail: [w.lead?.name ? `Lead ${w.lead.name}` : 'No lead', w.health.rationale]
                  .filter(Boolean)
                  .join('\n'),
                href: `/workstreams/${w.id}`,
              })),
            }
          // A workstream has nothing below it with a page of its own.
          : null,
  }
})
