/**
 * The 360 import, end to end (12 November 2026): pick a client, a user and a
 * report from the snapshot `npm run load:360` keeps, see what converting it
 * to GPC changes, and import it as a saved report.
 *
 * The snapshot tables are x360_users, x360_reports and x360_names
 * (drizzle/0046). Names are matched to GPC through the report engine, so the
 * matching sees only what the person is entitled to.
 */
import { desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { x360Names, x360Reports, x360Users } from '@/db/schema'
import type { ReportEngine } from '@/lib/report-builder/engines'
import type { DimKey } from '@/lib/report-builder/data/types'
import { convert360, type Converted, type Matcher, type Note } from './convert'
import { describe, type Described, type Lookup, type Raw360Spec } from './decode'

export interface Client360 {
  usrsetId: number
  name: string
  licenseGroup: string | null
  reports: number
}
export interface User360 {
  usrId: number
  name: string
  reports: number
}
export interface Report360 {
  key: string
  name: string
  type: string
  lastUsed: string | null
}

/** Clients (user sets) with reports used in 2026, biggest first; q narrows by client, license group or mnemonic. */
export async function listClients(q: string): Promise<Client360[]> {
  const names = db
    .select({ usrsetId: x360Users.usrsetId, name: sql<string>`max(${x360Users.usrsetN})`.as('name'), lic: sql<string | null>`max(${x360Users.licensegrpN})`.as('lic'), mnemonic: sql<string>`max(${x360Users.mnemonic})`.as('mnemonic') })
    .from(x360Users)
    .groupBy(x360Users.usrsetId)
    .as('n')
  const counts = db.select({ usrsetId: x360Reports.usrsetId, reports: sql<number>`count(*)::int`.as('reports') }).from(x360Reports).groupBy(x360Reports.usrsetId).as('c')
  const like = `%${q.trim()}%`
  const rows = await db
    .select({ usrsetId: counts.usrsetId, reports: counts.reports, name: names.name, lic: names.lic })
    .from(counts)
    .leftJoin(names, eq(names.usrsetId, counts.usrsetId))
    .where(q.trim() ? or(ilike(names.name, like), ilike(names.lic, like), ilike(names.mnemonic, like)) : undefined)
    .orderBy(desc(counts.reports))
    .limit(60)
  return rows.map((r) => ({ usrsetId: r.usrsetId, name: r.name ?? `Client ${r.usrsetId}`, licenseGroup: r.lic, reports: Number(r.reports) }))
}

export async function listUsers(usrsetId: number): Promise<User360[]> {
  const rows = await db
    .select({ usrId: x360Reports.usrId, name: sql<string | null>`max(${x360Users.usrN})`, reports: sql<number>`count(*)::int` })
    .from(x360Reports)
    .leftJoin(x360Users, eq(x360Users.usrId, x360Reports.usrId))
    .where(eq(x360Reports.usrsetId, usrsetId))
    .groupBy(x360Reports.usrId)
    .orderBy(desc(sql`count(*)`))
  return rows.map((r) => ({ usrId: r.usrId, name: r.name ?? `User ${r.usrId}`, reports: Number(r.reports) }))
}

export async function listReports(usrId: number): Promise<Report360[]> {
  const rows = await db
    .select({ key: x360Reports.reportKey, name: x360Reports.name, type: x360Names.name, lastUsed: x360Reports.lastUsed })
    .from(x360Reports)
    .leftJoin(x360Names, eq(x360Names.nameKey, sql`'-2:' || ${x360Reports.rpttypeId}`))
    .where(eq(x360Reports.usrId, usrId))
    .orderBy(desc(x360Reports.lastUsed))
  return rows.map((r) => ({ key: r.key, name: r.name, type: r.type ?? 'Report', lastUsed: r.lastUsed ? r.lastUsed.toISOString().slice(0, 10) : null }))
}

/** The names a spec refers to, from the snapshot. */
async function lookupFor(raw: Raw360Spec): Promise<Lookup> {
  const keys = new Set<string>()
  for (const s of raw.sel) {
    keys.add(`-1:${s.e}`)
    for (const id of [...s.ids, ...(s.ex ?? [])]) keys.add(`${s.e}:${id}`)
  }
  for (const c of raw.cols) keys.add(`-1:${c.entmaj}`).add(`-3:${c.entmaj}`).add(`-4:${c.calc}`)
  if (raw.rpttype != null) keys.add(`-2:${raw.rpttype}`)
  const names = new Map<string, string>()
  const all = [...keys]
  for (let i = 0; i < all.length; i += 5000) for (const r of await db.select({ k: x360Names.nameKey, n: x360Names.name }).from(x360Names).where(inArray(x360Names.nameKey, all.slice(i, i + 5000)))) names.set(r.k, r.n)
  return {
    name: (e, id) => names.get(`${e}:${id}`),
    type: (e) => names.get(`-1:${e}`),
    report: (id) => names.get(`-2:${id}`),
    measure: (e) => names.get(`-3:${e}`),
    calc: (id) => names.get(`-4:${id}`),
  }
}

/** The engine's bulk lookup, as the converter's Matcher. */
function matcherFor(engine: ReportEngine): Matcher {
  if (!engine.matchNames) throw new Error('Importing from 360 needs the live GPC data.')
  return {
    match: (dim: DimKey, names: string[]) => engine.matchNames!(dim, names),
    search: async (dim: DimKey, text: string) => (await engine.search(text, { types: [dim], limit: 8 })).map((h) => ({ id: h.id, name: h.label, context: h.context, spend: (h as { spend_last_month?: number }).spend_last_month ?? 1 })),
  }
}

export interface Preview {
  key: string
  report: { name: string; client: string; user: string; type: string; lastUsed: string | null }
  described: Described
  converted: Converted
}

async function load(key: string) {
  const [r] = await db.select().from(x360Reports).where(eq(x360Reports.reportKey, key)).limit(1)
  if (!r) throw new Error('That report is not in the 360 snapshot. Run npm run load:360 to refresh it.')
  const [u] = await db.select().from(x360Users).where(eq(x360Users.usrId, r.usrId)).limit(1)
  return { r, u }
}

/** What importing this report would give, and what it would change. Nothing is saved. */
export async function preview360(engine: ReportEngine, key: string, nearest = false): Promise<Preview> {
  const { r, u } = await load(key)
  const raw = r.spec as Raw360Spec
  const look = await lookupFor(raw)
  const described = describe(raw, look)
  const converted = await convert360(described, matcherFor(engine), { nearest })
  return {
    key,
    report: { name: r.name, client: u?.usrsetN ?? r.mnemonic, user: u?.usrN ?? `User ${r.usrId}`, type: described.type.name, lastUsed: r.lastUsed ? r.lastUsed.toISOString().slice(0, 10) : null },
    described,
    converted,
  }
}

/**
 * Import: convert, check the result with the engine (fixing what it cannot
 * run, and saying so), and save it among the person's saved reports, with the
 * notes kept on it. Returns the saved report.
 */
export async function import360(engine: ReportEngine, key: string, nearest = false): Promise<{ id: string; name: string; notes: Note[] }> {
  const p = await preview360(engine, key, nearest)
  if (p.converted.verdict === 'refused' && !nearest) throw new Error(p.converted.refusal ?? 'This report cannot be imported.')
  const notes = [...p.converted.notes]
  let spec: Record<string, unknown> = p.converted.spec
  // A combination the engine refuses (spot length with program, say) takes its first fix.
  for (let i = 0; i < 3; i++) {
    const v = await engine.validate(spec)
    const err = v.errors[0]
    if (!err) {
      spec = v.spec
      break
    }
    const fix = err.fixes[0]
    if (!fix) throw new Error(`The converted report does not run: ${err.message}`)
    notes.push({ impact: 'changed', what: 'Converted report', why: err.message, did: fix.label })
    spec = (await engine.validate(spec, fix.patch)).spec
  }
  const name = `${p.report.name} (from 360)`
  spec = { ...spec, import_360: { key, client: p.report.client, user: p.report.user, report: p.report.name, type: p.report.type, imported: new Date().toISOString().slice(0, 10), notes } }
  const saved = await engine.saveReport(name, spec)
  return { id: saved.id, name: saved.name, notes }
}

/** How many reports the snapshot holds, and when it was loaded. */
export async function snapshotInfo(): Promise<{ reports: number; loaded: string | null }> {
  const [r] = await db.select({ n: sql<number>`count(*)::int`, at: sql<Date | null>`max(${x360Reports.loadedAt})` }).from(x360Reports)
  return { reports: Number(r?.n ?? 0), loaded: r?.at ? new Date(r.at).toISOString().slice(0, 10) : null }
}

