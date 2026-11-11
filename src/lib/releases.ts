/**
 * The Release Calendar's store (Scott, 11 November 2026): what Yaara sends
 * each pass, what has been announced, and the calendar's read of it with the
 * links into the portfolio. The rules are lib/release-rules.ts.
 *
 * Linear is the record for the ticket itself; this keeps what the calendar
 * and the announcements need, and the one thing Linear cannot know: what was
 * last said about it in Slack.
 */
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { initiatives, objectives, projects, releases, sourceRecords } from '@/db/schema'
import { logChange } from './portfolio'
import { announceFor, announceKey, previousDate, type Announce, type IncomingRelease } from './release-rules'

export interface ReleaseLinks {
  project: { id: string; name: string } | null
  /** The initiative the project sits under, between it and the objective (Scott, 11 November 2026). */
  initiative: { id: string; name: string } | null
  objective: { id: string; name: string } | null
}

/** What the route tells Yaara about one release she sent. */
export interface ReleaseOutcome {
  linearId: string
  identifier: string
  /** Post it: first seen, or its date moved since the last post. */
  announce: Announce
  /** The date announced before, when it moved. */
  previousDate: string | null
  links: ReleaseLinks
}

/** The portfolio project behind a Linear project, and the initiative and objective it sits under. */
async function linksFor(linearProjectIds: string[]): Promise<Map<string, ReleaseLinks>> {
  const out = new Map<string, ReleaseLinks>()
  const ids = [...new Set(linearProjectIds)]
  if (!ids.length) return out
  const recs = await db
    .select({ externalId: sourceRecords.externalId, entityId: sourceRecords.entityId })
    .from(sourceRecords)
    .where(and(eq(sourceRecords.system, 'linear'), eq(sourceRecords.entityType, 'project'), inArray(sourceRecords.externalId, ids)))
  if (!recs.length) return out
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      initiativeId: initiatives.id,
      initiativeName: initiatives.name,
      objectiveId: initiatives.objectiveId,
      objectiveName: objectives.name,
    })
    .from(projects)
    .leftJoin(initiatives, eq(initiatives.id, projects.initiativeId))
    .leftJoin(objectives, eq(objectives.id, initiatives.objectiveId))
    .where(inArray(projects.id, recs.map((r) => r.entityId)))
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const r of recs) {
    const p = byId.get(r.entityId)
    if (!p) continue
    out.set(r.externalId, {
      project: { id: p.id, name: p.name },
      initiative: p.initiativeId && p.initiativeName ? { id: p.initiativeId, name: p.initiativeName } : null,
      objective: p.objectiveId && p.objectiveName ? { id: p.objectiveId, name: p.objectiveName } : null,
    })
  }
  return out
}

const NO_LINKS: ReleaseLinks = { project: null, initiative: null, objective: null }

/**
 * Store what Yaara read this pass. `complete` says the list is every release
 * there is: anything not in it is no longer one (unlabelled, deleted) and is
 * hidden from the calendar. Returns what to announce.
 */
export async function saveReleases(list: IncomingRelease[], complete: boolean): Promise<{ outcomes: ReleaseOutcome[]; removed: number }> {
  const existing = list.length ? await db.select().from(releases).where(inArray(releases.linearId, list.map((r) => r.linearId))) : []
  const before = new Map(existing.map((r) => [r.linearId, r]))
  const links = await linksFor(list.flatMap((r) => (r.projectLinearId ? [r.projectLinearId] : [])))
  const now = new Date()
  const outcomes: ReleaseOutcome[] = []

  for (const r of list) {
    const prior = before.get(r.linearId) ?? null
    const values = {
      identifier: r.identifier,
      title: r.title,
      description: r.description,
      url: r.url,
      targetDate: r.targetDate,
      targetDateFrom: r.targetDateFrom,
      status: r.status,
      statusType: r.statusType,
      createdBy: r.createdBy,
      assignee: r.assignee,
      projectLinearId: r.projectLinearId,
      projectName: r.projectName,
      projectLead: r.projectLead,
      teamsImpacted: JSON.stringify(r.teamsImpacted),
      contactName: r.contactName,
      contactSlackUrl: r.contactSlackUrl,
      removedAt: null,
      updatedAt: now,
    }
    await db
      .insert(releases)
      .values({ linearId: r.linearId, ...values })
      .onConflictDoUpdate({ target: releases.linearId, set: values })
    if (!prior) {
      await logChange({ actor: 'Yaara', kind: 'release', summary: `Release ${r.identifier} on the calendar: ${r.title}${r.targetDate ? ` (${r.targetDate})` : ''}` })
    } else if (prior.targetDate !== r.targetDate) {
      await logChange({ actor: 'Yaara', kind: 'release', summary: `Release ${r.identifier} moved: ${prior.targetDate ?? 'no date'} → ${r.targetDate ?? 'no date'}` })
    }
    outcomes.push({
      linearId: r.linearId,
      identifier: r.identifier,
      announce: announceFor(prior, r),
      previousDate: previousDate(prior),
      links: (r.projectLinearId && links.get(r.projectLinearId)) || NO_LINKS,
    })
  }

  let removed = 0
  if (complete) {
    const gone = await db
      .update(releases)
      .set({ removedAt: now })
      .where(and(isNull(releases.removedAt), list.length ? notInArray(releases.linearId, list.map((r) => r.linearId)) : undefined))
      .returning({ identifier: releases.identifier })
    removed = gone.length
    for (const g of gone) await logChange({ actor: 'Yaara', kind: 'release', summary: `Release ${g.identifier} is no longer labelled a release; off the calendar` })
  }
  return { outcomes, removed }
}

/** Yaara posted these: record the date each post announced, so it is not posted again. */
export async function markAnnounced(posted: { linearId: string; targetDate: string | null }[]): Promise<number> {
  let n = 0
  for (const p of posted) {
    const done = await db
      .update(releases)
      .set({ announcedKey: announceKey(p.targetDate), announcedAt: new Date() })
      .where(eq(releases.linearId, p.linearId))
      .returning({ id: releases.linearId })
    n += done.length
  }
  return n
}

export interface CalendarRelease {
  linearId: string
  identifier: string
  title: string
  description: string | null
  url: string | null
  targetDate: string | null
  /** "project" when the ticket had no date and its project's stands in. */
  targetDateFrom: string | null
  status: string | null
  statusType: string | null
  createdBy: string | null
  assignee: string | null
  projectName: string | null
  projectLead: string | null
  teamsImpacted: string[]
  contactName: string | null
  contactSlackUrl: string | null
  links: ReleaseLinks
}

/** Every release on the calendar, with its links into the portfolio. */
export async function readCalendar(): Promise<CalendarRelease[]> {
  const rows = await db.select().from(releases).where(isNull(releases.removedAt))
  const links = await linksFor(rows.flatMap((r) => (r.projectLinearId ? [r.projectLinearId] : [])))
  return rows
    .map((r) => {
      let teams: string[] = []
      try {
        const v = JSON.parse(r.teamsImpacted) as unknown
        if (Array.isArray(v)) teams = v.map(String)
      } catch {
        teams = []
      }
      return {
        linearId: r.linearId,
        identifier: r.identifier,
        title: r.title,
        description: r.description,
        url: r.url,
        targetDate: r.targetDate,
        targetDateFrom: r.targetDateFrom,
        status: r.status,
        statusType: r.statusType,
        createdBy: r.createdBy,
        assignee: r.assignee,
        projectName: r.projectName,
        projectLead: r.projectLead,
        teamsImpacted: teams,
        contactName: r.contactName,
        contactSlackUrl: r.contactSlackUrl,
        links: (r.projectLinearId && links.get(r.projectLinearId)) || NO_LINKS,
      }
    })
    .sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') || a.identifier.localeCompare(b.identifier))
}
