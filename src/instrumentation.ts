/**
 * Run pending migrations before this server answers anything.
 *
 * WHY HERE, AND NOT IN THE START SCRIPT
 *
 * The first attempt at this put the migration in package.json's `start`:
 *
 *   "start": "node scripts/migrate-prod.mjs && next start"
 *
 * which never ran. The image is a standalone Next build and its CMD is
 * `node server.js` — npm is not involved at all, so the script sat there
 * looking correct while the schema went unmigrated and every page that touched
 * a new column returned a 500. Exactly the failure it was written to prevent,
 * one level further down.
 *
 * Next calls `register` once per server instance, and waits for it before
 * serving requests. That is the actual boot hook, it works the same under
 * `next start` and under the standalone server, and because this file is part
 * of the app's module graph Next traces the migrator into the image rather
 * than leaving it behind.
 *
 * FAILING LOUDLY
 *
 * A failed migration throws, which stops the server starting. That is the
 * point: an app that boots against a schema it cannot use serves 500s that
 * look like a code fault, and somebody spends an hour reading application
 * logs. One that refuses to boot says what is wrong on the first line.
 *
 * The SQL files live in ./drizzle, which Next does not trace because nothing
 * imports them — the Dockerfile copies that folder into the runner stage. If
 * migrations ever stop applying in the container, that COPY is the first thing
 * to check.
 */
export async function register() {
  // `register` also runs in the edge runtime, where none of this exists.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const url = process.env.DATABASE_URL?.trim()

  // Local development runs on embedded PGlite and migrates through
  // `npm run db:migrate -- --local`. Nothing to do, and no reason to slow the
  // dev server's boot.
  if (!url || !/^postgres(ql)?:\/\//.test(url)) return

  const { Pool } = await import('pg')
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const { migrate } = await import('drizzle-orm/node-postgres/migrator')

  // The same TLS rule as src/db/client.ts and scripts/_connect.ts: on unless
  // the database is plainly local or somebody turned it off by name.
  const mode = process.env.DATABASE_SSL?.trim().toLowerCase()
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    host = ''
  }
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === ''
  const ssl =
    mode === 'no-verify'
      ? { rejectUnauthorized: false }
      : mode === 'off' || mode === 'disable' || /\bsslmode=disable\b/.test(url) || (isLocal && mode !== 'require')
        ? undefined
        : { rejectUnauthorized: true }

  const pool = new Pool({ connectionString: url, ssl, max: 1 })

  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
    console.log(`[migrate] Schema up to date at ${host}.`)
  } catch (err) {
    console.error('[migrate] FAILED — refusing to serve against a schema this build cannot use.')
    console.error(err)
    throw err
  } finally {
    await pool.end()
  }
}
