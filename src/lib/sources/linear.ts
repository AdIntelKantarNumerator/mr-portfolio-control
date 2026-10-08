/**
 * Linear ingestion.
 *
 * Two paths, as designed:
 *   - a paginated GraphQL backfill (`syncLinear`) for the initial load and for
 *     scheduled reconciliation;
 *   - a signature-verified webhook receiver (see app/api/webhooks/linear) for
 *     everything in between.
 *
 * The queries are assembled from a schema introspection rather than hard-coded.
 * Linear's available fields differ by plan and move between API versions
 * (initiatives, project status objects and health have all changed shape), and
 * a hard-coded selection set fails the whole sync on one unknown field. Probing
 * costs one extra request per run and degrades to "we synced what exists".
 */
import { and, eq, or } from 'drizzle-orm'
import { db } from '@/db/client'
import { mergeFromSource } from '@/lib/milestones'
import {
  dependencies,
  initiatives,
  milestones,
  people,
  projects,
  sourceRecords,
  syncRuns,
  teams,
} from '@/db/schema'
import {
  capabilitiesFrom,
  pick,
  shrinkPage,
  probeQuery,
  probeToIntrospection,
  PROBE_TYPES,
  type ProbeResult,
  type LinearCapabilities,
} from './graphql-schema'
import { logChange } from '../portfolio'
import { slugify } from '../util'
import {
  mapInitiativeStatus,
  mapPriority,
  mapProjectStatus,
  milestoneStatusFrom,
  syncedMilestoneStatus,
  normaliseProgress,
  parseLinearDate as date,
} from './linear-map'

const LINEAR_API = 'https://api.linear.app/graphql'

export class LinearError extends Error {}

interface GraphQLResponse<T> {
  data?: T
  errors?: { message: string; extensions?: Record<string, unknown> }[]
}

async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  /**
   * What this query is for, in the words the Activity page uses.
   *
   * A sync sends five different queries and reported a refusal from any of
   * them identically - "Linear returned 400: ... Query too complex". Which one
   * was refused is the whole question when that happens, and the message did
   * not say, so it had to be inferred from which counters were still empty.
   */
  op = 'query',
): Promise<T> {
  // Trimmed, and not only for tidiness. A key that arrives with a trailing
  // newline — which is what happens when one is pasted through a shell, a
  // prompt or a cloud config UI — makes an invalid HTTP header value, and the
  // request is rejected before it reaches the network. The symptom is a
  // "fetch failed" in single-digit milliseconds, which reads like an outage
  // and is nothing of the sort.
  const key = process.env.LINEAR_API_KEY?.trim()
  if (!key) throw new LinearError('LINEAR_API_KEY is not set')
  if (/[^\x20-\x7e]/.test(key)) {
    throw new LinearError(
      'LINEAR_API_KEY contains characters that cannot go in an HTTP header ' +
        '(a newline or control character, usually from a copy-paste). Set it again.',
    )
  }

  let res: Response
  try {
    res = await fetch(LINEAR_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: key },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    /*
     * Node's fetch reports every transport-level problem as the same useless
     * "fetch failed", and puts the real reason — ENOTFOUND, ECONNREFUSED, a
     * TLS failure, a rejected header — in `cause`. Unwrapping it here is the
     * difference between a diagnosable failure and a shrug.
     */
    const cause = (err as { cause?: unknown }).cause
    const detail =
      cause instanceof Error
        ? `${cause.name}: ${cause.message}`
        : cause
          ? String(cause)
          : (err as Error).message
    throw new LinearError(`Could not reach ${LINEAR_API} — ${detail}`)
  }

  if (res.status === 429) {
    const retry = res.headers.get('retry-after')
    throw new LinearError(`Linear rate limit hit on ${op}; retry after ${retry ?? 'unknown'}s`)
  }
  if (!res.ok) throw new LinearError(`Linear returned ${res.status} on ${op}: ${await res.text()}`)

  const body = (await res.json()) as GraphQLResponse<T>
  if (body.errors?.length) throw new LinearError(`${op}: ${body.errors.map((e) => e.message).join('; ')}`)
  if (!body.data) throw new LinearError(`Linear returned no data for ${op}`)
  return body.data
}

// ---------------------------------------------------------------------------
// Capability probe
// ---------------------------------------------------------------------------

/*
 * Field names alone were not enough — see lib/sources/graphql-schema.ts for
 * the outage that taught us. Each field's type comes back too, unwrapped past
 * NON_NULL and LIST to the named type underneath, so an object is never asked
 * for bare.
 */
/*
 * The probe asks about four types, not the whole schema.
 *
 * The full introspection - every type in the schema, every field, each
 * field's type unwrapped three levels - is the most expensive query a sync
 * sends, and it is the FIRST one it sends. When Linear refuses it on
 * complexity the run dies before writing anything, and the adaptive shrink
 * below cannot help: a schema probe has no page size to shrink.
 *
 * See lib/sources/graphql-schema.ts for the query and the four types.
 */
export async function introspect(): Promise<LinearCapabilities> {
  try {
    const data = await gql<ProbeResult>(probeQuery(), {}, 'the schema probe')
    return capabilitiesFrom(probeToIntrospection(data))
  } catch (err) {
    // Refused on complexity even so? Ask for one type at a time.
    //
    // A single `__type` is about as small as a GraphQL query gets, so this
    // gets through where a combined probe might not. Four round trips instead
    // of one is nothing beside a sync that does not run at all - and this is
    // the first thing a sync does, so failing here costs the whole run.
    //
    // TOO_COMPLEX is declared further down, beside the page shrinking it was
    // written for; both readers of it run long after this module is loaded.
    if (!TOO_COMPLEX.test(err instanceof Error ? err.message : String(err))) throw err

    const root = await gql<{ __schema: ProbeResult['__schema'] }>(
      'query Caps { __schema { queryType { name fields(includeDeprecated: false) { name } } } }',
      {},
      'the schema probe (root)',
    )
    const merged = { __schema: root.__schema } as ProbeResult
    for (const [i, type] of PROBE_TYPES.entries()) {
      const one = await gql<ProbeResult>(probeQuery([type]), {}, `the schema probe (${type})`)
      merged[`t${i}`] = one.t0
    }
    return capabilitiesFrom(probeToIntrospection(merged))
  }
}

// ---------------------------------------------------------------------------
// Value mapping lives in linear-map.ts so it can be tested without an API key.
// ---------------------------------------------------------------------------

export {
  mapProjectStatus,
  mapInitiativeStatus,
  mapPriority,
  normaliseProgress,
} from './linear-map'

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

interface Counters {
  [entity: string]: { created: number; updated: number; skipped: number; removed?: number }
}

function bump(c: Counters, entity: string, kind: 'created' | 'updated' | 'skipped' | 'removed') {
  c[entity] ??= { created: 0, updated: 0, skipped: 0 }
  c[entity][kind] = (c[entity][kind] ?? 0) + 1
}

/** Find the local id previously mapped to a Linear id, if any. */
async function localIdFor(externalId: string): Promise<{ entityId: string; entityType: string } | null> {
  const [row] = await db
    .select({ entityId: sourceRecords.entityId, entityType: sourceRecords.entityType })
    .from(sourceRecords)
    .where(and(eq(sourceRecords.system, 'linear'), eq(sourceRecords.externalId, externalId)))
    .limit(1)
  return row ?? null
}

async function recordSource(args: {
  externalId: string
  entityType: string
  entityId: string
  url?: string | null
  raw: unknown
}) {
  await db
    .insert(sourceRecords)
    .values({
      system: 'linear',
      externalId: args.externalId,
      entityType: args.entityType,
      entityId: args.entityId,
      url: args.url ?? null,
      raw: JSON.stringify(args.raw),
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [sourceRecords.system, sourceRecords.externalId],
      set: {
        entityType: args.entityType,
        entityId: args.entityId,
        url: args.url ?? null,
        raw: JSON.stringify(args.raw),
        fetchedAt: new Date(),
      },
    })
}

// ---------------------------------------------------------------------------
// Paged fetch
// ---------------------------------------------------------------------------

interface PageOptions {
  /** GraphQL filter input type name, e.g. "ProjectFilter". Omitted = no filter. */
  filterType?: string
  filter?: Record<string, unknown>
  pageSize?: number
}

/**
 * Walks a Linear connection to exhaustion, yielding a page at a time.
 *
 * Cursor pagination (not offset) because the portfolio changes while the sync
 * runs; offsets would silently skip or duplicate rows mid-walk.
 */
/**
 * "Query too complex", and what to do about it.
 *
 * Linear scores a query by multiplying the page sizes down every nested
 * connection. Fifty projects, each with fifty milestones, five teams and
 * five initiatives is 50 x 50 x 5 x 5 = 62,500 against a ceiling of 10,000, and
 * the whole sync 400s — which is what happened the day a workspace grew
 * enough for the nesting to matter.
 *
 * Picking a smaller constant would work until the next time. Linear's error
 * states both numbers, so the right page size is arithmetic rather than
 * guesswork: scale by the ratio it reports, with a margin, and try again.
 */
const TOO_COMPLEX = /too complex/i

async function* paged<T>(
  queryName: string,
  selection: string,
  opts: PageOptions = {},
): AsyncGenerator<T[]> {
  const { filterType, filter, pageSize: requested = 50 } = opts
  let pageSize = requested
  const useFilter = Boolean(filterType && filter)
  const decl = useFilter ? `, $filter: ${filterType}` : ''
  const arg = useFilter ? ', filter: $filter' : ''

  const query = `
    query Page($first: Int!, $after: String${decl}) {
      ${queryName}(first: $first, after: $after${arg}) {
        nodes { ${selection} }
        pageInfo { hasNextPage endCursor }
      }
    }
  `

  type Connection = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string } }

  let after: string | null = null
  for (;;) {
    let data: Record<string, Connection> | null = null
    // Three shrinks is plenty: each one cuts the page by the ratio Linear
    // asked for, so the first is almost always enough and the rest are there
    // for a ceiling that moves while a sync is running.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        data = await gql<Record<string, Connection>>(
          query,
          { first: pageSize, after, ...(useFilter ? { filter } : {}) },
          `${queryName} (page of ${pageSize})`,
        )
        break
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const next = TOO_COMPLEX.test(message) ? shrinkPage(pageSize, message) : null
        if (next === null) throw err
        pageSize = next
      }
    }
    if (!data) throw new LinearError(`${queryName}: could not find a page size Linear would accept.`)
    const conn: Connection = data[queryName]
    if (conn.nodes.length) yield conn.nodes
    if (!conn.pageInfo.hasNextPage) return
    after = conn.pageInfo.endCursor
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface SyncOptions {
  /** Only pull records changed since this time. Omit for a full backfill. */
  since?: Date | null
  trigger?: 'manual' | 'schedule' | 'webhook'
}

export interface SyncResult {
  runId: string
  status: 'success' | 'partial' | 'failed'
  counters: Counters
  warnings: string[]
  error?: string
}

/**
 * Pull Linear into the local model.
 *
 * Writes only source-owned columns. Manual corrections live in
 * `field_overrides` and are applied at read time, so this function never has
 * to know they exist — which is precisely what stops a sync from eating
 * someone's edit.
 */
/**
 * Runs one record's write and, if it throws, records a warning and moves on.
 *
 * Without this, a single unexpected row — a field a workspace uses in a way
 * the mapping did not anticipate, a constraint met for the first time — aborts
 * the whole sync. That is how a run ends having imported the teams and people
 * and none of the projects, which is the part anyone actually wanted.
 *
 * The run is then reported as `partial` rather than `success`, so a
 * half-imported portfolio never looks like a complete one.
 */
async function attempt(label: string, warnings: string[], fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (warnings.length < 25) warnings.push(`${label}: ${message.split('\n')[0]}`)
    else if (warnings.length === 25) warnings.push('(further errors suppressed)')
  }
}

export async function syncLinear(opts: SyncOptions = {}): Promise<SyncResult> {
  const counters: Counters = {}
  const warnings: string[] = []

  const [run] = await db
    .insert(syncRuns)
    .values({ system: 'linear', trigger: opts.trigger ?? 'manual', status: 'running' })
    .returning({ id: syncRuns.id })

  try {
    const caps = await introspect()

    // --- teams -----------------------------------------------------------
    const teamFields = pick(caps, 'Team', ['id', 'key', 'name', 'description'])
    for await (const nodes of paged<Record<string, string>>('teams', teamFields.join(' '), {
      pageSize: 100,
    })) {
      for (const n of nodes) {
        const existing = await localIdFor(n.id)
        if (existing) {
          await db
            .update(teams)
            .set({ name: n.name, notes: n.description ?? null })
            .where(eq(teams.id, existing.entityId))
          bump(counters, 'teams', 'updated')
          await recordSource({ externalId: n.id, entityType: 'team', entityId: existing.entityId, raw: n })
        } else {
          const [created] = await db
            .insert(teams)
            .values({
              key: await uniqueKey(teams, slugify(n.key ?? n.name)),
              name: n.name,
              notes: n.description ?? null,
            })
            .returning({ id: teams.id })
          bump(counters, 'teams', 'created')
          await recordSource({ externalId: n.id, entityType: 'team', entityId: created.id, raw: n })
        }
      }
    }

    // --- users -----------------------------------------------------------
    const userFields = pick(caps, 'User', ['id', 'name', 'email', 'active'])
    for await (const nodes of paged<Record<string, string | boolean>>(
      'users',
      userFields.join(' '),
      { pageSize: 100 },
    )) {
      for (const n of nodes) {
        const externalId = n.id as string
        const existing = await localIdFor(externalId)
        const values = {
          name: n.name as string,
          email: (n.email as string) ?? null,
          active: n.active !== false,
        }
        if (existing) {
          await db.update(people).set(values).where(eq(people.id, existing.entityId))
          bump(counters, 'people', 'updated')
          await recordSource({ externalId, entityType: 'person', entityId: existing.entityId, raw: n })
          continue
        }

        /*
         * A person can already be here without ever having been synced.
         * Signing in with Google creates a row keyed on the work email, and
         * email is unique — so inserting blindly fails the moment the sync
         * reaches someone who has used the app. The first person that happens
         * to is usually whoever set it up, which is a memorable way to find out.
         *
         * Adopting the existing row is also the correct outcome, not just the
         * one that avoids the error: it is the same human, and everything
         * already attributed to them stays attached.
         */
        const byEmail = values.email
          ? await db
              .select({ id: people.id })
              .from(people)
              .where(eq(people.email, values.email))
              .limit(1)
          : []

        if (byEmail.length) {
          await db.update(people).set(values).where(eq(people.id, byEmail[0].id))
          bump(counters, 'people', 'updated')
          await recordSource({ externalId, entityType: 'person', entityId: byEmail[0].id, raw: n })
          continue
        }

        const [created] = await db.insert(people).values(values).returning({ id: people.id })
        bump(counters, 'people', 'created')
        await recordSource({ externalId, entityType: 'person', entityId: created.id, raw: n })
      }
    }

    /*
     * --- initiatives ------------------------------------------------------
     *
     * A Linear Initiative is an Initiative here. That sentence was not true
     * before the tiers were renamed, and the mismatch is what a previous
     * find-and-replace turned into a dead query: it rewrote Linear's own type
     * and query names along with ours, so this file asked Linear for a
     * `Workstream` type and a `workstreams` query, neither of which exists.
     * Now that the two vocabularies agree there is nothing left to translate,
     * which is the point of the rename.
     */
    if (caps.hasQuery('initiatives')) {
      const initFields = pick(caps, 'Initiative', [
        'id',
        'name',
        'description',
        'targetDate',
        'startedAt',
        'status',
        'url',
        'sortOrder',
        'updatedAt',
      ], { status: 'status { name type }' }, (_f, why) => warnings.push(why))
      const ownerSel = caps.has('Initiative', 'owner') ? ' owner { id }' : ''
      for await (const nodes of paged<Record<string, unknown>>(
        'initiatives',
        initFields.join(' ') + ownerSel,
      )) {
        for (const n of nodes) {
          await attempt(`initiative ${String(n.name ?? n.id)}`, warnings, () =>
            upsertObjective(n, counters),
          )
        }
      }
    } else {
      warnings.push(
        'This Linear workspace does not expose initiatives on the API; initiatives can still be created and managed here by hand.',
      )
    }

    /*
     * --- projects ---------------------------------------------------------
     *
     * A Linear Project is a Project here, and its projectMilestones are this
     * project's milestones.
     */
    const projFields = pick(caps, 'Project', [
      'id',
      'name',
      'description',
      'url',
      'slugId',
      'state',
      'priority',
      'progress',
      'health',
      'startDate',
      'targetDate',
      'startedAt',
      'completedAt',
      'sortOrder',
      'updatedAt',
    ])
    const projExtra = [
      caps.has('Project', 'lead') ? 'lead { id }' : '',
      caps.has('Project', 'status') ? 'status { name type }' : '',
      // Only the first of each is ever read (see upsertInitiative), so asking
      // for five was paying a fivefold complexity multiplier for four values
      // nothing looks at.
      caps.has('Project', 'teams') ? 'teams(first: 1) { nodes { id } }' : '',
      caps.has('Project', 'initiatives') ? 'initiatives(first: 1) { nodes { id } }' : '',
      // A hundred, not twenty-five: anything past the page never arrived, and
      // now that a milestone missing from this list is removed here, a page
      // that did not hold them all must be known to be one (hasNextPage).
      caps.has('Project', 'projectMilestones')
        ? `projectMilestones(first: 100) { nodes { id name description targetDate sortOrder${
            caps.has('ProjectMilestone', 'status') ? ' status' : ''
          } } pageInfo { hasNextPage } }`
        : '',
    ].filter(Boolean)

    // Incremental runs ask Linear for only what moved. A full backfill omits
    // the filter entirely rather than passing a very old date, because the
    // unfiltered query is the one Linear's own caching is tuned for.
    for await (const nodes of paged<Record<string, unknown>>(
      'projects',
      [...projFields, ...projExtra].join(' '),
      opts.since
        ? {
            filterType: 'ProjectFilter',
            filter: { updatedAt: { gt: opts.since.toISOString() } },
          }
        : {},
    )) {
      for (const n of nodes) {
        await attempt(`project ${String(n.name ?? n.id)}`, warnings, () =>
          upsertInitiative(n, counters),
        )
      }
    }

    await db
      .update(syncRuns)
      .set({
        status: warnings.length ? 'partial' : 'success',
        finishedAt: new Date(),
        stats: JSON.stringify(counters),
        cursor: new Date(),
        error: warnings.length ? warnings.join(' | ') : null,
      })
      .where(eq(syncRuns.id, run.id))

    await logChange({
      actor: 'linear-sync',
      kind: 'sync',
      summary: summarise(counters),
      detail: warnings.join(' | ') || null,
    })

    return { runId: run.id, status: warnings.length ? 'partial' : 'success', counters, warnings }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db
      .update(syncRuns)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        stats: JSON.stringify(counters),
        error: message,
      })
      .where(eq(syncRuns.id, run.id))
    return { runId: run.id, status: 'failed', counters, warnings, error: message }
  }
}

function summarise(c: Counters): string {
  const parts = Object.entries(c).map(
    ([k, v]) => `${k}: +${v.created}/~${v.updated}${v.removed ? `/-${v.removed}` : ''}${v.skipped ? `/skip ${v.skipped}` : ''}`,
  )
  return parts.length ? `Linear sync — ${parts.join(', ')}` : 'Linear sync — no changes'
}

// ---------------------------------------------------------------------------
// Entity upserts (also used by the webhook receiver)
// ---------------------------------------------------------------------------

export async function upsertObjective(n: Record<string, unknown>, counters: Counters = {}) {
  const externalId = n.id as string
  const existing = await localIdFor(externalId)
  const ownerExternal = (n.owner as { id?: string } | undefined)?.id
  const ownerLocal = ownerExternal ? await localIdFor(ownerExternal) : null

  const values = {
    name: n.name as string,
    description: (n.description as string) ?? null,
    status: mapInitiativeStatus(n.status as string | { name?: string; type?: string } | null),
    startDate: date(n.startedAt as string),
    targetDate: date(n.targetDate as string),
    ownerId: ownerLocal?.entityId ?? null,
    ownerGap: !ownerLocal,
    sortOrder: Math.round(Number(n.sortOrder ?? 0)),
  }

  let entityId: string
  if (existing) {
    await db.update(initiatives).set(values).where(eq(initiatives.id, existing.entityId))
    entityId = existing.entityId
    bump(counters, 'initiatives', 'updated')
  } else {
    const [created] = await db
      .insert(initiatives)
      .values({ ...values, key: await uniqueKey(initiatives, slugify(values.name)) })
      .returning({ id: initiatives.id })
    entityId = created.id
    bump(counters, 'initiatives', 'created')
  }

  await recordSource({
    externalId,
    entityType: 'initiative',
    entityId,
    url: (n.url as string) ?? null,
    raw: n,
  })
  return entityId
}

export async function upsertInitiative(n: Record<string, unknown>, counters: Counters = {}) {
  const externalId = n.id as string
  const existing = await localIdFor(externalId)

  const leadExternal = (n.lead as { id?: string } | undefined)?.id
  const leadLocal = leadExternal ? await localIdFor(leadExternal) : null

  const teamExternal = (n.teams as { nodes?: { id: string }[] } | undefined)?.nodes?.[0]?.id
  const teamLocal = teamExternal ? await localIdFor(teamExternal) : null

  const initExternal = (n.initiatives as { nodes?: { id: string }[] } | undefined)?.nodes?.[0]?.id
  const initLocal = initExternal ? await localIdFor(initExternal) : null

  const statusObj = n.status as { type?: string } | undefined

  const values = {
    name: n.name as string,
    description: (n.description as string) ?? null,
    status: mapProjectStatus(n.state as string, statusObj?.type),
    priority: mapPriority(n.priority as number),
    progress: normaliseProgress(n.progress),
    sourceHealth: (n.health as string) ?? null,
    startDate: date(n.startDate as string),
    targetDate: date(n.targetDate as string),
    startedAt: date(n.startedAt as string),
    completedAt: date(n.completedAt as string),
    leadId: leadLocal?.entityId ?? null,
    teamId: teamLocal?.entityId ?? null,
    sortOrder: Math.round(Number(n.sortOrder ?? 0)),
    ...(initLocal ? { initiativeId: initLocal.entityId } : {}),
  }

  let entityId: string
  if (existing) {
    await db.update(projects).set(values).where(eq(projects.id, existing.entityId))
    entityId = existing.entityId
    bump(counters, 'projects', 'updated')
  } else {
    const [created] = await db
      .insert(projects)
      .values({ ...values, key: await uniqueKey(projects, slugify(values.name)) })
      .returning({ id: projects.id })
    entityId = created.id
    bump(counters, 'projects', 'created')
  }

  await recordSource({
    externalId,
    entityType: 'project',
    entityId,
    url: (n.url as string) ?? null,
    raw: n,
  })

  const msConn = n.projectMilestones as
    | { nodes?: Record<string, unknown>[]; pageInfo?: { hasNextPage?: boolean } }
    | undefined
  const msNodes = msConn?.nodes
  if (msNodes) {
    for (const m of msNodes) {
      await upsertMilestone(m, entityId, counters)
    }
    // Every milestone Linear has for this project is in that list, so one
    // from Linear that is not has been deleted or archived there. Only when
    // the list is whole: a page with more behind it says nothing about what
    // is not on it.
    if (!msConn?.pageInfo?.hasNextPage) {
      await removeMilestonesGoneFromLinear(entityId, new Set(msNodes.map((m) => m.id as string)), counters)
    }
  }

  return entityId
}

/**
 * Milestones this project got from Linear that Linear no longer has.
 *
 * WHY (Scott, 8 October 2026: "Deleted in linear should mean deleted
 * outright")
 *
 * The sync only ever added and updated. Eleven milestones deleted in Linear,
 * and four archived there, were still on the board, because nothing removed a
 * milestone that stopped arriving. A Linear project's milestones come in whole
 * on every run, so a milestone from Linear that is not among them is gone. Only
 * ones that came from Linear: a milestone added here, or from the program-review
 * deck, has no Linear id and is never touched.
 */
async function removeMilestonesGoneFromLinear(projectId: string, present: ReadonlySet<string>, counters: Counters) {
  const linked = await db
    .select({ externalId: sourceRecords.externalId, id: milestones.id, name: milestones.name })
    .from(sourceRecords)
    .innerJoin(milestones, eq(milestones.id, sourceRecords.entityId))
    .where(
      and(
        eq(sourceRecords.system, 'linear'),
        eq(sourceRecords.entityType, 'milestone'),
        eq(milestones.level, 'project'),
        eq(milestones.entityId, projectId),
      ),
    )
  for (const m of linked.filter((l) => !present.has(l.externalId))) {
    await removeLinearMilestone(m.id, m.externalId)
    bump(counters, 'milestones', 'removed')
    await logChange({
      actor: 'linear-sync',
      kind: 'sync',
      summary: `Milestone removed - ${m.name}: deleted or archived in Linear`,
      entityType: 'milestone',
      entityId: m.id,
    })
  }
}

/**
 * Delete a milestone that came from Linear, with what pointed at it: its Linear
 * link, so a later sync does not think it still exists here, and any
 * dependency on it, which would otherwise point at nothing. Its status items
 * and calendar bands go with it (ON DELETE CASCADE).
 */
export async function removeLinearMilestone(milestoneId: string, externalId: string) {
  await db
    .delete(dependencies)
    .where(
      or(
        and(eq(dependencies.fromType, 'milestone'), eq(dependencies.fromId, milestoneId)),
        and(eq(dependencies.toType, 'milestone'), eq(dependencies.toId, milestoneId)),
      ),
    )
  await db.delete(milestones).where(eq(milestones.id, milestoneId))
  await db.delete(sourceRecords).where(and(eq(sourceRecords.system, 'linear'), eq(sourceRecords.externalId, externalId)))
}

export async function upsertMilestone(
  n: Record<string, unknown>,
  projectId: string,
  counters: Counters = {},
) {
  const externalId = n.id as string
  const existing = await localIdFor(externalId)
  const values = {
    // A Linear milestone hangs off a Linear project, which is a project here.
    level: 'project' as const,
    entityId: projectId,
    name: n.name as string,
    details: (n.description as string) ?? null,
    targetDate: date(n.targetDate as string),
    sortOrder: Math.round(Number(n.sortOrder ?? 0)),
  }

  let entityId: string
  if (existing) {
    // Only the fields nobody has corrected here. See lib/milestones.ts: a
    // sync that writes the whole row every run reverts a person's edit at
    // the next sync, and they conclude the app does not save.
    const [row] = await db
      .select({ editedFields: milestones.editedFields, status: milestones.status })
      .from(milestones)
      .where(eq(milestones.id, existing.entityId))
      .limit(1)
    // Done and overdue in Linear, as complete and at risk here; and back to
    // planning when Linear stops saying either. What Linear said last time is
    // in the source record (see syncedMilestoneStatus).
    const [before] = await db
      .select({ raw: sourceRecords.raw })
      .from(sourceRecords)
      .where(and(eq(sourceRecords.system, 'linear'), eq(sourceRecords.externalId, externalId)))
      .limit(1)
    // Only when Linear said: a payload without the field (a webhook, a
    // workspace whose schema lacks it) is silence, not "no longer done".
    const status = 'status' in n ? syncedMilestoneStatus(n.status, previousStatus(before?.raw), row?.status ?? null) : undefined
    const allowed = mergeFromSource({ ...values, ...(status ? { status } : {}) }, row?.editedFields)
    entityId = existing.entityId
    if (Object.keys(allowed).length > 0) {
      await db.update(milestones).set(allowed).where(eq(milestones.id, entityId))
      bump(counters, 'milestones', 'updated')
    } else {
      bump(counters, 'milestones', 'skipped')
    }
  } else {
    const status = milestoneStatusFrom(n.status)
    const [created] = await db
      .insert(milestones)
      .values({ ...values, ...(status ? { status } : {}) })
      .returning({ id: milestones.id })
    entityId = created.id
    bump(counters, 'milestones', 'created')
  }

  await recordSource({ externalId, entityType: 'milestone', entityId, raw: n })
  return entityId
}

/** A milestone's status as Linear last reported it, from the stored payload. */
function previousStatus(raw: string | null | undefined): unknown {
  if (!raw) return null
  try {
    return (JSON.parse(raw) as { status?: unknown }).status ?? null
  } catch {
    return null
  }
}

/** Deletion from Linear archives locally rather than dropping rows, so that
 *  assessments, decisions and dependencies attached to the record survive.
 *  Except a milestone, which is deleted outright (Scott, 8 October 2026). */
export async function archiveByExternalId(externalId: string) {
  const existing = await localIdFor(externalId)
  if (!existing) return
  if (existing.entityType === 'milestone') {
    await removeLinearMilestone(existing.entityId, externalId)
  } else if (existing.entityType === 'project') {
    await db.update(projects).set({ status: 'canceled' }).where(eq(projects.id, existing.entityId))
  } else if (existing.entityType === 'initiative') {
    await db
      .update(initiatives)
      .set({ status: 'canceled' })
      .where(eq(initiatives.id, existing.entityId))
  }
}

// ---------------------------------------------------------------------------

/** Ensure a human-readable key is unique without a retry loop at the caller. */
async function uniqueKey(
  table: typeof teams | typeof projects | typeof initiatives,
  base: string,
): Promise<string> {
  const candidate = base || 'item'
  for (let i = 0; i < 50; i++) {
    const key = i === 0 ? candidate : `${candidate}-${i + 1}`
    const [hit] = await db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.key, key))
      .limit(1)
    if (!hit) return key
  }
  return `${candidate}-${Date.now()}`
}
