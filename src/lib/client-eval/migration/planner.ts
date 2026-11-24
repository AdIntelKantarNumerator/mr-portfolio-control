/**
 * The Migration Plan planner (Scott, 23 November 2026): builds every active
 * client's plan in the background, over hours or days, one at a time.
 *
 * The app runs on one small server (B1: one core), so the planner never runs
 * two plans at once, pauses between them, and waits while an Impact Deck or an
 * export is being built. Its queue is ce_plans, so a restart picks up where it
 * stopped.
 *
 * Order: plans someone asked for first, then clients on several platforms,
 * with recent logins, with the most users. Clients that matter (several
 * platforms, five or more active users, or any login in the last 30 days) get
 * full plans, with their advertisers followed into Insights Studio; the rest
 * get light plans, which are made full when someone opens them.
 *
 * A plan is out of date when what it was built from changes (inputsHash): after
 * a platform refresh the planner compares each plan built before it and queues
 * the ones that changed.
 *
 * Runs in production, or locally with CLIENT_EVAL_PLANNER=on. CLIENT_EVAL_PLANNER=off stops it anywhere.
 */
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { ceClients, ceJobs, cePlans, ceSources } from '@/db/schema'
import { buildPlan, inputsHash } from './build'
import type { MigrationPlan } from './types'

const PAUSE_MS = 5_000
const IDLE_MS = 60_000
const BUSY_MS = 30_000
const ASKED = 100_000
const CHECK_BATCH = 50
const STUCK_MS = 30 * 60_000

export interface PlanView {
  status: 'none' | 'queued' | 'building' | 'ready' | 'failed'
  depth: 'full' | 'light' | null
  plan: MigrationPlan | null
  builtAt: string | null
  step: string | null
  error: string | null
  /** Where it is in the queue, when queued. */
  ahead: number | null
}

export interface PlannerStats {
  running: boolean
  total: number
  ready: number
  full: number
  queued: number
  building: string | null
  failed: number
}

const g = globalThis as unknown as { __cePlanner?: { running: boolean; stop: boolean } }

export function plannerEnabled(): boolean {
  const v = (process.env.CLIENT_EVAL_PLANNER ?? '').toLowerCase()
  if (v === 'off') return false
  return v === 'on' || process.env.NODE_ENV === 'production'
}

/** Start the planner in this server process, once. Safe to call on every request. */
export function ensurePlanner(): void {
  if (!plannerEnabled() || g.__cePlanner?.running) return
  g.__cePlanner = { running: true, stop: false }
  void loop().finally(() => {
    if (g.__cePlanner) g.__cePlanner.running = false
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function loop() {
  // A plan left "building" by a restart is queued again.
  await db.update(cePlans).set({ status: 'queued', step: null }).where(eq(cePlans.status, 'building'))
  let seeded = false
  while (!g.__cePlanner?.stop) {
    try {
      if (await jobRunning()) {
        await sleep(BUSY_MS)
        continue
      }
      const next = await nextQueued()
      if (next) {
        await runOne(next.clientId, next.depth as 'full' | 'light')
        await sleep(PAUSE_MS)
        continue
      }
      if (!seeded) {
        await seed()
        seeded = true
        continue
      }
      if (await checkStale()) continue
      await sleep(IDLE_MS)
      seeded = false
    } catch (err) {
      console.error('[planner]', err)
      await sleep(IDLE_MS)
    }
  }
}

async function jobRunning(): Promise<boolean> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(ceJobs).where(eq(ceJobs.status, 'running'))
  return (r?.n ?? 0) > 0
}

async function nextQueued() {
  const [r] = await db.select({ clientId: cePlans.clientId, depth: cePlans.depth }).from(cePlans).where(eq(cePlans.status, 'queued')).orderBy(desc(cePlans.priority), asc(cePlans.requestedAt)).limit(1)
  return r ?? null
}

/** Every active client without a plan row gets one, queued by how much it matters. */
async function seed() {
  const have = new Set((await db.select({ id: cePlans.clientId }).from(cePlans)).map((r) => r.id))
  const rows = await db
    .select({ id: ceClients.clientId, platforms: ceClients.platforms, activeUsers: ceClients.activeUsers, logins30: ceClients.logins30 })
    .from(ceClients)
    .where(and(eq(ceClients.active, true), eq(ceClients.internal, false)))
  const add = rows
    .filter((c) => !have.has(c.id))
    .map((c) => {
      const multi = (c.platforms as string[]).length > 1
      const full = multi || c.activeUsers >= 5 || c.logins30 > 0
      return { clientId: c.id, status: 'queued', depth: full ? 'full' : 'light', priority: (multi ? 1000 : 0) + (c.logins30 > 0 ? 500 : 0) + Math.min(c.activeUsers, 400) }
    })
  for (let i = 0; i < add.length; i += 500) await db.insert(cePlans).values(add.slice(i, i + 500)).onConflictDoNothing()
}

/** Compare plans built before the latest refresh with their inputs; queue the changed ones. Returns whether it did anything. */
async function checkStale(): Promise<boolean> {
  const [latest] = await db.select({ at: sql<Date | null>`max(${ceSources.loadedAt})` }).from(ceSources)
  const since = latest?.at ? new Date(latest.at) : null
  if (!since) return false
  const due = await db
    .select({ clientId: cePlans.clientId, hash: cePlans.inputsHash })
    .from(cePlans)
    .where(and(eq(cePlans.status, 'ready'), or(isNull(cePlans.checkedAt), lt(cePlans.checkedAt, since))))
    .limit(CHECK_BATCH)
  if (!due.length) return false
  for (const p of due) {
    const h = await inputsHash(db, p.clientId)
    if (!h) await db.delete(cePlans).where(eq(cePlans.clientId, p.clientId))
    else if (h !== p.hash) await db.update(cePlans).set({ status: 'queued', checkedAt: new Date() }).where(eq(cePlans.clientId, p.clientId))
    else await db.update(cePlans).set({ checkedAt: new Date() }).where(eq(cePlans.clientId, p.clientId))
  }
  return true
}

async function runOne(clientId: string, depth: 'full' | 'light') {
  const started = Date.now()
  await db.update(cePlans).set({ status: 'building', startedAt: new Date(), step: 'Starting', error: null }).where(eq(cePlans.clientId, clientId))
  try {
    const hash = await inputsHash(db, clientId)
    if (!hash) {
      await db.delete(cePlans).where(eq(cePlans.clientId, clientId))
      return
    }
    let last = 0
    const plan = await buildPlan(db, clientId, {
      depth,
      progress: async (step) => {
        // Progress is written at most every two seconds: the queue table is read by every open popup.
        if (Date.now() - last < 2000) return
        last = Date.now()
        await db.update(cePlans).set({ step }).where(eq(cePlans.clientId, clientId))
      },
    })
    await db
      .update(cePlans)
      .set({ status: 'ready', plan, inputsHash: hash, builtAt: new Date(), checkedAt: new Date(), step: null, error: null, priority: 0, durationMs: Date.now() - started })
      .where(eq(cePlans.clientId, clientId))
  } catch (err) {
    console.error('[planner] plan', clientId, err)
    await db.update(cePlans).set({ status: 'failed', step: null, error: String((err as Error)?.message ?? err).slice(0, 500), priority: 0, durationMs: Date.now() - started }).where(eq(cePlans.clientId, clientId))
  }
}

/** Ask for a client's plan now: it jumps the queue, in full. Without the planner running here, it is built straight away. */
export async function requestPlan(clientId: string, by: string | null): Promise<void> {
  const [c] = await db.select({ id: ceClients.clientId }).from(ceClients).where(eq(ceClients.clientId, clientId)).limit(1)
  if (!c) throw new Error('That client is not in the list. It may have changed with a refresh.')
  const [have] = await db.select({ status: cePlans.status, startedAt: cePlans.startedAt }).from(cePlans).where(eq(cePlans.clientId, clientId)).limit(1)
  // Building: leave it, unless it started so long ago that it must have stopped (a restart, a hang).
  if (have?.status === 'building' && have.startedAt && Date.now() - have.startedAt.getTime() < STUCK_MS) return
  await db
    .insert(cePlans)
    .values({ clientId, status: 'queued', depth: 'full', priority: ASKED, requestedAt: new Date(), requestedBy: by })
    .onConflictDoUpdate({ target: cePlans.clientId, set: { status: 'queued', depth: 'full', priority: ASKED, requestedAt: new Date(), requestedBy: by, error: null } })
  if (plannerEnabled()) ensurePlanner()
  else void runOne(clientId, 'full')
}

/** Admins: queue every plan again (or one client's), keeping what is there until it is rebuilt. */
export async function refreshPlans(by: string | null, clientId?: string): Promise<number> {
  if (clientId) {
    await requestPlan(clientId, by)
    return 1
  }
  const r = await db.update(cePlans).set({ status: 'queued', requestedBy: by }).where(inArray(cePlans.status, ['ready', 'failed'])).returning({ id: cePlans.clientId })
  ensurePlanner()
  return r.length
}

export async function readPlan(clientId: string): Promise<PlanView> {
  const [p] = await db.select().from(cePlans).where(eq(cePlans.clientId, clientId)).limit(1)
  if (!p) return { status: 'none', depth: null, plan: null, builtAt: null, step: null, error: null, ahead: null }
  let ahead: number | null = null
  if (p.status === 'queued') {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(cePlans)
      .where(and(eq(cePlans.status, 'queued'), or(sql`${cePlans.priority} > ${p.priority}`, and(eq(cePlans.priority, p.priority), lt(cePlans.requestedAt, p.requestedAt ?? new Date(0))))))
    ahead = r?.n ?? 0
  }
  return {
    status: p.status as PlanView['status'],
    depth: p.depth as 'full' | 'light',
    plan: (p.plan as MigrationPlan | null) ?? null,
    builtAt: p.builtAt ? p.builtAt.toISOString() : null,
    step: p.step,
    error: p.error,
    ahead,
  }
}

export async function plannerStats(): Promise<PlannerStats> {
  const rows = await db.select({ status: cePlans.status, depth: cePlans.depth, n: sql<number>`count(*)::int` }).from(cePlans).groupBy(cePlans.status, cePlans.depth)
  const [building] = await db.select({ id: cePlans.clientId, step: cePlans.step }).from(cePlans).where(eq(cePlans.status, 'building')).limit(1)
  const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((s, r) => s + r.n, 0)
  let buildingName: string | null = null
  if (building) {
    const [c] = await db.select({ name: ceClients.name }).from(ceClients).where(eq(ceClients.clientId, building.id)).limit(1)
    buildingName = `${c?.name ?? building.id}${building.step ? `: ${building.step}` : ''}`
  }
  return {
    running: !!g.__cePlanner?.running,
    total: sum(() => true),
    ready: sum((r) => r.status === 'ready'),
    full: sum((r) => r.status === 'ready' && r.depth === 'full'),
    queued: sum((r) => r.status === 'queued'),
    building: buildingName,
    failed: sum((r) => r.status === 'failed'),
  }
}
