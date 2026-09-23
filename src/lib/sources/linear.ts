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
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  initiatives,
  milestones,
  people,
  projects,
  sourceRecords,
  syncRuns,
  teams,
} from '@/db/schema'
import { logChange } from '../portfolio'
import { slugify } from '../util'
import {
  mapInitiativeStatus,
  mapPriority,
  mapProjectStatus,
  normaliseProgress,
  parseLinearDate as date,
} from './linear-map'

const LINEAR_API = 'https://api.linear.app/graphql'

export class LinearError extends Error {}

interface GraphQLResponse<T> {
  data?: T
  errors?: { message: string; extensions?: Record<string, unknown> }[]
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
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
    throw new LinearError(`Linear rate limit hit; retry after ${retry ?? 'unknown'}s`)
  }
  if (!res.ok) throw new LinearError(`Linear returned ${res.status}: ${await res.text()}`)

  const body = (await res.json()) as GraphQLResponse<T>
  if (body.errors?.length) throw new LinearError(body.errors.map((e) => e.message).join('; '))
  if (!body.data) throw new LinearError('Linear returned no data')
  return body.data
}

// ---------------------------------------------------------------------------
// Capability probe
// ---------------------------------------------------------------------------

export interface LinearCapabilities {
  types: Map<string, Set<string>>
  has(type: string, field: string): boolean
  hasQuery(name: string): boolean
}

const INTROSPECTION = `
  query Caps {
    __schema {
      queryType { name }
      types {
        name
        kind
        fields(includeDeprecated: false) { name }
      }
    }
  }
`

export async function introspect(): Promise<LinearCapabilities> {
  const data = await gql<{
    __schema: {
      queryType: { name: string }
      types: { name: string; kind: string; fields: { name: string }[] | null }[]
    }
  }>(INTROSPECTION)

  const types = new Map<string, Set<string>>()
  for (const t of data.__schema.types) {
    if (!t.fields) continue
    types.set(t.name, new Set(t.fields.map((f) => f.name)))
  }
  const rootName = data.__schema.queryType.name
  const root = types.get(rootName) ?? new Set<string>()

  return {
    types,
    has: (type, field) => types.get(type)?.has(field) ?? false,
    hasQuery: (name) => root.has(name),
  }
}

/** Keep only the fields the live schema actually exposes. */
function pick(caps: LinearCapabilities, type: string, candidates: string[]): string[] {
  return candidates.filter((f) => caps.has(type, f.split(/[\s({]/)[0]))
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
  [entity: string]: { created: number; updated: number; skipped: number }
}

function bump(c: Counters, entity: string, kind: 'created' | 'updated' | 'skipped') {
  c[entity] ??= { created: 0, updated: 0, skipped: 0 }
  c[entity][kind] += 1
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
async function* paged<T>(
  queryName: string,
  selection: string,
  opts: PageOptions = {},
): AsyncGenerator<T[]> {
  const { filterType, filter, pageSize = 50 } = opts
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
    const data: Record<string, Connection> = await gql<Record<string, Connection>>(query, {
      first: pageSize,
      after,
      ...(useFilter ? { filter } : {}),
    })
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

    // --- initiatives -----------------------------------------------------
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
      ])
      const ownerSel = caps.has('Initiative', 'owner') ? ' owner { id }' : ''
      for await (const nodes of paged<Record<string, unknown>>(
        'initiatives',
        initFields.join(' ') + ownerSel,
      )) {
        for (const n of nodes) {
          await attempt(`initiative ${String(n.name ?? n.id)}`, warnings, () =>
            upsertInitiative(n, counters),
          )
        }
      }
    } else {
      warnings.push(
        'This Linear workspace does not expose initiatives on the API; initiatives can still be created and managed here by hand.',
      )
    }

    // --- projects --------------------------------------------------------
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
      caps.has('Project', 'teams') ? 'teams(first: 5) { nodes { id } }' : '',
      caps.has('Project', 'initiatives') ? 'initiatives(first: 5) { nodes { id } }' : '',
      caps.has('Project', 'projectMilestones')
        ? 'projectMilestones(first: 50) { nodes { id name description targetDate sortOrder } }'
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
          upsertProject(n, counters),
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
    ([k, v]) => `${k}: +${v.created}/~${v.updated}${v.skipped ? `/skip ${v.skipped}` : ''}`,
  )
  return parts.length ? `Linear sync — ${parts.join(', ')}` : 'Linear sync — no changes'
}

// ---------------------------------------------------------------------------
// Entity upserts (also used by the webhook receiver)
// ---------------------------------------------------------------------------

export async function upsertInitiative(n: Record<string, unknown>, counters: Counters = {}) {
  const externalId = n.id as string
  const existing = await localIdFor(externalId)
  const ownerExternal = (n.owner as { id?: string } | undefined)?.id
  const ownerLocal = ownerExternal ? await localIdFor(ownerExternal) : null

  const values = {
    name: n.name as string,
    description: (n.description as string) ?? null,
    status: mapInitiativeStatus(n.status as string),
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

export async function upsertProject(n: Record<string, unknown>, counters: Counters = {}) {
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

  const msNodes = (n.projectMilestones as { nodes?: Record<string, unknown>[] } | undefined)?.nodes
  if (msNodes) {
    for (const m of msNodes) {
      await upsertMilestone(m, entityId, counters)
    }
  }

  return entityId
}

export async function upsertMilestone(
  n: Record<string, unknown>,
  projectId: string,
  counters: Counters = {},
) {
  const externalId = n.id as string
  const existing = await localIdFor(externalId)
  const values = {
    projectId,
    name: n.name as string,
    description: (n.description as string) ?? null,
    targetDate: date(n.targetDate as string),
    sortOrder: Math.round(Number(n.sortOrder ?? 0)),
  }

  let entityId: string
  if (existing) {
    await db.update(milestones).set(values).where(eq(milestones.id, existing.entityId))
    entityId = existing.entityId
    bump(counters, 'milestones', 'updated')
  } else {
    const [created] = await db.insert(milestones).values(values).returning({ id: milestones.id })
    entityId = created.id
    bump(counters, 'milestones', 'created')
  }

  await recordSource({ externalId, entityType: 'milestone', entityId, raw: n })
  return entityId
}

/** Deletion from Linear archives locally rather than dropping rows, so that
 *  assessments, decisions and dependencies attached to the record survive. */
export async function archiveByExternalId(externalId: string) {
  const existing = await localIdFor(externalId)
  if (!existing) return
  if (existing.entityType === 'project') {
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
