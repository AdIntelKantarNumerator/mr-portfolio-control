/**
 * The 360 SQL Server, read live for Report Builder's import (19 November 2026).
 *
 * Scott asked for the import to read 360 directly rather than the snapshot
 * `npm run load:360` keeps. Since 19 November the web app reaches the server
 * (sql-360-prod.ad.vivvix.com, 10.230.8.8) over the KMI dev VNet, so it can.
 * Each step reads only what it needs: the client list (all 2,370 per-client
 * table sets, about 9 seconds, kept for half an hour), then one client's users
 * and reports and one report's parts, each a tenth of a second.
 *
 * Configured by SQL360_SERVER, SQL360_USERNAME and SQL360_PASSWORD (a Key
 * Vault reference in Azure). Without them the import falls back to the
 * snapshot (lib/import360/service.ts).
 *
 * The per-client layout, as load-360.ts documents it: each client (user set)
 * has its own <mnemonic>_reportset, _reportdet, _reportcolset, _reportcol,
 * _reportcolset_rptopt, _bucketset, _bucketdet and _reportsetup. A report's
 * parts hang off _reportdet by mpt (11 = report columns, the layout; the rest
 * = selections, as bucket sets). Owners come from iddb_ar, names from
 * iddb_master through iddb_custrpt_meta_prod.entfields.
 *
 * SELECT only, READ UNCOMMITTED, with read-only intent. Never ai_AddMasterJobQ,
 * which queues a report to run and email its owner.
 */
import sql from 'mssql'
import type { Lookup, Raw360Spec } from './decode'

/** Reports used since this day are offered (Scott, 12 November 2026). */
export const SINCE = '2026-01-01'

/** A client mnemonic as a table prefix: letters, digits and underscore only. */
export function safePrefix(p: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(p)) throw new Error(`Unexpected table prefix ${p}`)
  return p
}
const ints = (xs: number[]) => xs.map((x) => {
  if (!Number.isInteger(x)) throw new Error(`Not a whole number: ${x}`)
  return x
}).join(',')
export const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d))

// ------------------------------------------------------------------ the SQL a report's parts take

/** Each report's head: owner, name, last use, type and version (its latest change, layout or selections). */
export function headSql(p: string, where: string): string {
  const t = safePrefix(p)
  return `SELECT '${t}' AS p, r.reportset_id, r.usr_id, r.usrset_id, r.reportset_n, r.lastused_d,
    (SELECT TOP 1 cs.rpttype_id FROM [${t}_reportdet] d JOIN [${t}_reportcolset] cs ON cs.reportcolset_id = d.master_id WHERE d.reportset_id = r.reportset_id AND d.mpt_id = 11) AS rpttype_id,
    CONVERT(varchar(23), (SELECT MAX(m) FROM (
      SELECT r.modify_d AS m
      UNION ALL SELECT cs.modify_d FROM [${t}_reportdet] d JOIN [${t}_reportcolset] cs ON cs.reportcolset_id = d.master_id WHERE d.reportset_id = r.reportset_id AND d.mpt_id = 11
      UNION ALL SELECT bs.modify_d FROM [${t}_reportdet] d JOIN [${t}_bucketset] bs ON bs.bucketset_id = d.master_id WHERE d.reportset_id = r.reportset_id AND d.mpt_id NOT IN (11, 13)
    ) v), 126) AS version
    FROM [${t}_reportset] r WHERE ${where}`
}

/** The four statements that read the parts of these reports, client by client: layout, options, selections, titles. */
export function partsSql(byClient: Map<string, number[]>): { cols: string; opts: string; sels: string; titles: string } {
  const each = (f: (t: string, ids: string) => string) => [...byClient].map(([p, ids]) => f(safePrefix(p), ints(ids))).join(' UNION ALL ')
  return {
    cols: each((t, ids) => `SELECT '${t}' AS p, d.reportset_id, c.coltype_id, c.entmaj_id, c.entmin_id, c.order_id, c.sortkey_id, c.totalkey_f, c.calc_id, c.demoset_id, c.reportcol_n
      FROM [${t}_reportdet] d JOIN [${t}_reportcol] c ON c.reportcolset_id = d.master_id WHERE d.mpt_id = 11 AND d.reportset_id IN (${ids})`),
    opts: each((t, ids) => `SELECT '${t}' AS p, d.reportset_id, o.rptopt_id, o.entmaj_id, o.entmin_id, o.string_n, o.date1_d, o.date2_d, o.long_v, o.double_v
      FROM [${t}_reportdet] d JOIN [${t}_reportcolset_rptopt] o ON o.reportcolset_id = d.master_id WHERE d.mpt_id = 11 AND d.reportset_id IN (${ids})`),
    sels: each((t, ids) => `SELECT '${t}' AS p, d.reportset_id, d.mpt_id, b.entmaj_id, b.master_id, b.secondary_id, b.optmask_id
      FROM [${t}_reportdet] d JOIN [${t}_bucketdet] b ON b.bucketset_id = d.master_id WHERE d.mpt_id NOT IN (11, 13) AND d.reportset_id IN (${ids})`),
    titles: each((t, ids) => `SELECT '${t}' AS p, reportset_id, title1 FROM [${t}_reportsetup] WHERE reportset_id IN (${ids})`),
  }
}

type Row = Record<string, unknown>
type Sel = Raw360Spec['sel'][number]

/**
 * The parts' rows as one spec per report ("mnemonic:reportset_id"), and the
 * ids each entity type's selections name. Selections are stored compactly -
 * one list per part and entity type - because some reports pick thousands of
 * ids: ids picked, ex excluded (optmask 64), ranges for time buckets (start and
 * end day), masks for any other option.
 */
export function assembleSpecs(parts: { cols: Row[]; opts: Row[]; sels: Row[]; titles: Row[] }): { specs: Map<string, Raw360Spec>; wantNames: Map<number, Set<number>> } {
  const specs = new Map<string, Raw360Spec>()
  const wantNames = new Map<number, Set<number>>()
  const specOf = (p: unknown, id: unknown) => {
    const k = `${String(p).toLowerCase()}:${Number(id)}`
    let v = specs.get(k)
    if (!v) specs.set(k, (v = { rpttype: null, title: null, cols: [], opts: [], sel: [] }))
    return v
  }
  for (const c of parts.cols)
    specOf(c.p, c.reportset_id).cols.push({ type: c.coltype_id, entmaj: c.entmaj_id, entmin: c.entmin_id, order: c.order_id, sort: c.sortkey_id, total: c.totalkey_f, calc: c.calc_id, demo: c.demoset_id, name: String(c.reportcol_n ?? '').trim() } as Raw360Spec['cols'][number])
  for (const o of parts.opts)
    specOf(o.p, o.reportset_id).opts.push({ opt: o.rptopt_id, entmaj: o.entmaj_id, entmin: o.entmin_id, str: o.string_n ? String(o.string_n).trim() : null, d1: iso(o.date1_d), d2: iso(o.date2_d), long: o.long_v ?? null, dbl: o.double_v ?? null } as Raw360Spec['opts'][number])
  for (const b of parts.sels) {
    const e = Number(b.entmaj_id)
    const spec = specOf(b.p, b.reportset_id)
    const mpt = Number(b.mpt_id)
    let entry = spec.sel.find((x) => x.mpt === mpt && x.e === e) as Sel | undefined
    if (!entry) spec.sel.push((entry = { mpt, e, ids: [] } as Sel))
    const id = Number(b.master_id)
    const id2 = Number(b.secondary_id ?? 0)
    const mask = Number(b.optmask_id ?? 0)
    if (id2) (entry.ranges ??= []).push([id, id2])
    else if (mask & 64) (entry.ex ??= []).push(id)
    else entry.ids.push(id)
    if (mask & ~64) ((entry.masks ??= {})[String(mask & ~64)] ??= []).push(id)
    let set = wantNames.get(e)
    if (!set) wantNames.set(e, (set = new Set()))
    set.add(id)
  }
  for (const t of parts.titles) specOf(t.p, t.reportset_id).title = t.title1 ? String(t.title1).trim() || null : null
  return { specs, wantNames }
}

/** The meta tables' names: entity types (-1), report types (-2), measures (-3), calculations (-4), and relative periods (dynadate, 703). */
export const META_SQL: Array<[number, string]> = [
  [-1, 'SELECT entmaj_id AS id, uientmaj_n AS n FROM iddb_custrpt_meta_prod.dbo.entmaj'],
  [-2, 'SELECT rpttype_id AS id, rpttype_n AS n FROM iddb_custrpt_meta_prod.dbo.rpttype'],
  [-3, 'SELECT entmaj_id AS id, measure_n AS n FROM iddb_custrpt_meta_prod.dbo.measures'],
  [-4, 'SELECT calc_id AS id, calc_n AS n FROM iddb_custrpt_meta_prod.dbo.calc'],
  [703, 'SELECT dynadate_id AS id, dynadate_s AS n FROM iddb_custrpt_meta_prod.dbo.dynadate'],
]

/** Where each entity type's names live: its id column and full-name column in iddb_master. */
export const NAME_FIELDS_SQL = `SELECT e.entmaj_id, pk.table_n, pk.field_n AS id_field, nm.field_n AS name_field
  FROM iddb_custrpt_meta_prod.dbo.entfields pk
  JOIN iddb_custrpt_meta_prod.dbo.entfields nm ON nm.entmaj_n = pk.entmaj_n AND nm.table_n = pk.table_n AND nm.entmin_n = 'full name' AND nm.active_f = 1
  JOIN iddb_custrpt_meta_prod.dbo.entmaj e ON e.entmaj_n = pk.entmaj_n
  WHERE pk.keytype_c = 'PK' AND pk.entmin_n = 'id' AND pk.active_f = 1 AND pk.db_a = 'dbmst'`

/** The SQL that reads these ids' names, or null when the entity type's fields are not plain identifiers. */
export function namesSql(f: { table_n: string; id_field: string; name_field: string }, ids: number[]): string | null {
  if (!/^[A-Za-z0-9_]+$/.test(f.table_n + f.id_field + f.name_field)) return null
  return `SELECT ${f.id_field} AS id, MAX(${f.name_field}) AS n FROM iddb_master.dbo.${f.table_n} WHERE ${f.id_field} IN (${ints(ids)}) GROUP BY ${f.id_field}`
}

// ------------------------------------------------------------------ the live connection

/** The connection settings, or null when this deployment has none. */
export function sql360Config(env: Record<string, string | undefined> = process.env): sql.config | null {
  const raw = env.SQL360_SERVER?.trim()
  const user = env.SQL360_USERNAME?.trim()
  const password = env.SQL360_PASSWORD
  if (!raw || !user || !password) return null
  const [server, port] = raw.replace(/^tcp:/, '').split(',')
  return {
    server: server!,
    port: port ? Number(port) : 1433,
    database: 'iddb_custrpt',
    user,
    password,
    options: { encrypt: true, trustServerCertificate: true, readOnlyIntent: true },
    requestTimeout: 120_000,
    connectionTimeout: 20_000,
    pool: { max: 4, min: 0, idleTimeoutMillis: 300_000 },
  }
}

export const live360Configured = () => Boolean(sql360Config())

declare global {
  var __sql360Pool: Promise<sql.ConnectionPool> | undefined
}

/** One SELECT against 360. Anything else is refused before it is sent. */
export async function q360<T = Row>(text: string): Promise<T[]> {
  if (!/^\s*(SELECT|WITH)\b/i.test(text)) throw new Error('360 is read only: SELECT statements only.')
  const config = sql360Config()
  if (!config) throw new Error('The 360 SQL Server is not configured here (SQL360_SERVER).')
  globalThis.__sql360Pool ??= new sql.ConnectionPool(config).connect().catch((err) => {
    globalThis.__sql360Pool = undefined
    throw err
  })
  const pool = await globalThis.__sql360Pool
  const r = await pool.request().query(`SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; ${text}`)
  return (r.recordset ?? []) as T[]
}

// ------------------------------------------------------------------ the import's reads

const TTL = 30 * 60_000
let index: { at: number; value: Promise<ClientIndex> } | null = null

interface ClientIndex {
  /** Reports used since SINCE, per client prefix and owner. */
  counts: Array<{ p: string; usrsetId: number; usrId: number; n: number }>
  /** Client (user set) names, license groups and mnemonics, from iddb_ar. */
  sets: Map<number, { name: string; licenseGroup: string | null; mnemonic: string }>
  /** The table prefix of each owner's client. */
  prefixOf: Map<number, string>
  at: Date
}

/** Every client's report counts by owner, read once and kept for half an hour (about 9 seconds across 2,370 clients). */
function clientIndex(): Promise<ClientIndex> {
  if (index && Date.now() - index.at < TTL) return index.value
  const value = (async (): Promise<ClientIndex> => {
    const prefixes = (await q360<{ p: string }>(`SELECT LEFT(name, LEN(name) - LEN('_reportset')) AS p FROM sys.tables WHERE name LIKE '%[_]reportset'`))
      .map((r) => r.p)
      .filter((p) => /^[A-Za-z0-9_]+$/.test(p))
    const counts: ClientIndex['counts'] = []
    for (const part of chunks(prefixes, 150)) {
      const rows = await q360<{ p: string; usrset_id: number; usr_id: number; n: number }>(
        part.map((p) => `SELECT '${p}' AS p, usrset_id, usr_id, count(*) AS n FROM [${p}_reportset] WHERE lastused_d >= '${SINCE}' GROUP BY usrset_id, usr_id`).join(' UNION ALL '),
      )
      for (const r of rows) counts.push({ p: r.p, usrsetId: Number(r.usrset_id), usrId: Number(r.usr_id), n: Number(r.n) })
    }
    const setIds = [...new Set(counts.map((c) => c.usrsetId))]
    const sets = new Map<number, { name: string; licenseGroup: string | null; mnemonic: string }>()
    for (const part of chunks(setIds, 2000)) {
      for (const s of await q360<Row>(
        `SELECT s.usrset_id, s.usrset_n, s.mnemonic_a, l.LicenseGrp_n FROM iddb_ar.dbo.USRSET s LEFT JOIN iddb_ar.dbo.LICENSEGRP l ON l.LicenseGrp_id = s.licensegrp_id WHERE s.usrset_id IN (${ints(part)})`,
      ))
        sets.set(Number(s.usrset_id), { name: String(s.usrset_n ?? '').trim(), licenseGroup: s.LicenseGrp_n == null ? null : String(s.LicenseGrp_n).trim(), mnemonic: String(s.mnemonic_a ?? '').trim().toLowerCase() })
    }
    return { counts, sets, prefixOf: new Map(counts.map((c) => [c.usrId, c.p])), at: new Date() }
  })()
  index = { at: Date.now(), value }
  value.catch(() => (index = null))
  return value
}

export async function liveClients(q: string): Promise<Array<{ usrsetId: number; name: string; licenseGroup: string | null; reports: number }>> {
  const ix = await clientIndex()
  const by = new Map<number, number>()
  for (const c of ix.counts) by.set(c.usrsetId, (by.get(c.usrsetId) ?? 0) + c.n)
  const needle = q.trim().toLowerCase()
  return [...by]
    .map(([usrsetId, reports]) => {
      const s = ix.sets.get(usrsetId)
      return { usrsetId, name: s?.name || `Client ${usrsetId}`, licenseGroup: s?.licenseGroup ?? null, mnemonic: s?.mnemonic ?? '', reports }
    })
    .filter((c) => !needle || [c.name, c.licenseGroup ?? '', c.mnemonic].some((x) => x.toLowerCase().includes(needle)))
    .sort((a, b) => b.reports - a.reports)
    .slice(0, 60)
    .map(({ mnemonic: _m, ...c }) => c)
}

export async function liveUsers(usrsetId: number): Promise<Array<{ usrId: number; name: string; reports: number }>> {
  const ix = await clientIndex()
  const mine = ix.counts.filter((c) => c.usrsetId === usrsetId)
  const names = new Map<number, string>()
  for (const part of chunks(mine.map((c) => c.usrId), 2000))
    for (const u of await q360<Row>(`SELECT Usr_id, Usr_n FROM iddb_ar.dbo.USR WHERE Usr_id IN (${ints(part)})`)) names.set(Number(u.Usr_id), String(u.Usr_n ?? '').trim())
  return mine.map((c) => ({ usrId: c.usrId, name: names.get(c.usrId) || `User ${c.usrId}`, reports: c.n })).sort((a, b) => b.reports - a.reports)
}

let meta: { at: number; value: Promise<Map<string, string>> } | null = null
/** The meta tables' names, keyed as the snapshot keys them ("-2:7"), kept for half an hour. */
function metaNames(): Promise<Map<string, string>> {
  if (meta && Date.now() - meta.at < TTL) return meta.value
  const value = (async () => {
    const out = new Map<string, string>()
    for (const [e, text] of META_SQL) for (const r of await q360<{ id: number; n: string }>(text)) out.set(`${e}:${Number(r.id)}`, String(r.n).trim())
    return out
  })()
  meta = { at: Date.now(), value }
  value.catch(() => (meta = null))
  return value
}

export async function liveReports(usrId: number): Promise<Array<{ key: string; name: string; type: string; lastUsed: string | null }>> {
  const ix = await clientIndex()
  const p = ix.prefixOf.get(usrId)
  if (!p) return []
  const [heads, names] = await Promise.all([q360<Row>(`${headSql(p, `r.usr_id = ${ints([usrId])} AND r.lastused_d >= '${SINCE}'`)} ORDER BY r.lastused_d DESC`), metaNames()])
  return heads.map((h) => ({
    key: `${p.toLowerCase()}:${Number(h.reportset_id)}`,
    name: String(h.reportset_n ?? '').trim() || `Report ${h.reportset_id}`,
    type: (h.rpttype_id == null ? undefined : names.get(`-2:${Number(h.rpttype_id)}`)) ?? 'Report',
    lastUsed: h.lastused_d instanceof Date ? h.lastused_d.toISOString().slice(0, 10) : null,
  }))
}

/** One report, read live: its head, owner and spec. The key is "mnemonic:reportset_id", as the snapshot keys it. */
export async function liveReport(key: string): Promise<{ name: string; client: string; user: string; mnemonic: string; usrId: number; lastUsed: Date | null; spec: Raw360Spec }> {
  const m = /^([A-Za-z0-9_]+):(\d{1,12})$/.exec(key)
  if (!m) throw new Error('That is not a 360 report.')
  const ix = await clientIndex()
  // Only a prefix 360 itself lists as a client's tables is ever put in SQL.
  const p = [...new Set(ix.counts.map((c) => c.p))].find((x) => x.toLowerCase() === m[1]!.toLowerCase())
  if (!p) throw new Error('That client has no 360 reports used this year.')
  const id = Number(m[2])
  const [head] = await q360<Row>(headSql(p, `r.reportset_id = ${ints([id])}`))
  if (!head) throw new Error('That report is no longer in 360.')
  const sqls = partsSql(new Map([[p, [id]]]))
  const [cols, opts, sels, titles] = await Promise.all([q360(sqls.cols), q360(sqls.opts), q360(sqls.sels), q360(sqls.titles)])
  const spec = assembleSpecs({ cols, opts, sels, titles }).specs.get(`${p.toLowerCase()}:${id}`) ?? { rpttype: null, title: null, cols: [], opts: [], sel: [] }
  spec.rpttype = head.rpttype_id == null ? null : Number(head.rpttype_id)
  const usrId = Number(head.usr_id)
  const [u] = await q360<Row>(`SELECT Usr_n FROM iddb_ar.dbo.USR WHERE Usr_id = ${ints([usrId])}`)
  return {
    name: String(head.reportset_n ?? '').trim() || `Report ${id}`,
    client: ix.sets.get(Number(head.usrset_id))?.name || p,
    user: String(u?.Usr_n ?? '').trim() || `User ${usrId}`,
    mnemonic: p.toLowerCase(),
    usrId,
    lastUsed: head.lastused_d instanceof Date ? head.lastused_d : null,
    spec,
  }
}

let fields: { at: number; value: Promise<Map<number, { table_n: string; id_field: string; name_field: string }>> } | null = null

/** The names a spec refers to, read live: meta names from the cache, selection names from iddb_master. */
export async function liveLookup(raw: Raw360Spec): Promise<Lookup> {
  const names = new Map(await metaNames())
  if (!fields || Date.now() - fields.at > TTL) {
    const value = q360<{ entmaj_id: number; table_n: string; id_field: string; name_field: string }>(NAME_FIELDS_SQL).then((rows) => new Map(rows.map((f) => [Number(f.entmaj_id), f])))
    fields = { at: Date.now(), value }
    value.catch(() => (fields = null))
  }
  const where = await fields.value
  const want = new Map<number, Set<number>>()
  for (const s of raw.sel) for (const id of [...s.ids, ...(s.ex ?? [])]) (want.get(s.e) ?? want.set(s.e, new Set()).get(s.e)!).add(id)
  for (const [e, ids] of want) {
    const f = where.get(e)
    if (!f) continue
    for (const part of chunks([...ids], 2000)) {
      const text = namesSql(f, part)
      if (!text) break
      for (const r of await q360<{ id: number; n: string | null }>(text)) if (r.n != null && String(r.n).trim()) names.set(`${e}:${Number(r.id)}`, String(r.n).trim())
    }
  }
  return {
    name: (e, id) => names.get(`${e}:${id}`),
    type: (e) => names.get(`-1:${e}`),
    report: (id) => names.get(`-2:${id}`),
    measure: (e) => names.get(`-3:${e}`),
    calc: (id) => names.get(`-4:${id}`),
  }
}

/** What the live source holds: the reports used this year, and when the client list was read. */
export async function liveInfo(): Promise<{ reports: number; read: string }> {
  const ix = await clientIndex()
  return { reports: ix.counts.reduce((a, c) => a + c.n, 0), read: ix.at.toISOString() }
}
