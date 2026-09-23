/**
 * Applies the generated SQL migrations against whichever database
 * DATABASE_URL points at. Same migrations, both drivers.
 *
 *   npm run db:migrate
 */
import 'dotenv/config'

async function main() {
  const url = process.env.DATABASE_URL?.trim()
  const isPostgres = Boolean(url && /^postgres(ql)?:\/\//.test(url))

  if (isPostgres) {
    const { Pool } = await import('pg')
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    const { sslOption } = await import('./_connect')
    const pool = new Pool({ connectionString: url, ssl: sslOption() })
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
    await pool.end()
    console.log('Migrated Postgres at', url!.replace(/:[^:@/]+@/, ':***@'))
    return
  }

  const path = url?.startsWith('pglite:') ? url.slice('pglite:'.length) : './.data/pcr'
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
  console.error(err)
  process.exit(1)
})
