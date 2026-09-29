/**
 * The portfolio read model.
 *
 * Every view in the app reads from here rather than querying tables directly,
 * so the rules that matter — assessment beats source health, overrides beat
 * synced values, an unassessed thing is `unknown` and not green — are applied
 * in exactly one place.
 */
import { cache } from 'react'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  allocations,
  appAreas,
  assessments,
  changelogEntries,
  decisionEvents,
  decisions,
  dependencies,
  entityThemes,
  projects,
  intakeRequests,
  milestones,
  people,
  workstreams,
  sourceRecords,
  syncRuns,
  teams,
  themes,
  milestoneItems,
  milestonePhases,
} from '@/db/schema'
import { loadOverrides, applyOverrides, type OverrideMap } from './overrides'
import { rollUpWindow } from './rollup-window'
import { resolveHealth, type Rag, type ResolvedHealth } from './domain'

export type Row<T> = T extends { $inferSelect: infer S } ? S : never

export type TeamRow = typeof teams.$inferSelect
export type PersonRow = typeof people.$inferSelect
export type ThemeRow = typeof themes.$inferSelect
export type AppAreaRow = typeof appAreas.$inferSelect
export type MilestoneRow = typeof milestones.$inferSelect
export type DecisionRow = typeof decisions.$inferSelect
export type DependencyRow = typeof dependencies.$inferSelect
export type AllocationRow = typeof allocations.$inferSelect
export type IntakeRow = typeof intakeRequests.$inferSelect

export interface WorkstreamView extends Omit<typeof workstreams.$inferSelect, never> {
  health: ResolvedHealth
  lead: PersonRow | null
  team: TeamRow | null
  appArea: AppAreaRow | null
  milestones: MilestoneRow[]
  /** Fields whose displayed value came from a human, not the source. */
  overridden: string[]
  sourceValues: Record<string, unknown>
  sources: { system: string; url: string | null }[]
}

export interface ProjectView extends Omit<typeof projects.$inferSelect, never> {
  health: ResolvedHealth
  owner: PersonRow | null
  sponsor: PersonRow | null
  theme: ThemeRow | null
  workstreams: WorkstreamView[]
  overridden: string[]
  sourceValues: Record<string, unknown>
  sources: { system: string; url: string | null }[]
  /** Rolled up from workstreams when the project itself has no dates. */
  derivedStart: Date | null
  derivedTarget: Date | null
}

export interface Portfolio {
  themes: ThemeRow[]
  appAreas: AppAreaRow[]
  teams: TeamRow[]
  people: PersonRow[]
  projects: ProjectView[]
  workstreams: WorkstreamView[]
  allocations: AllocationRow[]
  dependencies: DependencyRow[]
  decisions: DecisionRow[]
  milestones: (MilestoneRow & { workstream: WorkstreamView })[]
  lastSync: (typeof syncRuns.$inferSelect) | null
}

const PROJECT_DATE_FIELDS = ['startDate', 'targetDate', 'startedAt', 'completedAt'] as const
const INITIATIVE_DATE_FIELDS = ['startDate', 'targetDate'] as const

/** Current assessments for a set of entities, keyed `type:id`. */
async function loadAssessments(entityType: string, ids: string[]) {
  const map = new Map<string, typeof assessments.$inferSelect>()
  if (ids.length === 0) return map
  const rows = await db
    .select()
    .from(assessments)
    .where(
      and(
        eq(assessments.entityType, entityType),
        inArray(assessments.entityId, ids),
        eq(assessments.current, true),
      ),
    )
    .orderBy(desc(assessments.asOf))
  for (const r of rows) if (!map.has(r.entityId)) map.set(r.entityId, r)
  return map
}

async function loadSources(entityType: string, ids: string[]) {
  const map = new Map<string, { system: string; url: string | null }[]>()
  if (ids.length === 0) return map
  const rows = await db
    .select({
      entityId: sourceRecords.entityId,
      system: sourceRecords.system,
      url: sourceRecords.url,
    })
    .from(sourceRecords)
    .where(and(eq(sourceRecords.entityType, entityType), inArray(sourceRecords.entityId, ids)))
  for (const r of rows) {
    if (!map.has(r.entityId)) map.set(r.entityId, [])
    map.get(r.entityId)!.push({ system: r.system, url: r.url })
  }
  return map
}

function mergeProject(
  row: typeof workstreams.$inferSelect,
  ctx: {
    overrides: OverrideMap
    assessment?: typeof assessments.$inferSelect
    peopleById: Map<string, PersonRow>
    teamsById: Map<string, TeamRow>
    areasById: Map<string, AppAreaRow>
    milestonesByProject: Map<string, MilestoneRow[]>
    sources: { system: string; url: string | null }[]
  },
): WorkstreamView {
  const merged = applyOverrides(row, 'workstream', ctx.overrides, PROJECT_DATE_FIELDS)
  const v = merged.value
  return {
    ...v,
    health: resolveHealth({ sourceHealth: v.sourceHealth, assessment: ctx.assessment ?? null }),
    lead: v.leadId ? (ctx.peopleById.get(v.leadId) ?? null) : null,
    team: v.teamId ? (ctx.teamsById.get(v.teamId) ?? null) : null,
    appArea: v.appAreaId ? (ctx.areasById.get(v.appAreaId) ?? null) : null,
    milestones: ctx.milestonesByProject.get(v.id) ?? [],
    overridden: [...merged.overridden],
    sourceValues: merged.sourceValues,
    sources: ctx.sources,
  }
}

/**
 * Loads the whole portfolio. Cached per request, so a page that renders five
 * views costs one set of queries rather than five.
 *
 * The portfolio is deliberately small data — hundreds of workstreams, not
 * millions of rows — so loading it whole and shaping it in memory is both
 * faster and far easier to reason about than per-view SQL.
 */
export const getPortfolio = cache(async (): Promise<Portfolio> => {
  const [
    themeRows,
    areaRows,
    teamRows,
    personRows,
    initiativeRows,
    projectRows,
    milestoneRows,
    allocationRows,
    dependencyRows,
    decisionRows,
    lastSyncRows,
  ] = await Promise.all([
    db.select().from(themes).orderBy(themes.sortOrder),
    db.select().from(appAreas).orderBy(appAreas.sortOrder),
    db.select().from(teams).orderBy(teams.name),
    db.select().from(people).orderBy(people.name),
    db.select().from(projects).orderBy(projects.sortOrder, projects.name),
    db.select().from(workstreams).orderBy(workstreams.sortOrder, workstreams.name),
    db.select().from(milestones).orderBy(milestones.targetDate),
    db.select().from(allocations),
    db.select().from(dependencies),
    db.select().from(decisions).orderBy(decisions.ref),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1),
  ])

  const workstreamId = projectRows.map((p) => p.id)
  const projectId = initiativeRows.map((i) => i.id)

  const [
    projectOverrides,
    initiativeOverrides,
    projectAssessments,
    initiativeAssessments,
    projectSources,
    initiativeSources,
  ] = await Promise.all([
    loadOverrides('workstream', workstreamId),
    loadOverrides('project', projectId),
    loadAssessments('workstream', workstreamId),
    loadAssessments('project', projectId),
    loadSources('workstream', workstreamId),
    loadSources('project', projectId),
  ])

  const peopleById = new Map(personRows.map((p) => [p.id, p]))
  const teamsById = new Map(teamRows.map((t) => [t.id, t]))
  const areasById = new Map(areaRows.map((a) => [a.id, a]))
  const themesById = new Map(themeRows.map((t) => [t.id, t]))

  const milestonesByProject = new Map<string, MilestoneRow[]>()
  for (const m of milestoneRows) {
    if (!milestonesByProject.has(m.entityId)) milestonesByProject.set(m.entityId, [])
    milestonesByProject.get(m.entityId)!.push(m)
  }

  const projectViews = projectRows.map((row) =>
    mergeProject(row, {
      overrides: projectOverrides,
      assessment: projectAssessments.get(row.id),
      peopleById,
      teamsById,
      areasById,
      milestonesByProject,
      sources: projectSources.get(row.id) ?? [],
    }),
  )
  const projectsByInitiative = new Map<string, WorkstreamView[]>()
  for (const p of projectViews) {
    if (!p.projectId) continue
    if (!projectsByInitiative.has(p.projectId)) projectsByInitiative.set(p.projectId, [])
    projectsByInitiative.get(p.projectId)!.push(p)
  }

  const initiativeViews: ProjectView[] = initiativeRows.map((row) => {
    const merged = applyOverrides(row, 'project', initiativeOverrides, INITIATIVE_DATE_FIELDS)
    const v = merged.value
    const kids = projectsByInitiative.get(v.id) ?? []
    /*
     * Everything dated underneath, not just the children's own dates.
     *
     * A project whose workstreams carry no dates but whose milestones do was
     * reading as undated — which on a chart is indistinguishable from work
     * nobody has planned. And the roll-up counts ENDED children too: a window
     * is a fact about the work, not about which rows a screen is currently
     * listing. See lib/rollup-window.ts, which the timeline uses as well, so
     * the two cannot drift apart again.
     */
    const beneath: Array<Date | null> = [
      ...kids.flatMap((k) => [k.startDate, k.targetDate]),
      ...kids.flatMap((k) => (milestonesByProject.get(k.id) ?? []).map((m) => m.targetDate)),
      ...(milestonesByProject.get(v.id) ?? []).map((m) => m.targetDate),
    ]
    const window = rollUpWindow({ startDate: v.startDate, targetDate: v.targetDate }, beneath)
    return {
      ...v,
      health: resolveHealth({
        sourceHealth: v.sourceHealth,
        assessment: initiativeAssessments.get(v.id) ?? null,
      }),
      owner: v.ownerId ? (peopleById.get(v.ownerId) ?? null) : null,
      sponsor: v.sponsorId ? (peopleById.get(v.sponsorId) ?? null) : null,
      theme: v.themeId ? (themesById.get(v.themeId) ?? null) : null,
      workstreams: kids,
      overridden: [...merged.overridden],
      sourceValues: merged.sourceValues,
      sources: initiativeSources.get(v.id) ?? [],
      // Only the rolled-up halves: `derivedX` means "nobody typed this", and
      // the callers show a "rolled up" badge off exactly that.
      derivedStart: v.startDate ? null : window.start,
      derivedTarget: v.targetDate ? null : window.end,
    }
  })

  const projectById = new Map(projectViews.map((p) => [p.id, p]))

  return {
    themes: themeRows,
    appAreas: areaRows,
    teams: teamRows,
    people: personRows,
    projects: initiativeViews,
    workstreams: projectViews,
    allocations: allocationRows,
    dependencies: dependencyRows,
    decisions: decisionRows,
    milestones: milestoneRows
      .map((m) => ({ ...m, workstream: projectById.get(m.entityId)! }))
      .filter((m) => m.workstream),
    lastSync: lastSyncRows[0] ?? null,
  }
})

// ---------------------------------------------------------------------------
// Derived signals — the things a control room exists to surface
// ---------------------------------------------------------------------------

export interface PersonLoad {
  person: PersonRow
  team: TeamRow | null
  /** Distinct in-flight workstreams this person leads. */
  workstreams: WorkstreamView[]
  /** Distinct projects those workstreams roll up to. */
  initiativeCount: number
  /** Workstreams with a target date inside the same 45-day window. */
  collisions: WorkstreamView[]
  hot: boolean
}

/**
 * Who is the bottleneck.
 *
 * Counting workstreams alone overstates load — six sequential workstreams are fine.
 * What hurts is several *dated* commitments landing together, so a person is
 * "hot" when they lead three or more active workstreams whose targets cluster, or
 * when a human has flagged them by hand.
 */
export function personLoads(p: Portfolio): PersonLoad[] {
  const active = p.workstreams.filter(
    (pr) => pr.leadId && !['completed', 'canceled'].includes(pr.status),
  )
  const byPerson = new Map<string, WorkstreamView[]>()
  for (const pr of active) {
    if (!byPerson.has(pr.leadId!)) byPerson.set(pr.leadId!, [])
    byPerson.get(pr.leadId!)!.push(pr)
  }

  const teamsById = new Map(p.teams.map((t) => [t.id, t]))
  const loads: PersonLoad[] = []
  for (const person of p.people) {
    const owned = byPerson.get(person.id) ?? []
    if (owned.length === 0 && !person.bottleneck) continue

    const dated = owned
      .filter((o) => o.targetDate)
      .sort((a, b) => a.targetDate!.getTime() - b.targetDate!.getTime())
    let collisions: WorkstreamView[] = []
    for (let i = 0; i < dated.length; i++) {
      const window = dated.filter(
        (d) =>
          Math.abs(d.targetDate!.getTime() - dated[i].targetDate!.getTime()) <=
          45 * 24 * 60 * 60 * 1000,
      )
      if (window.length > collisions.length) collisions = window
    }

    loads.push({
      person,
      team: person.teamId ? (teamsById.get(person.teamId) ?? null) : null,
      workstreams: owned,
      initiativeCount: new Set(owned.map((o) => o.projectId).filter(Boolean)).size,
      collisions: collisions.length > 1 ? collisions : [],
      hot: person.bottleneck || owned.length >= 3 || collisions.length >= 2,
    })
  }

  return loads.sort((a, b) => {
    if (a.hot !== b.hot) return a.hot ? -1 : 1
    return b.workstreams.length - a.workstreams.length
  })
}

export interface Gap {
  kind: 'no_owner' | 'no_assessment' | 'no_dates' | 'no_projects' | 'stale_assessment'
  entityType: 'project' | 'workstream'
  id: string
  name: string
  detail: string
}

const STALE_DAYS = 21

/**
 * The "who owes me an update" list.
 *
 * Making absence visible is most of the value of a portfolio tool: an
 * project with no owner and a project that's merely quiet look identical
 * on a roadmap, and only one of them is a problem you can act on today.
 */
export function gaps(p: Portfolio, now = new Date()): Gap[] {
  const out: Gap[] = []

  for (const i of p.projects) {
    if (['completed', 'canceled'].includes(i.status)) continue
    if (!i.ownerId || i.ownerGap) {
      out.push({
        kind: 'no_owner',
        entityType: 'project',
        id: i.id,
        name: i.name,
        detail: 'No project owner set',
      })
    }
    if (i.health.origin === 'none') {
      out.push({
        kind: 'no_assessment',
        entityType: 'project',
        id: i.id,
        name: i.name,
        detail: 'No health assessment and the source has none either',
      })
    } else if (i.health.origin === 'assessed' && i.health.asOf) {
      const days = Math.floor((now.getTime() - i.health.asOf.getTime()) / 86_400_000)
      if (days > STALE_DAYS) {
        out.push({
          kind: 'stale_assessment',
          entityType: 'project',
          id: i.id,
          name: i.name,
          detail: `Assessment is ${days} days old`,
        })
      }
    }
    if (i.workstreams.length === 0) {
      out.push({
        kind: 'no_projects',
        entityType: 'project',
        id: i.id,
        name: i.name,
        detail: 'Strategic project with no delivery workstreams behind it',
      })
    }
    if (!i.targetDate && !i.derivedTarget) {
      out.push({
        kind: 'no_dates',
        entityType: 'project',
        id: i.id,
        name: i.name,
        detail: 'No target date on the project or any of its workstreams',
      })
    }
  }

  for (const pr of p.workstreams) {
    if (['completed', 'canceled'].includes(pr.status)) continue
    if (pr.health.origin === 'none' && pr.status === 'in_progress') {
      out.push({
        kind: 'no_assessment',
        entityType: 'workstream',
        id: pr.id,
        name: pr.name,
        detail: 'In progress with no health on record',
      })
    }
  }

  return out
}

export interface RiskItem {
  id: string
  name: string
  rag: Rag
  why: string
  entityType: 'project' | 'workstream' | 'dependency' | 'milestone'
  targetDate: Date | null
}

/** Everything the portfolio currently considers off-track, in date order. */
export function risks(p: Portfolio, now = new Date()): RiskItem[] {
  const out: RiskItem[] = []

  for (const i of p.projects) {
    if (i.health.rag === 'red' || i.health.rag === 'amber') {
      out.push({
        id: i.id,
        name: i.name,
        rag: i.health.rag,
        why: i.health.rationale ?? 'Assessed off track',
        entityType: 'project',
        targetDate: i.targetDate ?? i.derivedTarget,
      })
    }
  }

  for (const d of p.dependencies) {
    if (d.status === 'at_risk' || (d.status === 'open' && d.criticality === 'critical')) {
      out.push({
        id: d.id,
        name: d.fromLabel ?? labelForEndpoint(p, d.fromType, d.fromId),
        rag: d.status === 'at_risk' ? 'red' : 'amber',
        why: d.description ?? 'Critical open dependency',
        entityType: 'dependency',
        targetDate: d.dueDate,
      })
    }
  }

  for (const m of p.milestones) {
    if (m.status === 'pending' && m.targetDate && m.targetDate < now) {
      out.push({
        id: m.id,
        name: `${m.workstream.name} — ${m.name}`,
        rag: 'red',
        why: 'Milestone date has passed and it is still pending',
        entityType: 'milestone',
        targetDate: m.targetDate,
      })
    }
  }

  return out.sort((a, b) => {
    const at = a.targetDate?.getTime() ?? Number.MAX_SAFE_INTEGER
    const bt = b.targetDate?.getTime() ?? Number.MAX_SAFE_INTEGER
    return at - bt
  })
}

export function labelForEndpoint(p: Portfolio, type: string, id: string): string {
  if (type === 'workstream') return p.workstreams.find((x) => x.id === id)?.name ?? id
  if (type === 'project') return p.projects.find((x) => x.id === id)?.name ?? id
  if (type === 'milestone') {
    const m = p.milestones.find((x) => x.id === id)
    return m ? `${m.workstream.name} — ${m.name}` : id
  }
  return id
}

/** Upcoming portfolio-level dates, for the calendar strip. */
export function upcomingMilestones(p: Portfolio, limit = 12, now = new Date()) {
  return p.milestones
    .filter((m) => m.targetDate && m.status !== 'done')
    .filter((m) => (m.level === 'initiative') || m.contested || (m.targetDate as Date) >= now)
    .sort((a, b) => a.targetDate!.getTime() - b.targetDate!.getTime())
    .slice(0, limit)
}

export async function recentChanges(limit = 40) {
  return db.select().from(changelogEntries).orderBy(desc(changelogEntries.at)).limit(limit)
}

export async function logChange(entry: {
  actor?: string
  kind?: string
  summary: string
  detail?: string | null
  entityType?: string | null
  entityId?: string | null
}) {
  await db.insert(changelogEntries).values({
    actor: entry.actor ?? 'system',
    kind: entry.kind ?? 'change',
    summary: entry.summary,
    detail: entry.detail ?? null,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
  })
}

/**
 * What else is being talked about, newest first.
 *
 * Kept out of `getPortfolio` deliberately: every page pays for that query, and
 * only one screen shows themes. They are also the least load-bearing thing in
 * the database — a record of what came up, not a thing anyone is accountable
 * for — so a page that needs them asks for them.
 */
export async function recentThemes(limit = 24) {
  return db.select().from(entityThemes).orderBy(desc(entityThemes.lastSeenAt)).limit(limit)
}

/**
 * The themes recorded against one piece of work.
 *
 * Themes were only ever shown on the register, which is the wrong place to
 * look them up: somebody wondering what is being talked about on a workstream is
 * on that workstream's page. Recurring discussion that never becomes a decision
 * is exactly the signal worth seeing there, and the register is where you go
 * when you already know what you are chasing.
 */
export async function themesFor(entityType: string, entityId: string) {
  return db
    .select()
    .from(entityThemes)
    .where(and(eq(entityThemes.entityType, entityType), eq(entityThemes.entityId, entityId)))
    .orderBy(desc(entityThemes.lastSeenAt))
    .limit(12)
}

/**
 * One instant for the whole render.
 *
 * "Open 41 days" is computed in two places on the register — once per card and
 * once for the headline figure — and reading the clock separately in each lets
 * them disagree across a tick, which across midnight UTC means the summary says
 * 41 and the card says 42. Cached per request, so every elapsed figure on a
 * page is measured from the same moment.
 */
export const asOf = cache(async (): Promise<Date> => new Date())

/**
 * Days between raising something and resolving it, or to now if it is still
 * live. Null when it was never dated, which is honest: a made-up start makes a
 * blocker look newer or older than it is, and both mislead.
 */
export function daysOpen(
  raisedAt: Date | string | null,
  resolvedAt: Date | string | null,
  now: Date,
): number | null {
  if (!raisedAt) return null
  const from = typeof raisedAt === 'string' ? new Date(raisedAt) : raisedAt
  if (Number.isNaN(from.getTime())) return null
  const to = resolvedAt ? (typeof resolvedAt === 'string' ? new Date(resolvedAt) : resolvedAt) : now
  if (Number.isNaN(to.getTime())) return null
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/**
 * Every recorded mention of an entry in the register, keyed by decision id.
 *
 * The register's whole claim is that what it says can be checked, and the
 * events are where that is kept: what was said, by whom, in which meeting, and
 * who closed it and why. A card that shows a resolution with no reason beside
 * it is the state this exists to prevent.
 */
export async function decisionTrail(): Promise<Map<string, (typeof decisionEvents.$inferSelect)[]>> {
  const rows = await db.select().from(decisionEvents).orderBy(decisionEvents.occurredAt)
  const byDecision = new Map<string, (typeof decisionEvents.$inferSelect)[]>()
  for (const r of rows) {
    const list = byDecision.get(r.decisionId) ?? []
    list.push(r)
    byDecision.set(r.decisionId, list)
  }
  return byDecision
}

/**
 * The program review plan for one workstream.
 *
 * Three tables, assembled in the order the slide reads them, because every
 * caller wants it that way and none of them should have to know there are
 * three.
 */
export async function workstreamsFor(workstreamId: string) {
  const rows = await db
    .select()
    .from(milestones)
    .where(eq(milestones.entityId, workstreamId))
    .orderBy(milestones.sortOrder)

  if (rows.length === 0) return []

  const ids = rows.map((w) => w.id)
  const [items, phases] = await Promise.all([
    db.select().from(milestoneItems).where(inArray(milestoneItems.milestoneId, ids)).orderBy(milestoneItems.sortOrder),
    db.select().from(milestonePhases).where(inArray(milestonePhases.milestoneId, ids)),
  ])

  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    details: w.details,
    status: w.status,
    targetLabel: w.targetLabel,
    dependencies: w.dependencies,
    authoredBy: w.authoredBy,
    agentNote: w.agentNote,
    items: items.filter((i) => i.milestoneId === w.id).map((i) => ({ state: i.state, text: i.text })),
    phases: phases
      .filter((p) => p.milestoneId === w.id)
      .map((p) => ({
        id: p.id,
        phase: p.phase,
        label: p.label,
        fromPeriod: p.fromPeriod,
        toPeriod: p.toPeriod,
      })),
  }))
}
