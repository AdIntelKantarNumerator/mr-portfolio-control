/**
 * Database connection.
 *
 * One schema, one dialect, two drivers:
 *
 *   DATABASE_URL unset, or "pglite:<path>"  → embedded Postgres (PGlite), no
 *                                             install, data under ./.data
 *   DATABASE_URL = "postgres://..."         → real Postgres via node-postgres
 *
 * Going to production is therefore a connection-string change. Nothing in the
 * schema, the queries, or the migrations differs between the two.
 */
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { drizzle as drizzleNode, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

/**
 * Both drivers expose the identical Drizzle query builder, but TypeScript
 * cannot resolve an overloaded method (`.returning({...})`) across a union of
 * the two, so callers would lose `.returning` entirely. Naming one of them as
 * the public type keeps every call site fully typed; the PGlite instance is
 * asserted into it at construction, where the equivalence actually holds.
 */
export type Database = NodePgDatabase<typeof schema>

const DEFAULT_PGLITE_PATH = './.data/pcr'

declare global {
  // Next.js hot-reloads modules in dev; without a global the process would
  // open a new PGlite instance (and lock) on every edit.
  var __pcrDb: { db: Database; kind: 'pglite' | 'postgres' } | undefined
}

function resolve(): { db: Database; kind: 'pglite' | 'postgres' } {
  const url = process.env.DATABASE_URL?.trim()

  if (url && /^postgres(ql)?:\/\//.test(url)) {
    // Lazily required so the pg driver is never loaded in PGlite mode.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require('pg') as typeof import('pg')
    /*
     * TLS to the database.
     *
     * `require` verifies the server certificate properly. Azure Database for
     * PostgreSQL, AWS RDS and most managed providers present certificates from
     * public CAs that Node already trusts, so this works with no extra
     * configuration — and an encrypted connection nobody authenticates is only
     * half of what TLS is for.
     *
     * `no-verify` exists for a self-signed certificate on an internal server.
     * It is a deliberate, named choice rather than the quiet default it used
     * to be.
     */
    const sslMode = process.env.DATABASE_SSL?.trim()
    const ssl =
      sslMode === 'require'
        ? { rejectUnauthorized: true }
        : sslMode === 'no-verify'
          ? { rejectUnauthorized: false }
          : undefined

    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      ssl,
    })
    return { db: drizzleNode(pool, { schema }), kind: 'postgres' }
  }

  const path = url?.startsWith('pglite:') ? url.slice('pglite:'.length) : DEFAULT_PGLITE_PATH
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require('@electric-sql/pglite') as typeof import('@electric-sql/pglite')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdirSync } = require('node:fs') as typeof import('node:fs')
  mkdirSync(path, { recursive: true })
  const client = new PGlite(path)
  return {
    db: drizzlePglite(client, { schema }) as unknown as Database,
    kind: 'pglite',
  }
}

const resolved = globalThis.__pcrDb ?? resolve()
if (process.env.NODE_ENV !== 'production') globalThis.__pcrDb = resolved

export const db = resolved.db
export const driverKind = resolved.kind
export { schema }
