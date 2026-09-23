/**
 * Shared database connection for the CLI scripts.
 *
 * Mirrors src/db/client.ts, but standalone: the scripts run outside Next, so
 * they cannot use the module-level singleton that relies on Next's runtime.
 */
import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import type { Database } from '../src/db/client'

/**
 * TLS settings for a managed Postgres, matching src/db/client.ts exactly.
 *
 * `require` verifies the server certificate against the system trust store,
 * which is what Azure Database for PostgreSQL, RDS and most managed providers
 * need — and what makes the encryption actually mean something. `no-verify`
 * encrypts without checking who is on the other end, and exists only for a
 * self-signed certificate on an internal server.
 *
 * Without this the scripts connect with TLS disabled, and Azure refuses the
 * connection outright rather than falling back.
 */
export function sslOption() {
  const mode = process.env.DATABASE_SSL?.trim()
  if (mode === 'require') return { rejectUnauthorized: true }
  if (mode === 'no-verify') return { rejectUnauthorized: false }
  return undefined
}

export interface Connection {
  db: Database
  close: () => Promise<void>
  /** True when running against the embedded database rather than a server. */
  embedded: boolean
}

/**
 * PGlite is an IN-PROCESS database. A running dev server holds its own
 * instance of it, so writes made by a CLI script are on disk but invisible to
 * that server until it restarts — and two processes writing the same directory
 * at once can corrupt it.
 *
 * This is the single most confusing thing about the prototype setup: you run a
 * sync, nothing changes on screen, and you conclude the sync is broken. So the
 * scripts check whether a server is listening and say so plainly.
 *
 * None of this applies to a real Postgres, where concurrent access is the
 * whole point — which is a good reason to move to one as soon as more than one
 * person is using the tool.
 */
export async function serverIsRunning(): Promise<boolean> {
  const port = process.env.PORT ?? '3000'
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 700)
    await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal })
    clearTimeout(timer)
    return true
  } catch {
    return false
  }
}

export async function warnIfServerRunning(embedded: boolean): Promise<void> {
  if (!embedded) return
  if (!(await serverIsRunning())) return
  console.warn(
    '\n  NOTE: a server appears to be running on this machine.\n' +
      '  The embedded database lives inside each process, so it will not see these\n' +
      '  changes until you stop it (Ctrl+C) and start it again.\n' +
      '  Point DATABASE_URL at a real Postgres and this restriction goes away.\n',
  )
}

export async function connect(): Promise<Connection> {
  const url = process.env.DATABASE_URL?.trim()
  const schema = await import('../src/db/schema')

  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const { Pool } = await import('pg')
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const pool = new Pool({ connectionString: url, ssl: sslOption() })
    return {
      db: drizzle(pool, { schema }) as unknown as Database,
      embedded: false,
      close: async () => {
        await pool.end()
      },
    }
  }

  const path = url?.startsWith('pglite:') ? url.slice('pglite:'.length) : './.data/pcr'
  mkdirSync(path, { recursive: true })
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const client = new PGlite(path)
  return {
    db: drizzle(client, { schema }) as unknown as Database,
    embedded: true,
    close: async () => {
      await client.close()
    },
  }
}

/** Every table, in dependency order, for the reset scripts. */
export const ALL_TABLES = `
  scores, scoring_criteria, scoring_models, intake_requests,
  allocations, decisions, dependencies, assessments, field_overrides,
  status_updates, source_records, sync_runs, changelog_entries,
  project_readiness, readiness_items, lifecycle_gates, discovery_topics, templates,
  milestones, projects, initiatives, app_areas, themes, people, teams, settings
`

/** The portfolio content only — leaves process reference data in place. */
export const PORTFOLIO_TABLES = `
  scores, intake_requests, allocations, decisions, dependencies, assessments,
  field_overrides, status_updates, source_records, sync_runs, changelog_entries,
  project_readiness, milestones, projects, initiatives, app_areas, themes,
  people, teams
`
