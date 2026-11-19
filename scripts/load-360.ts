/**
 * Copy 360 Explore reports for Report Builder's import (12 November 2026).
 *
 *   npm run load:360                       # new and changed reports, into DATABASE_URL (or local PGlite)
 *   npm run load:360 -- --full             # every report again
 *   npm run load:360 -- --clients zmnyai   # only these clients (user-set mnemonics), for a quick look
 *
 * Reads the 360 SQL Server named in ../.sql360.env (SQL360_SERVER, _USERNAME,
 * _PASSWORD). Since 19 November 2026 the app reads 360 live where it is
 * configured (lib/import360/source.ts, whose queries this script shares), so
 * this snapshot is the fallback for a deployment without a 360 login.
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
import { assembleSpecs, chunks, headSql, META_SQL, NAME_FIELDS_SQL, namesSql, partsSql, safePrefix as safe, SINCE } from '../src/lib/import360/source'
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
      const parts = batch.map((raw) => headSql(safe(raw), `r.lastused_d >= '${SINCE}'`))
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
      // The same statements and assembly the live import uses (lib/import360/source.ts).
      const sqls = partsSql(new Map(batch.map((p) => [p, byClient.get(p)!.map((h) => Number(h.reportset_id))])))
      const assembled = assembleSpecs({ cols: await q(sqls.cols), opts: await q(sqls.opts), sels: await q(sqls.sels), titles: await q(sqls.titles) })
      for (const [e, ids] of assembled.wantNames) {
        let set = wantNames.get(e)
        if (!set) wantNames.set(e, (set = new Set()))
        for (const id of ids) set.add(id)
      }
      const specOf = (p: string, id: number) => assembled.specs.get(`${p.toLowerCase()}:${id}`) ?? { rpttype: null, title: null, cols: [], opts: [], sel: [] }

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
    for (const [entmajId, text] of META_SQL) for (const r of await q<{ id: number; n: string }>(text)) ref.push({ entmajId, masterId: Number(r.id), name: String(r.n).trim() })
    const nameRow = (r: { entmajId: number; masterId: number; name: string }) => ({ nameKey: `${r.entmajId}:${r.masterId}`, ...r })
    for (const part of chunks(ref.map(nameRow), 1000)) await db.insert(s.x360Names).values(part).onConflictDoUpdate({ target: s.x360Names.nameKey, set: { name: dsql`excluded.name` } })

    // Where each entity type's names live: its id column and full-name column in iddb_master.
    const fields = await q<{ entmaj_id: number; table_n: string; id_field: string; name_field: string }>(NAME_FIELDS_SQL)
    const where = new Map(fields.map((f) => [Number(f.entmaj_id), f]))
    let named = 0
    for (const [e, idsSet] of wantNames) {
      const f = where.get(e)
      if (!f || !namesSql(f, [0])) continue
      const known = new Set(
        (await db.select({ id: s.x360Names.masterId }).from(s.x360Names).where(dsql`${s.x360Names.entmajId} = ${e}`)).map((r) => Number(r.id)),
      )
      const missing = [...idsSet].filter((id) => !known.has(id))
      for (const part of chunks(missing, 2000)) {
        const rows = await q<{ id: number; n: string }>(namesSql(f, part)!)
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
