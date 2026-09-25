/**
 * Run pending migrations against DATABASE_URL, then get out of the way.
 *
 * WHY THIS EXISTS
 *
 * The site has now been taken down twice by the same mistake, and both times it
 * was mine: `npm run db:migrate` reads DATABASE_URL from the local environment,
 * so running it on a laptop migrates the laptop's database. The deploy then
 * ships code that selects columns the Azure database has never heard of, and
 * every page that touches those tables returns a 500 while the pages that do
 * not keep working — which makes it look like a code bug rather than a schema
 * one, and costs an hour before anybody checks.
 *
 * The fix is to stop having two places that can answer "has the schema been
 * migrated". Here, migrations run where the app runs, against the connection
 * string the app itself uses, every time it boots. There is no second answer to
 * get wrong.
 *
 * Plain .mjs, not TypeScript: `tsx` is a devDependency and App Service prunes
 * those, so a start script that needed it would fail exactly when it mattered.
 * `drizzle-orm` and `pg` are both production dependencies.
 *
 * Failing here stops the app from starting. That is deliberate. An app that
 * boots against a schema it cannot use serves 500s that look like a code fault;
 * one that refuses to boot says what is actually wrong, in the log, on the
 * first line.
 */
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

const url = process.env.DATABASE_URL?.trim()

if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  // Local development runs on embedded PGlite and migrates through
  // `npm run db:migrate`. Nothing to do, and no reason to block `next start`.
  console.log('[migrate] DATABASE_URL is not Postgres — skipping (local dev uses npm run db:migrate).')
  process.exit(0)
}

// Same rule as src/db/client.ts and scripts/_connect.ts: TLS on unless the
// database is plainly local or somebody turned it off by name.
const mode = process.env.DATABASE_SSL?.trim().toLowerCase()
const host = (() => {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
})()
const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === ''
const ssl =
  mode === 'no-verify'
    ? { rejectUnauthorized: false }
    : mode === 'off' || mode === 'disable' || /\bsslmode=disable\b/.test(url) || (isLocal && mode !== 'require')
      ? undefined
      : { rejectUnauthorized: true }

const pool = new Pool({ connectionString: url, ssl })

try {
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
  console.log('[migrate] Schema is up to date.')
} catch (err) {
  console.error('[migrate] FAILED — not starting the app against a schema it cannot use.')
  console.error(err)
  process.exit(1)
} finally {
  await pool.end()
}
