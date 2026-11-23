/**
 * Load Client Evaluation's snapshots from this machine.
 *
 *   npm run load:client-eval                     # all three platforms
 *   npm run load:client-eval -- classic          # one or more: 360 classic magnifier
 *   npm run load:client-eval -- --no-model       # match without asking the model
 *
 * Classic can only be loaded this way: its SQL Server (../.sqlserver.env) does
 * not let the app in. 360 (../.sql360.env) and Magnifier (../.magnifier-mysql.env)
 * can also be refreshed from the page. Writes into DATABASE_URL, or the local
 * PGlite, and rebuilds the client list once at the end.
 *
 * Read-only on every source: SELECTs only, read-only sessions.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sql from 'mssql'
import { connect, warnIfServerRunning } from './_connect'

function readEnvFile(path: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
  )
}

const args = process.argv.slice(2)
const useModel = !args.includes('--no-model')
const asked = args.filter((a) => !a.startsWith('--'))
const platforms = (asked.length ? asked : ['360', 'classic', 'magnifier']) as Array<'360' | 'classic' | 'magnifier'>
const parent = join(process.cwd(), '..')

async function main() {
  // Each source's login, from its file beside the repo, unless already set.
  if (platforms.includes('360') && !process.env.SQL360_SERVER) Object.assign(process.env, readEnvFile(process.env.SQL360_ENV ?? join(parent, '.sql360.env')))
  if (platforms.includes('magnifier') && !process.env.MAGNIFIER_MYSQL_HOST) {
    const m = readEnvFile(process.env.MAGNIFIER_ENV ?? join(parent, '.magnifier-mysql.env'))
    Object.assign(process.env, { MAGNIFIER_MYSQL_HOST: m.MYSQL_HOST, MAGNIFIER_MYSQL_PORT: m.MYSQL_PORT, MAGNIFIER_MYSQL_USER: m.MYSQL_USER, MAGNIFIER_MYSQL_PASSWORD: m.MYSQL_PASSWORD, MAGNIFIER_MYSQL_DATABASE: m.MYSQL_DATABASE || 'competitrack_user_db' })
  }

  // Magnifier's saved searches come from its MongoDB (lib/client-eval/saved-searches.ts).
  if (platforms.includes('magnifier') && !process.env.MAGNIFIER_MONGO_URL) {
    try {
      Object.assign(process.env, readEnvFile(join(parent, '.magnifier-mongo.env')))
    } catch {
      console.warn('  No ../.magnifier-mongo.env: Magnifier saved searches are not counted.')
    }
  }
  // Magnifier's REL codes are named from Databricks (lib/client-eval/rel-names.ts).
  if (platforms.includes('magnifier') && !process.env.DATABRICKS_HOST) {
    try {
      Object.assign(process.env, readEnvFile(process.env.DATABRICKS_ENV ?? join(parent, '.databricks.env')))
    } catch {
      console.warn('  No ../.databricks.env: Magnifier REL codes will be shown as codes.')
    }
  }

  const { db, embedded, close } = await connect()
  await warnIfServerRunning(embedded)
  const store = await import('../src/lib/client-eval/store')
  const by = process.env.CLIENT_EVAL_BY ?? 'laptop'
  try {
    for (const p of platforms) {
      const t0 = Date.now()
      await store.markRunning(db, p, by)
      const progress = async (step: string, done = 0, total = 0) => {
        process.stdout.write(`\r  ${p}: ${step}${total ? ` (${done}/${total})` : ''}`.padEnd(80))
        await store.progressWriter(db, p)(step, done, total)
      }
      try {
        let snap
        if (p === 'classic') {
          const env = readEnvFile(process.env.SQLSERVER_ENV_FILE ?? join(parent, '.sqlserver.env'))
          const [server, port] = env.SQLSERVER_SERVER!.replace(/^tcp:/, '').split(',')
          const pool = await new sql.ConnectionPool({
            server: server!,
            port: port ? Number(port) : 1433,
            database: env.SQLSERVER_DATABASE,
            user: env.SQLSERVER_USERNAME,
            password: env.SQLSERVER_PASSWORD,
            options: { encrypt: true, trustServerCertificate: true, readOnlyIntent: true },
            requestTimeout: 600_000,
            connectionTimeout: 30_000,
          }).connect()
          try {
            const { loadClassic } = await import('../src/lib/client-eval/load-classic')
            snap = await loadClassic(async (text) => {
              if (!/^\s*SELECT\b/i.test(text)) throw new Error('Classic is read only.')
              return (await pool.request().query(`SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; ${text}`)).recordset as Record<string, unknown>[]
            }, progress)
          } finally {
            await pool.close()
          }
        } else if (p === '360') {
          const { load360 } = await import('../src/lib/client-eval/load-360')
          snap = await load360(progress)
        } else {
          const m = await import('../src/lib/client-eval/load-magnifier')
          const conn = await m.connectMagnifier(m.magnifierConfig()!)
          try {
            snap = await m.loadMagnifier(conn, progress)
          } finally {
            await conn.end()
          }
        }
        process.stdout.write(`\r  ${p}: saving`.padEnd(80))
        await store.saveSnapshot(db, p, snap, by)
        console.log(`\r  ${p}: ${snap.accounts.length} accounts, ${snap.users.length} users, ${snap.reports.length} reports in ${Math.round((Date.now() - t0) / 1000)}s`.padEnd(80))
      } catch (err) {
        // Drizzle's own message lists every parameter; the cause is the part worth reading.
        const why = ((err as { cause?: Error }).cause ?? (err as Error)).message ?? String(err)
        await store.markFailed(db, p, new Error(why))
        console.error(`\n  ${p} failed:`, why.slice(0, 500))
      }
    }
    const r = await store.buildClients(db, { useModel, progress: (step, done, total) => void process.stdout.write(`\r  ${step}${total ? ` (${done}/${total})` : ''}`.padEnd(80)) })
    console.log(`\r  ${r.clients} clients; ${r.asked} close calls for the model${useModel ? '' : ' (not asked)'}`.padEnd(80))
  } finally {
    await close()
    if (platforms.includes('360')) {
      const pool = await globalThis.__sql360Pool?.catch(() => undefined)
      await pool?.close()
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
