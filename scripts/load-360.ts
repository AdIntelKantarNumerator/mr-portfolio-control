/**
 * Copy 360 Explore reports for Report Builder's import (12 November 2026).
 *
 *   npm run load:360                       # new and changed reports, into DATABASE_URL (or local PGlite)
 *   npm run load:360 -- --full             # every report again
 *   npm run load:360 -- --clients zmnyai   # only these clients (user-set mnemonics), for a quick look
 *
 * Reads the 360 SQL Server named in ../.sql360.env (SQL360_SERVER, _USERNAME,
 * _PASSWORD). The app cannot reach it - it is on a private network - so this
 * runs from a machine that can, the way load:classic does for Classic.
 *
 * WHAT IT COPIES
 *
 * Every Explore report used in 2026 (Scott, 12 November 2026: about 95,000),
 * from the per-client tables in iddb_custrpt: each client (user set) has its
 * own <mnemonic>_reportset, _reportdet, _reportcolset, _reportcol,
 * _reportcolset_rptopt, _bucketset and _bucketdet. A report's parts hang off
 * _reportdet by mpt (11 = report columns, the layout; 3 product, 1 media,
 * 2 market, 6 time, 12 media market... = selections, as bucket sets). The
 * owners and their user sets and license groups come from iddb_ar, the names
 * the selections refer to from iddb_master (located through
 * iddb_custrpt_meta_prod.entfields), and the meta tables' names for entity
 * types, report types, measures and calculations go in with them.
 *
 * A reload compares each report's version - the latest change to it, its
 * layout or its selections - with what was copied, and fetches only reports
 * that are new or changed, and only names it has not got.
 *
 * NOT ai_AddMasterJobQ. That procedure does not return a spec: it puts a
 * report on 360's job queue (it runs and emails its owner) and stamps it as
 * used. This reads the tables, SELECTs only, with read-only intent.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sql from 'mssql'
import { sql as dsql } from 'drizzle-orm'
import { connect, warnIfServerRunning } from './_connect'

const SINCE = '2026-01-01'
/** Clients per query: the per-client tables are read in batches, one UNION ALL each. */
const BATCH = 150

function readEnvFile(path: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
  )
}

const args = process.argv.slice(2)
const full = args.includes('--full')
const only = args.includes('--clients') ? args[args.indexOf('--clients') + 1]!.split(',').map((s) => s.trim().toLowerCase()) : null

/** A client mnemonic as a table prefix: letters, digits and underscore only. */
const safe = (p: string) => {
  if (!/^[A-Za-z0-9_]+$/.test(p)) throw new Error(`Unexpected table prefix ${p}`)
  return p
}
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d))

async function main() {
  const env = readEnvFile(process.env.SQL360_ENV ?? join(process.cwd(), '..', '.sql360.env'))
  if (!env.SQL360_USERNAME || !env.SQL360_PASSWORD) throw new Error('Fill in SQL360_USERNAME and SQL360_PASSWORD in ../.sql360.env.')
  const [server, port] = env.SQL360_SERVER!.replace(/^tcp:/, '').split(',')
  const pool = await sql.connect({
    server: server!,
    port: port ? Number(port) : 1433,
    database: 'iddb_custrpt',
    user: env.SQL360_USERNAME,
    password: env.SQL360_PASSWORD,
    options: { encrypt: true, trustServerCertificate: true, readOnlyIntent: true },
    requestTimeout: 600_000,
    connectionTimeout: 30_000,
  })
  const q = async <T = Record<string, unknown>>(text: string): Promise<T[]> => {
    if (!/^\s*(SELECT|WITH)\b/i.test(text)) throw new Error('read-only: SELECT only')
    const r = await pool.request().query(`SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; ${text}`)
    return (r.recordset ?? []) as T[]
  }
  const { db, close, embedded } = await connect()
  const s = await import('../src/db/schema')
  const t0 = Date.now()
  const lap = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`)

  try {
    // ---- which clients have report tables
    let prefixes = (await q<{ p: string }>(`SELECT LEFT(name, LEN(name) - LEN('_reportset')) AS p FROM sys.tables WHERE name LIKE '%[_]reportset' ORDER BY name`)).map((r) => r.p)
    if (only) prefixes = prefixes.filter((p) => only.includes(p.toLowerCase()))
    lap(`${prefixes.length} clients`)

    // ---- the reports used since SINCE, with their version (the latest change to the report, its layout or its selections)
    type Head = { p: string; reportset_id: number; usr_id: number; usrset_id: number; reportset_n: string; lastused_d: Date | null; rpttype_id: number | null; version: string }
    const heads: Head[] = []
    for (const batch of chunks(prefixes, BATCH)) {
      const parts = batch.map((raw) => {
        const p = safe(raw)
        return `SELECT '${p}' AS p, r.reportset_id, r.usr_id, r.usrset_id, r.reportset_n, r.lastused_d,
          (SELECT TOP 1 cs.rpttype_id FROM [${p}_reportdet] d JOIN [${p}_reportcolset] cs ON cs.reportcolset_id = d.master_id WHERE d.reportset_id = r.reportset_id AND d.mpt_id = 11) AS rpttype_id,
          CONVERT(varchar(23), (SELECT MAX(m) FROM (
            SELECT r.modify_d AS m
            UNION ALL SELECT cs.modify_d FROM [${p}_reportdet] d JOIN [${p}_reportcolset] cs ON cs.reportcolset_id = d.master_id WHERE d.reportset_id = r.reportset_id AND d.mpt_id = 11
            UNION ALL SELECT bs.modify_d FROM [${p}_reportdet] d JOIN [${p}_bucketset] bs ON bs.bucketset_id = d.master_id WHERE d.reportset_id = r.reportset_id AND d.mpt_id NOT IN (11, 13)
          ) v), 126) AS version
          FROM [${p}_reportset] r WHERE r.lastused_d >= '${SINCE}'`
      })
      heads.push(...(await q<Head>(parts.join(' UNION ALL '))))
    }
    lap(`${heads.length} reports used since ${SINCE}`)

    // ---- which are new or changed
    const have = new Map<string, string>()
    if (!full) for (const r of await db.select({ k: s.x360Reports.reportKey, v: s.x360Reports.version }).from(s.x360Reports)) have.set(r.k, r.v)
    const keyOf = (h: Pick<Head, 'p' | 'reportset_id'>) => `${h.p.toLowerCase()}:${h.reportset_id}`
    const todo = heads.filter((h) => have.get(keyOf(h)) !== (h.version ?? ''))
    lap(`${todo.length} new or changed`)

    // ---- their parts, client by client
    const byClient = new Map<string, Head[]>()
    for (const h of todo) byClient.set(h.p, [...(byClient.get(h.p) ?? []), h])
    const wantNames = new Map<number, Set<number>>()
    let done = 0
    for (const batch of chunks([...byClient.keys()], 40)) {
      const ids = (p: string) => byClient.get(p)!.map((h) => Number(h.reportset_id)).join(',')
      const cols = await q<Record<string, unknown>>(
        batch
          .map((raw) => {
            const p = safe(raw)
            return `SELECT '${p}' AS p, d.reportset_id, c.coltype_id, c.entmaj_id, c.entmin_id, c.order_id, c.sortkey_id, c.totalkey_f, c.calc_id, c.demoset_id, c.reportcol_n
              FROM [${p}_reportdet] d JOIN [${p}_reportcol] c ON c.reportcolset_id = d.master_id WHERE d.mpt_id = 11 AND d.reportset_id IN (${ids(raw)})`
          })
          .join(' UNION ALL '),
      )
      const opts = await q<Record<string, unknown>>(
        batch
          .map((raw) => {
            const p = safe(raw)
            return `SELECT '${p}' AS p, d.reportset_id, o.rptopt_id, o.entmaj_id, o.entmin_id, o.string_n, o.date1_d, o.date2_d, o.long_v, o.double_v
              FROM [${p}_reportdet] d JOIN [${p}_reportcolset_rptopt] o ON o.reportcolset_id = d.master_id WHERE d.mpt_id = 11 AND d.reportset_id IN (${ids(raw)})`
          })
          .join(' UNION ALL '),
      )
      const sels = await q<Record<string, unknown>>(
        batch
          .map((raw) => {
            const p = safe(raw)
            return `SELECT '${p}' AS p, d.reportset_id, d.mpt_id, b.entmaj_id, b.master_id, b.secondary_id, b.optmask_id
              FROM [${p}_reportdet] d JOIN [${p}_bucketdet] b ON b.bucketset_id = d.master_id WHERE d.mpt_id NOT IN (11, 13) AND d.reportset_id IN (${ids(raw)})`
          })
          .join(' UNION ALL '),
      )
      const titles = await q<Record<string, unknown>>(
        batch.map((raw) => `SELECT '${safe(raw)}' AS p, reportset_id, title1 FROM [${safe(raw)}_reportsetup] WHERE reportset_id IN (${ids(raw)})`).join(' UNION ALL '),
      )

      type Sel = { mpt: number; e: number; ids: number[]; ex?: number[]; ranges?: number[][]; masks?: Record<string, number[]> }
      const specs = new Map<string, { rpttype: number | null; title: string | null; cols: unknown[]; opts: unknown[]; sel: Sel[] }>()
      const specOf = (p: unknown, id: unknown) => {
        const k = `${String(p).toLowerCase()}:${Number(id)}`
        let v = specs.get(k)
        if (!v) specs.set(k, (v = { rpttype: null, title: null, cols: [], opts: [], sel: [] }))
        return v
      }
      for (const c of cols)
        specOf(c.p, c.reportset_id).cols.push({ type: c.coltype_id, entmaj: c.entmaj_id, entmin: c.entmin_id, order: c.order_id, sort: c.sortkey_id, total: c.totalkey_f, calc: c.calc_id, demo: c.demoset_id, name: String(c.reportcol_n ?? '').trim() })
      for (const o of opts)
        specOf(o.p, o.reportset_id).opts.push({ opt: o.rptopt_id, entmaj: o.entmaj_id, entmin: o.entmin_id, str: o.string_n ? String(o.string_n).trim() : null, d1: iso(o.date1_d), d2: iso(o.date2_d), long: o.long_v ?? null, dbl: o.double_v ?? null })
      for (const b of sels) {
        const e = Number(b.entmaj_id)
        // Stored compactly - one list per part and entity type - because some reports pick thousands of ids:
        // ids picked, ex excluded (optmask 64), ranges for time buckets (start and end day), masks for any other option.
        const spec = specOf(b.p, b.reportset_id)
        const mpt = Number(b.mpt_id)
        let entry = spec.sel.find((x) => x.mpt === mpt && x.e === e)
        if (!entry) spec.sel.push((entry = { mpt, e, ids: [] }))
        const id = Number(b.master_id)
        const id2 = Number(b.secondary_id ?? 0)
        const mask = Number(b.optmask_id ?? 0)
        if (id2) (entry.ranges ??= []).push([id, id2])
        else if (mask & 64) (entry.ex ??= []).push(id)
        else entry.ids.push(id)
        if (mask & ~64) ((entry.masks ??= {})[String(mask & ~64)] ??= []).push(id)
        let set = wantNames.get(e)
        if (!set) wantNames.set(e, (set = new Set()))
        set.add(Number(b.master_id))
      }
      for (const t of titles) specOf(t.p, t.reportset_id).title = t.title1 ? String(t.title1).trim() || null : null

      const rows = batch.flatMap((p) =>
        byClient.get(p)!.map((h) => {
          const spec = { ...specOf(p, h.reportset_id), rpttype: h.rpttype_id == null ? null : Number(h.rpttype_id) }
          return {
            reportKey: keyOf(h),
            mnemonic: p.toLowerCase(),
            reportsetId: Number(h.reportset_id),
            usrId: Number(h.usr_id),
            usrsetId: Number(h.usrset_id),
            name: String(h.reportset_n ?? '').trim() || `Report ${h.reportset_id}`,
            rpttypeId: spec.rpttype,
            lastUsed: h.lastused_d ? new Date(h.lastused_d) : null,
            version: h.version ?? '',
            spec,
            loadedAt: new Date(),
          }
        }),
      )
      for (const part of chunks(rows, 500))
        await db
          .insert(s.x360Reports)
          .values(part)
          .onConflictDoUpdate({
            target: s.x360Reports.reportKey,
            set: { usrId: dsql`excluded.usr_id`, usrsetId: dsql`excluded.usrset_id`, name: dsql`excluded.name`, rpttypeId: dsql`excluded.rpttype_id`, lastUsed: dsql`excluded.last_used`, version: dsql`excluded.version`, spec: dsql`excluded.spec`, loadedAt: dsql`excluded.loaded_at` },
          })
      done += rows.length
      lap(`${done} of ${todo.length} reports copied`)
    }
    // Last used moves every time a report runs; keep it current without refetching unchanged reports.
    for (const part of chunks(heads.filter((h) => !todo.includes(h)), 1000))
      for (const h of part) await db.update(s.x360Reports).set({ lastUsed: h.lastused_d ? new Date(h.lastused_d) : null }).where(dsql`${s.x360Reports.reportKey} = ${keyOf(h)}`)

    // ---- owners, their user sets and license groups
    const usrIds = [...new Set(heads.map((h) => Number(h.usr_id)))]
    for (const part of chunks(usrIds, 2000)) {
      const users = await q<Record<string, unknown>>(
        `SELECT u.Usr_id, u.Usr_n, s.usrset_id, s.usrset_n, s.mnemonic_a, s.licensegrp_id, l.LicenseGrp_n
         FROM iddb_ar.dbo.USR u JOIN iddb_ar.dbo.USRSET s ON s.usrset_id = u.usrset_id LEFT JOIN iddb_ar.dbo.LICENSEGRP l ON l.LicenseGrp_id = s.licensegrp_id
         WHERE u.Usr_id IN (${part.join(',')})`,
      )
      const rows = users.map((u) => ({
        usrId: Number(u.Usr_id),
        usrN: String(u.Usr_n ?? '').trim() || `User ${u.Usr_id}`,
        usrsetId: Number(u.usrset_id),
        usrsetN: String(u.usrset_n ?? '').trim(),
        mnemonic: String(u.mnemonic_a ?? '').trim().toLowerCase(),
        licensegrpId: u.licensegrp_id == null ? null : Number(u.licensegrp_id),
        licensegrpN: u.LicenseGrp_n == null ? null : String(u.LicenseGrp_n).trim(),
        loadedAt: new Date(),
      }))
      if (rows.length)
        await db
          .insert(s.x360Users)
          .values(rows)
          .onConflictDoUpdate({ target: s.x360Users.usrId, set: { usrN: dsql`excluded.usr_n`, usrsetId: dsql`excluded.usrset_id`, usrsetN: dsql`excluded.usrset_n`, mnemonic: dsql`excluded.mnemonic`, licensegrpId: dsql`excluded.licensegrp_id`, licensegrpN: dsql`excluded.licensegrp_n`, loadedAt: dsql`excluded.loaded_at` } })
    }
    lap(`${usrIds.length} owners`)

    // ---- names: entity types, report types, measures and calculations (negative "types"), then each id a selection names
    const ref: Array<{ entmajId: number; masterId: number; name: string }> = []
    for (const r of await q<{ id: number; n: string }>(`SELECT entmaj_id AS id, uientmaj_n AS n FROM iddb_custrpt_meta_prod.dbo.entmaj`)) ref.push({ entmajId: -1, masterId: Number(r.id), name: String(r.n).trim() })
    for (const r of await q<{ id: number; n: string }>(`SELECT rpttype_id AS id, rpttype_n AS n FROM iddb_custrpt_meta_prod.dbo.rpttype`)) ref.push({ entmajId: -2, masterId: Number(r.id), name: String(r.n).trim() })
    for (const r of await q<{ id: number; n: string }>(`SELECT entmaj_id AS id, measure_n AS n FROM iddb_custrpt_meta_prod.dbo.measures`)) ref.push({ entmajId: -3, masterId: Number(r.id), name: String(r.n).trim() })
    for (const r of await q<{ id: number; n: string }>(`SELECT calc_id AS id, calc_n AS n FROM iddb_custrpt_meta_prod.dbo.calc`)) ref.push({ entmajId: -4, masterId: Number(r.id), name: String(r.n).trim() })
    // Relative periods ("Current Calendar YTD"), picked as dynadate (703) ids.
    for (const r of await q<{ id: number; n: string }>(`SELECT dynadate_id AS id, dynadate_s AS n FROM iddb_custrpt_meta_prod.dbo.dynadate`)) ref.push({ entmajId: 703, masterId: Number(r.id), name: String(r.n).trim() })
    const nameRow = (r: { entmajId: number; masterId: number; name: string }) => ({ nameKey: `${r.entmajId}:${r.masterId}`, ...r })
    for (const part of chunks(ref.map(nameRow), 1000)) await db.insert(s.x360Names).values(part).onConflictDoUpdate({ target: s.x360Names.nameKey, set: { name: dsql`excluded.name` } })

    // Where each entity type's names live: its id column and full-name column in iddb_master.
    const fields = await q<{ entmaj_id: number; table_n: string; id_field: string; name_field: string }>(
      `SELECT e.entmaj_id, pk.table_n, pk.field_n AS id_field, nm.field_n AS name_field
       FROM iddb_custrpt_meta_prod.dbo.entfields pk
       JOIN iddb_custrpt_meta_prod.dbo.entfields nm ON nm.entmaj_n = pk.entmaj_n AND nm.table_n = pk.table_n AND nm.entmin_n = 'full name' AND nm.active_f = 1
       JOIN iddb_custrpt_meta_prod.dbo.entmaj e ON e.entmaj_n = pk.entmaj_n
       WHERE pk.keytype_c = 'PK' AND pk.entmin_n = 'id' AND pk.active_f = 1 AND pk.db_a = 'dbmst'`,
    )
    const where = new Map(fields.map((f) => [Number(f.entmaj_id), f]))
    let named = 0
    for (const [e, idsSet] of wantNames) {
      const f = where.get(e)
      if (!f || !/^[A-Za-z0-9_]+$/.test(f.table_n + f.id_field + f.name_field)) continue
      const known = new Set(
        (await db.select({ id: s.x360Names.masterId }).from(s.x360Names).where(dsql`${s.x360Names.entmajId} = ${e}`)).map((r) => Number(r.id)),
      )
      const missing = [...idsSet].filter((id) => !known.has(id))
      for (const part of chunks(missing, 2000)) {
        const rows = await q<{ id: number; n: string }>(`SELECT ${f.id_field} AS id, MAX(${f.name_field}) AS n FROM iddb_master.dbo.${f.table_n} WHERE ${f.id_field} IN (${part.join(',')}) GROUP BY ${f.id_field}`)
        const out = rows.filter((r) => r.n != null && String(r.n).trim()).map((r) => nameRow({ entmajId: e, masterId: Number(r.id), name: String(r.n).trim() }))
        for (const p2 of chunks(out, 1000)) await db.insert(s.x360Names).values(p2).onConflictDoUpdate({ target: s.x360Names.nameKey, set: { name: dsql`excluded.name` } })
        named += out.length
      }
    }
    lap(`${named} new names`)
    await warnIfServerRunning(embedded)
  } finally {
    await pool.close()
    await close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
