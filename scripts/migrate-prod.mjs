/**
 * Run pending migrations against DATABASE_URL, then get out of the way.
 *
 *   npm run db:migrate:prod
 *
 * This is the by-hand version, for getting a database current without waiting
 * for a deploy. The container migrates itself on boot through
 * src/instrumentation.ts — this file used to be wired into package.json's
 * `start`, which never ran, because the image's CMD is `node server.js` and
 * npm is not involved.
 *
 * Plain .mjs, not TypeScript: `tsx` is a devDependency and App Service prunes
 * those. `drizzle-orm` and `pg` are both production dependencies.
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
