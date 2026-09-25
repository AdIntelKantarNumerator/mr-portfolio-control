/**
 * Applies the generated SQL migrations against whichever database
 * DATABASE_URL points at. Same migrations, both drivers.
 *
 *   npm run db:migrate              migrate whatever DATABASE_URL names
 *   npm run db:migrate -- --local   migrate the embedded database, explicitly
 *
 * WHY THIS ASKS RATHER THAN GUESSES
 *
 * This script used to treat an unset DATABASE_URL as "you meant the local
 * embedded database", migrate that, and print a success line. Which meant a
 * mistyped resource name, an expired az login, or a shell that had lost the
 * variable all produced output identical to a real migration — while the
 * database you were actually trying to migrate went untouched. The site was
 * down twice before anyone doubted the success message.
 *
 * Two answers to "which database did that migrate" is one too many. So the
 * local path is now something you ask for, and the script says which database
 * it is about to touch BEFORE touching it.
 */
import 'dotenv/config'

const LOCAL_FLAG = process.argv.includes('--local')

function redact(url: string): string {
  return url.replace(/:[^:@/]+@/, ':***@')
}

async function main() {
  const url = process.env.DATABASE_URL?.trim()
  const isPostgres = Boolean(url && /^postgres(ql)?:\/\//.test(url))
  const isPglite = Boolean(url?.startsWith('pglite:'))

  if (isPostgres) {
    if (LOCAL_FLAG) {
      throw new Error(
        'DATABASE_URL points at a Postgres server, but --local was passed. Refusing to guess ' +
          'which one you meant: unset DATABASE_URL for the embedded database, or drop --local.',
      )
    }

    const { Pool } = await import('pg')
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    const { sslOption } = await import('./_connect')

    // Announced first. If this names the wrong database, the useful moment to
    // notice is now and not after the ALTER TABLE.
    const host = (() => {
      try {
        return new URL(url!).host
      } catch {
        return '(unparseable host)'
      }
    })()
    console.log(`Migrating Postgres at ${host} …`)

    const pool = new Pool({ connectionString: url, ssl: sslOption(url) })
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
    await pool.end()
    console.log('Migrated Postgres at', redact(url!))
    return
  }

  if (!LOCAL_FLAG && !isPglite) {
    // The whole point of this script's existence. Everything about the failure
    // that took the site down lives in this branch.
    throw new Error(
      [
        'DATABASE_URL is not set, so there is no database to migrate.',
        '',
        'This used to migrate the local embedded database instead and report success, which is',
        'how a failed lookup of the production connection string came to look exactly like a',
        'successful production migration.',
        '',
        'For the embedded development database:  npm run db:migrate -- --local',
        'For a server: set DATABASE_URL first, and check it is not empty before running this.',
      ].join('\n'),
    )
  }

  const path = url?.startsWith('pglite:') ? url.slice('pglite:'.length) : './.data/pcr'
  console.log(`Migrating the embedded database at ${path} …`)

  const { mkdirSync } = await import('node:fs')
  mkdirSync(path, { recursive: true })
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  const client = new PGlite(path)
  await migrate(drizzle(client), { migrationsFolder: './drizzle' })
  await client.close()
  console.log('Migrated embedded Postgres (PGlite) at', path)
}

main().catch((err) => {
  console.error(`\n${(err as Error).message}\n`)
  process.exitCode = 1
})
