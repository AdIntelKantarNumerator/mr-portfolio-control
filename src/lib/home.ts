/**
 * The home page's read model, at whichever level you are looking.
 *
 * One function for all three levels rather than three, because the card is the
 * same card: a name, a health call, the next milestone, the signals underneath
 * and how much has been happening. What changes between levels is only which
 * rows roll up into it.
 *
 * ROLLING UP
 *
 * An objective's numbers are the sum of its initiatives' projects, not of
 * anything stored on the objective. Nothing is denormalised, because a cached
 * count is a second answer to a question the tables already answer, and it goes
 * stale the first time somebody moves an initiative.
 */
import { cache } from 'react'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  actionItemLinks,
  actionItems,
  agentObservations,
  decisions,
  objectives,
  milestones,
  people,
  initiatives,
  projects,
  dependencies,
} from '@/db/schema'
import { ENDED_INITIATIVE_STATUS } from './domain'
import { lateDependencies } from './dependency-risk'
import { activitySeries } from './activity-series'
import { getCardOrder } from './card-order'
import { blockedAtOrBelow } from './blocked'
import { byTargetDate } from './milestone-order'
import { cardHealth, type Reason } from './card-health'
import { formatScope } from './hierarchy'

// The vocabulary lives in home-types.ts, which imports nothing, so client
// components can use it without dragging this module's database import into
// the browser bundle. Re-exported here so existing imports keep working.
export {
  MIX_ORDER,
  mixRank,
  statusLabel,
  type MixGroup,
  type MixMember,
  LEVELS,
  SORTS,
  HEALTHS,
  isLevel,
  isSort,
  isHealth,
  type Level,
  type Sort,
  type HealthFilter,
} from './home-types'
import {
  IN_PROGRESS_BLOCKED,
  IN_PROGRESS_OK,
  isInProgress,
  mixRank,
  statusLabel,
  type HealthFilter,
  type Level,
  type MixGroup,
  type MixMember,
  type Sort,
} from './home-types'

export interface Signal {
  kind: 'blocker' | 'decision' | 'action'
  /** Yaara's one line covering all of `items`, or the single item's own text. */
  summary: string
  items: Array<{ id: string; text: string; when: string; who: string | null; href: string | null }>
}

export interface MilestoneMark {
  id: string
  name: string
  status: string
  /**
   * Where it sits on the rail, 0–100, BY DATE.
   *
   * It used to be the mark's index — evenly spaced, so six milestones spread
   * over two years and six crammed into a fortnight drew the same picture,
   * and the "today" marker beside them was placed by a percentage that had
   * nothing to do with the spacing. A rail that looks like a timeline and is
   * not one is worse than a list.
   */
  at: number
  /** The date itself, for the hover. Null when nobody set one. */
  on: string | null
}

/** Where today falls on the rail, 0–100, or null when it is off either end. */
export type RailToday = number | null

export interface HomeCard {
  id: string
  level: Level
  name: string
  owner: string | null
  /** "4 initiatives · 11 projects" — whatever is beneath this level. */
  beneath: string
  health: 'good' | 'warn' | 'crit' | 'quiet'
  /** Yaara's one sentence, or a person's if somebody has edited it. */
  verdict: string | null
  verdictBy: string | null
  verdictAt: Date | null
  /** Set when a person overwrote what she wrote. */
  verdictEditedBy: string | null
  /**
   * Set when this card's assessment is borrowed from the tier beneath.
   *
   * Names what it was rolled up from, so the card can say "from 3 initiatives"
   * rather than presenting somebody else's sentence as if it were about this
   * objective. An honest secondhand answer beats "No assessment yet" when
   * every initiative inside has one, and beats a silent merge either way.
   */
  verdictRolledUp: string | null
  detail: string[]
  evidence: Array<{ source: string; text: string; url: string | null }>
  /**
   * Why the card reads the way it does — one clause per fact, worst first.
   *
   * The board used to show a completion ring here instead. Three versions of
   * that number were wrong in the same way: none of them came from anybody
   * counting anything. See lib/card-health.ts.
   */
  reasons: Reason[]
  rail: MilestoneMark[]
  /** Where today sits on the rail, or null when there is nothing to draw. */
  railToday: RailToday
  signals: Signal[]
  /**
   * What sits directly beneath, grouped by status, in a fixed order.
   *
   * The tier below and no further: an objective's mix is its initiatives, a
   * initiative's is its projects. Counting two tiers down made "23 in
   * progress" on an objective card a project count, which is not the
   * number anybody reading an objective has in mind.
   *
   * The members travel with the count so a segment can say what is in it. A
   * bar you cannot interrogate is a bar you have to take on trust.
   */
  mix: MixGroup[]
  activity: number[]
  activityDelta: string
  href: string
}

const DAY = 86_400_000

/**
 * Same text twice is the commonest artefact of rolling up: two initiatives in
 * one objective frequently produce the identical bullet from the identical
 * pull request.
 */
function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))]
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const ENDED = new Set<string>(ENDED_INITIATIVE_STATUS)

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/*
 * `healthOf` is gone, and with it the last of the completion ring.
 *
 * It judged a card by the gap between a percentage and the share of the
 * calendar already gone. Both halves of that comparison were about dates
 * rather than work, so the answer moved on its own. lib/card-health.ts
 * replaces it with a state built from blockers, missed dependencies, overdue
 * milestones, children in trouble and silence — each reported as its own
 * reason rather than folded into a number.
 */

/*
 * `expectedPct` was here: the share of the calendar gone between a start date
 * and a milestone. It was drawn beside the ring as "% expected" and, in the
 * last version, AS the ring. It is a fact about the calendar and says nothing
 * about the work, which is why a milestone added today opened at 80%.
 */



/*
 * `pctFromStatus` lived here: a lookup returning 55 for on_track, 40 for
 * at_risk, 25 for blocked and 10 for everything else. It was compared against
 * a real elapsed-time figure and coloured the card off the difference, so the
 * ring measured a constant against a clock. See lib/milestone-progress.ts for
 * what replaced it and why.
 */

export const getHomeCards = cache(async (
  level: Level,
  sort: Sort = 'active',
  health: HealthFilter = 'all',
): Promise<HomeCard[]> => {
  const now = Date.now()
  // Midnight UTC: a milestone due today is due today all day, and "overdue
  // by four hours" is not a thing anybody means.
  const startOfToday = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())

  const [inits, projs, wss, ms, obs, decs, acts, links, peeps, deps] = await Promise.all([
    db.select().from(objectives),
    db.select().from(initiatives),
    db.select().from(projects),
    db.select().from(milestones),
    db.select().from(agentObservations).where(isNull(agentObservations.supersededAt)).orderBy(desc(agentObservations.generatedAt)),
    db.select().from(decisions),
    db.select().from(actionItems).where(eq(actionItems.status, 'open')),
    db.select().from(actionItemLinks),
    db.select().from(people),
    db.select().from(dependencies),
  ])

  const personName = new Map(peeps.map((p) => [p.id, p.name]))



  // Everything carrying an open blocker, by entity id. Used to split the
  // in-progress segment of the mix bar, and computed once here rather than
  // per card because every card would otherwise rescan the same table.
  const blockedIds = new Set(
    decs
      .filter((d) => d.kind === 'blocker' && d.status !== 'resolved' && d.status !== 'closed' && d.entityId)
      .map((d) => d.entityId as string),
  )

  /*
   * A dependency with a date somebody is about to miss is a blocker too.
   *
   * The required date used to sit on the dependency row and be read by
   * nothing: it stayed open and green while the date went past. The work that
   * has to MOVE is the delivering end, so that is what goes red — marking the
   * waiting end would light up a team who cannot do anything about it.
   */
  const plans = new Map<string, { targetDate: Date | null; done: boolean }>()
  for (const p of projs) plans.set(`initiative:${p.id}`, { targetDate: p.targetDate, done: ENDED.has(p.status) })
  for (const w of wss) plans.set(`project:${w.id}`, { targetDate: w.targetDate, done: ENDED.has(w.status) })
  for (const i of inits) plans.set(`objective:${i.id}`, { targetDate: i.targetDate, done: i.status === 'completed' || i.status === 'canceled' })
  for (const m of ms) plans.set(`milestone:${m.id}`, { targetDate: m.targetDate, done: m.status === 'complete' })

  const late = lateDependencies(deps, (type, id) => plans.get(`${type}:${id}`) ?? null)
  for (const id of late.keys()) blockedIds.add(id)

  // Which projects sit under which initiative, and which initiatives under which
  // objective — the only two joins the whole page needs.
  const wsByInitiative = new Map<string, typeof wss>()
  for (const w of wss) {
    if (!w.initiativeId) continue
    wsByInitiative.set(w.initiativeId, [...(wsByInitiative.get(w.initiativeId) ?? []), w])
  }
  const projByObjective = new Map<string, typeof projs>()
  for (const p of projs) {
    if (!p.objectiveId) continue
    projByObjective.set(p.objectiveId, [...(projByObjective.get(p.objectiveId) ?? []), p])
  }

  /**
   * Is this initiative standing still — itself, or anything inside it?
   *
   * A blocker is filed where the work is stuck, which is a project. Asking
   * only whether the initiative row carries one says "on track" about an initiative
   * whose every project is jammed.
   */
  const blockedInitiative = (initiativeId: string): boolean =>
    blockedAtOrBelow(
      initiativeId,
      (wsByInitiative.get(initiativeId) ?? []).map((w) => w.id),
      blockedIds,
    )

  const obsFor = new Map<string, (typeof obs)[number]>()
  for (const o of obs) {
    const key = `${o.entityType}:${o.entityId}`
    if (!obsFor.has(key)) obsFor.set(key, o)
  }

  /** Every id at or beneath one entity — what its rollups count over. */
  function scope(lv: Level, id: string): { initiatives: string[]; projects: string[] } {
    if (lv === 'project') return { initiatives: [], projects: [id] }
    if (lv === 'initiative') return { initiatives: [id], projects: (wsByInitiative.get(id) ?? []).map((w) => w.id) }
    const kids = projByObjective.get(id) ?? []
    return {
      initiatives: kids.map((p) => p.id),
      projects: kids.flatMap((p) => (wsByInitiative.get(p.id) ?? []).map((w) => w.id)),
    }
  }

  const rows: Array<{
    id: string
    name: string
    ownerId: string | null
    startDate: Date | null
    status: string
    /** The hand-arranged position, for sort=custom. */
    rank: number
  }> =
    level === 'objective'
      ? inits.map((i) => ({ id: i.id, name: i.name, ownerId: i.ownerId, startDate: i.startDate, status: i.status, rank: i.sortOrder }))
      : level === 'initiative'
        ? projs.map((p) => ({ id: p.id, name: p.name, ownerId: p.ownerId, startDate: p.startDate, status: p.status, rank: p.sortOrder }))
        : wss.map((w) => ({ id: w.id, name: w.name, ownerId: w.leadId, startDate: w.startDate, status: w.status, rank: w.sortOrder }))

  const cards: HomeCard[] = rows
    .filter((r) => !ENDED.has(r.status))
    .map((r) => {
      const sc = scope(level, r.id)
      const allIds = new Set<string>([r.id, ...sc.initiatives, ...sc.projects])

      const mine = ms.filter((m) => allIds.has(m.entityId))
      const own = ms.filter((m) => m.level === level && m.entityId === r.id)
      // Its own milestones if it has any; otherwise the ones underneath, so an
      // objective with nothing authored still shows the work's real dates.
      // By date, not by the order somebody arranged them in on the editor —
      // the rail is a run of time, and the first open mark on it is the card's
      // "next milestone". See lib/milestone-order.ts.
      const railSource = byTargetDate(own.length ? own : mine)

      /*
       * Milestones whose date has gone with the work not done.
       *
       * A fact, and the only thing a date can honestly contribute to a health
       * reading. What used to happen here was the reverse: the card measured
       * how much of the calendar had elapsed and called that progress, so a
       * milestone added today on work that began in June opened at 80%.
       */
      const overdueMilestones = railSource.filter(
        (m) => m.status !== 'complete' && m.targetDate !== null && m.targetDate.getTime() < startOfToday,
      ).length

      /*
       * The rail, as a span of time rather than a row of evenly spaced dots.
       *
       * Positions come from the dates, so the gaps mean something; the span
       * runs from the earliest mark to the latest, widened to include today
       * when today falls outside it. Undated milestones cannot be placed and
       * are left off rather than dropped at one end.
       */
      const dated = railSource.filter((m) => m.targetDate !== null).slice(0, 8)
      const stamps = dated.map((m) => m.targetDate!.getTime())
      const railFrom = stamps.length ? Math.min(...stamps, now) : now
      const railTo = stamps.length ? Math.max(...stamps, now) : now
      const railSpan = railTo - railFrom
      const place = (t: number) => (railSpan <= 0 ? 50 : Math.round(((t - railFrom) / railSpan) * 100))

      const rail: MilestoneMark[] = dated.map((m) => ({
        id: m.id,
        name: m.name,
        status: m.status,
        at: place(m.targetDate!.getTime()),
        on: m.targetDate!.toISOString().slice(0, 10),
      }))
      const railToday: RailToday = rail.length ? place(now) : null

      const ob = obsFor.get(`${level}:${r.id}`) ?? null

      // Nothing assessed at this level, but something assessed beneath it.
      //
      // An objective is a grouping; Yaara may not have been asked about it
      // directly, while every initiative inside has a current reading. Showing
      // "No assessment yet" there is technically true and useless - the
      // information exists, one tier down. So the card borrows it, newest
      // first, and says where it came from.
      const kids = ob
        ? []
        : [...sc.initiatives, ...sc.projects]
            .map((id) => obsFor.get(`initiative:${id}`) ?? obsFor.get(`project:${id}`) ?? null)
            .filter((o): o is NonNullable<typeof o> => Boolean(o))
            .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime())

      const source = ob ?? kids[0] ?? null
      const rolledUp = !ob && kids.length > 0

      const recent = rolledUp
        ? kids.flatMap((k) =>
            parse<Array<{ text: string; at: string | null; source: string | null }>>(k.recent, []),
          )
        : parse<Array<{ text: string; at: string | null; source: string | null }>>(ob?.recent ?? null, [])

      // Every child's bullets, newest child first. The detail panel shows
      // them all; the one-line summary is chosen below.
      const items = rolledUp
        ? kids.flatMap((k) => parse<Array<{ text: string; kind: string }>>(k.items, []))
        : parse<Array<{ text: string; kind: string }>>(ob?.items ?? null, [])

      const ev = rolledUp
        ? kids.flatMap((k) =>
            parse<Array<{ source: string; title: string; url: string | null }>>(k.evidence, []),
          )
        : parse<Array<{ source: string; title: string; url: string | null }>>(ob?.evidence ?? null, [])

      const openDecs = decs.filter((d) => allIds.has(d.entityId ?? '') && d.status !== 'resolved' && d.status !== 'closed')
      const blockers = openDecs.filter((d) => d.kind === 'blocker')
      const decisionsOpen = decs.filter((d) => allIds.has(d.entityId ?? '') && d.kind === 'decision').slice(0, 4)
      const myActionIds = new Set(links.filter((l) => allIds.has(l.entityId)).map((l) => l.actionItemId))
      const myActions = acts.filter((a) => myActionIds.has(a.id))

      // Rolled-up activity is the sum of the children's: an objective whose
      // five initiatives each had a busy week is a busy objective, and taking
      // only the newest child's score would call it quiet.
      const activityScore = rolledUp
        ? kids.reduce((n, k) => n + (k.activityScore ?? 0), 0)
        : (ob?.activityScore ?? 0)

      /*
       * Where a signal's link points.
       *
       * Every count on a card rolls up — "11 blockers" on an objective is
       * eleven across everything beneath it — so the link has to carry which
       * card it came from, and the page it lands on has to filter by the same
       * set. `/decisions?ref=…` did neither: blockers and decisions now have
       * a page each, and neither page read `ref`, so the link 404ed and the
       * actions link opened the whole board. See lib/hierarchy.ts.
       */
      const from = formatScope(level, r.id)

      const signals: Signal[] = []
      if (blockers.length) {
        signals.push({
          kind: 'blocker',
          summary:
            blockers.length === 1
              ? blockers[0]!.title
              : `${blockers.length} blockers, oldest open ${Math.max(
                  ...blockers.map((b) => Math.round((now - (b.raisedAt?.getTime() ?? now)) / DAY)),
                )} days`,
          items: blockers.slice(0, 6).map((b) => ({
            id: b.id,
            text: b.title,
            when: b.raisedAt ? `${Math.round((now - b.raisedAt.getTime()) / DAY)}d` : '',
            who: b.raisedByText ?? null,
            href: `/blockers?scope=${from}`,
          })),
        })
      }
      if (decisionsOpen.length) {
        signals.push({
          kind: 'decision',
          summary: decisionsOpen.length === 1 ? decisionsOpen[0]!.title : `${decisionsOpen.length} decisions recorded`,
          items: decisionsOpen.map((d) => ({
            id: d.id,
            text: d.title,
            when: d.raisedAt ? d.raisedAt.toISOString().slice(0, 10) : '',
            who: null,
            href: `/decisions?scope=${from}`,
          })),
        })
      }
      if (myActions.length) {
        const soon = myActions.filter((a) => a.dueDate && a.dueDate.getTime() - now < 7 * DAY).length
        signals.push({
          kind: 'action',
          summary:
            myActions.length === 1
              ? myActions[0]!.text
              : `${myActions.length} open actions${soon ? `, ${soon} due this week` : ''}`,
          items: myActions.slice(0, 6).map((a) => ({
            id: a.id,
            text: a.text,
            when: a.dueDate ? a.dueDate.toISOString().slice(0, 10) : '—',
            who: a.ownerId ? (personName.get(a.ownerId) ?? null) : a.ownerName,
            href: `/actions?scope=${from}`,
          })),
        })
      }

      // The tier directly beneath, by status. A project has no tier below
      // it that carries a lifecycle status, so it shows its milestones.
      const below: MixMember[] =
        level === 'objective'
          ? (projByObjective.get(r.id) ?? []).map((p) => ({
              id: p.id,
              name: p.name,
              status: p.status,
              href: `/initiatives/${p.id}`,
            }))
          : level === 'initiative'
            ? (wsByInitiative.get(r.id) ?? []).map((w) => ({
                id: w.id,
                name: w.name,
                status: w.status,
                href: `/projects/${w.id}`,
              }))
            : own.map((m) => ({
                id: m.id,
                name: m.name,
                status: m.status,
                href: `/projects/${r.id}`,
              }))

      // In-progress work splits on whether anything is standing in its way.
      // `blockedIds` is every entity carrying an open blocker, computed once
      // for the whole board rather than per card.
      //
      // "In its way" means anywhere at or beneath it, which is the fix for a
      // bar that read 6 initiatives on track under an objective flagged Blocked
      // with fourteen open blockers. Blockers are filed against the project
      // where the work is stuck, almost never against the initiative above it, so
      // asking only whether the initiative row itself carried one made an initiative
      // look fine while everything inside it was jammed — and it made the two
      // halves of the same card disagree in public.
      const byStatus = new Map<string, MixMember[]>()
      for (const b of below as Array<MixMember & { status: string }>) {
        const stuck = level === 'objective' ? blockedInitiative(b.id) : blockedIds.has(b.id)
        const key = isInProgress(b.status)
          ? stuck
            ? IN_PROGRESS_BLOCKED
            : IN_PROGRESS_OK
          : b.status
        byStatus.set(key, [...(byStatus.get(key) ?? []), { id: b.id, name: b.name, href: b.href }])
      }
      const mix: MixGroup[] = [...byStatus.entries()]
        .map(([status, members]) => ({ status, label: statusLabel(status), members }))
        .sort((a, b) => mixRank(a.status) - mixRank(b.status))

      /*
       * The card's health, from things that are true. See lib/card-health.ts
       * for why there is no percentage any more.
       *
       * Every count here is the same one another part of the card already
       * shows — the blockers are the signals panel's blockers, the children
       * in trouble are the mix bar's blocked segment — so the parts of a card
       * cannot contradict each other.
       */
      const troubled = [...byStatus.entries()]
        .filter(([status]) => status === IN_PROGRESS_BLOCKED)
        .reduce((n, [, members]) => n + members.length, 0)

      const lastEvent = recent
        .map((e) => (e.at ? Date.parse(e.at) : NaN))
        .filter((t) => Number.isFinite(t))
        .reduce((a, b) => Math.max(a, b), 0)
      // Yaara's own last look is a fallback, not the measure: she may have
      // read the room yesterday and found nothing happening for a month.
      const lastSeen = lastEvent > 0 ? lastEvent : (source?.generatedAt.getTime() ?? 0)

      const assessed = cardHealth({
        blockers: blockers.length,
        oldestBlockerDays: blockers.length
          ? Math.max(...blockers.map((b) => Math.round((now - (b.raisedAt?.getTime() ?? now)) / DAY)))
          : null,
        lateDependencies: [...allIds].filter((id) => late.has(id)).length,
        overdueMilestones,
        troubledChildren: troubled,
        totalChildren: below.length,
        daysSinceActivity: lastSeen > 0 ? Math.round((now - lastSeen) / DAY) : null,
      })

      const beneath =
        level === 'objective'
          ? `${plural(sc.initiatives.length, 'initiative')} · ${plural(sc.projects.length, 'project')}`
          : level === 'initiative'
            ? `${plural(sc.projects.length, 'project')} · ${plural(mine.length, 'milestone')}`
            : plural(own.length, 'milestone')

      return {
        id: r.id,
        level,
        name: r.name,
        owner: r.ownerId ? (personName.get(r.ownerId) ?? null) : null,
        beneath,
        health: assessed.health,
        reasons: assessed.reasons,
        // Her synthesis if she wrote one, then a child's, and only then the
        // first bullet. That last fallback is why an entity with four updates
        // used to show one of them as though it were the summary.
        verdict: ob?.verdict ?? kids.find((k) => k.verdict)?.verdict ?? items[0]?.text ?? null,
        verdictBy: source?.verdictBy ?? source?.agent ?? null,
        verdictAt: source?.verdictAt ?? source?.generatedAt ?? null,
        verdictEditedBy: ob?.verdictBy ?? null,
        verdictRolledUp: rolledUp
          ? `${kids.length} ${level === 'objective' ? 'initiative' : 'project'}${kids.length === 1 ? '' : 's'}`
          : null,
        detail: dedupe(items.map((i) => i.text)).slice(0, 6),
        evidence: dedupe(ev.map((e) => `${e.source}\u0000${e.title}\u0000${e.url ?? ''}`))
          .slice(0, 8)
          .map((k) => {
            const [source2, text, url] = k.split('\u0000')
            return { source: source2!, text: text!, url: url || null }
          }),
        rail,
        railToday,
        signals,
        mix,
        // What happened per week over the last eight, not the score repeated
        // eight times — which is what this was, and why every card on the
        // board drew an identical block of bars. See lib/activity-series.ts.
        activity: activitySeries(recent, new Date(now)),
        activityDelta: activityScore > 0 ? `${Math.round(activityScore)}` : '0',
        href:
          level === 'objective' ? `/objectives/${r.id}` : level === 'initiative' ? `/initiatives/${r.id}` : `/projects/${r.id}`,
      }
    })

  // "Blocked" is crit OR warn, not crit alone. A card one bad week from
  // missing its date is what somebody filtering for trouble is looking for,
  // and a filter that showed only the already-failed would hide exactly the
  // work still worth intervening in. "On track" is good only: quiet is not a
  // shade of green, which is the whole reason it is a separate state.
  const wanted =
    health === 'all'
      ? cards
      : health === 'good'
        ? cards.filter((c) => c.health === 'good')
        : cards.filter((c) => c.health === 'crit' || c.health === 'warn')

  const busy = (c: HomeCard) => c.activity.reduce((x, y) => x + y, 0)

  // Most active first by default. A silent piece of work sinks and is
  // flagged, rather than sitting at the top because its name starts with A.
  //
  // Custom is this reader's own arrangement, if they have one. Two things it
  // has to get right, and both are about a board that has changed since they
  // last dragged it:
  //
  //   - a card they have never placed goes to the END, not to position zero.
  //     A new initiative appearing silently at the top of somebody's hand-made
  //     order would look like the app had rearranged their board.
  //   - a card in their saved list that no longer exists is simply absent;
  //     the ones after it keep their relative order.
  //
  // With no saved arrangement at all, it falls back to `sort_order` — the
  // column that has always carried "the order these read in" — so Custom
  // opens as something to rearrange rather than as an empty-looking board.
  const rank = new Map(rows.map((r) => [r.id, r.rank]))
  const mine = sort === 'custom' ? await getCardOrder(level) : null
  const placed = new Map(mine?.map((id, ix) => [id, ix]))
  const customRank = (c: HomeCard) => (mine ? (placed.get(c.id) ?? Number.MAX_SAFE_INTEGER) : (rank.get(c.id) ?? 0))

  return wanted.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'quiet') return busy(a) - busy(b) || a.name.localeCompare(b.name)
    // The name tiebreak matters for the unplaced ones, which all share the
    // same rank: without it their order among themselves is whatever the
    // database happened to return.
    if (sort === 'custom') return customRank(a) - customRank(b) || a.name.localeCompare(b.name)
    return busy(b) - busy(a) || a.name.localeCompare(b.name)
  })
})

/** Initiatives with no objective above them — named, not hidden. */
export const getUngrouped = cache(async () => {
  const rows = await db
    .select({ id: initiatives.id, name: initiatives.name, status: initiatives.status })
    .from(initiatives)
    .where(or(isNull(initiatives.objectiveId), eq(initiatives.objectiveId, '')))

  const counts = await db.select({ id: projects.id, initiativeId: projects.initiativeId }).from(projects)
  return rows
    .filter((r) => !ENDED.has(r.status))
    .map((r) => ({ ...r, projects: counts.filter((c) => c.initiativeId === r.id).length }))
})

/** Where a number on the home page came from — for the provenance panel. */
export const getProvenance = cache(async (level: Level, id: string) => {
  const ob = await db
    .select()
    .from(agentObservations)
    .where(and(eq(agentObservations.entityType, level), eq(agentObservations.entityId, id), isNull(agentObservations.supersededAt)))
    .orderBy(desc(agentObservations.generatedAt))
    .limit(1)

  const row = ob[0]
  return {
    generatedAt: row?.generatedAt ?? null,
    model: row?.model ?? null,
    agent: row?.agent ?? null,
    evidence: parse<Array<{ source: string; title: string; url: string | null; occurredAt: string | null }>>(
      row?.evidence ?? null,
      [],
    ),
    recent: parse<Array<{ text: string; at: string | null; source: string | null }>>(row?.recent ?? null, []),
    activityScore: row?.activityScore ?? null,
    activityWindowHours: row?.activityWindowHours ?? null,
  }
})

export async function idsInScope(level: Level, id: string): Promise<string[]> {
  if (level === 'project') return [id]
  if (level === 'initiative') {
    const ws = await db.select({ id: projects.id }).from(projects).where(eq(projects.initiativeId, id))
    return [id, ...ws.map((w) => w.id)]
  }
  const pj = await db.select({ id: initiatives.id }).from(initiatives).where(eq(initiatives.objectiveId, id))
  const ids = pj.map((p) => p.id)
  const ws = ids.length
    ? await db.select({ id: projects.id }).from(projects).where(inArray(projects.initiativeId, ids))
    : []
  return [id, ...ids, ...ws.map((w) => w.id)]
}
