/**
 * What does the database at DATABASE_URL actually have?
 *
 *   node scripts/schema-check.mjs
 *
 * Written because "I ran the migration and it said it worked" and "the schema
 * is migrated" turned out to be different statements. This one asks the
 * database directly and prints nothing that needs interpreting.
 *
 * It prints the host but never the password, so its output is safe to paste.
 */
import { Pool } from 'pg'

const url = process.env.DATABASE_URL?.trim()

if (!url) {
  console.error('DATABASE_URL is not set in this shell. Nothing was checked.')
  process.exit(1)
}
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error('DATABASE_URL is set but is not a Postgres URL, so this is not the Azure database.')
  process.exit(1)
}

const host = (() => {
  try {
    return new URL(url).host
  } catch {
    return '(unparseable)'
  }
})()

const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])/.test(host)
const ssl = isLocal || /\bsslmode=disable\b/.test(url) ? undefined : { rejectUnauthorized: true }
const pool = new Pool({ connectionString: url, ssl })

/** Columns and tables the deployed code selects. Each names the migration that adds it. */
const EXPECTED = [
  ['0005-0007', 'column', 'decisions', 'kind'],
  ['0005-0007', 'column', 'decisions', 'resolved_by_id'],
  ['0005-0007', 'table', 'source_documents', null],
  ['0005-0007', 'table', 'decision_events', null],
  ['0005-0007', 'table', 'entity_themes', null],
  ['0008', 'column', 'agent_observations', 'recent'],
  ['0008', 'column', 'agent_observations', 'activity_score'],
  ['0008', 'column', 'agent_observations', 'activity_window_hours'],
  ['0009', 'column', 'initiatives', 'dev_lead'],
  ['0009', 'column', 'initiatives', 'program_lead'],
  ['0009', 'table', 'projects', null],
  ['0009', 'table', 'project_items', null],
  ['0009', 'table', 'project_phases', null],
]

try {
  console.log(`Database host: ${host}\n`)

  const { rows: applied } = await pool.query(
    `select hash, created_at from drizzle.__drizzle_migrations order by created_at`,
  ).catch(() => ({ rows: null }))

  if (applied === null) {
    console.log('No drizzle migrations table — this database has never been migrated.\n')
  } else {
    console.log(`Drizzle says ${applied.length} migration(s) have been applied.\n`)
  }

  const { rows: cols } = await pool.query(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
  )
  const { rows: tabs } = await pool.query(
    `select table_name from information_schema.tables where table_schema = 'public'`,
  )

  const haveCol = new Set(cols.map((r) => `${r.table_name}.${r.column_name}`))
  const haveTab = new Set(tabs.map((r) => r.table_name))

  let missing = 0
  for (const [mig, kind, table, column] of EXPECTED) {
    const present = kind === 'table' ? haveTab.has(table) : haveCol.has(`${table}.${column}`)
    const what = kind === 'table' ? `table ${table}` : `${table}.${column}`
    if (!present) missing++
    console.log(`  ${present ? 'present' : 'MISSING'}  ${what}  (migration ${mig})`)
  }

  console.log(
    missing === 0
      ? '\nEverything the deployed code selects exists here. The 500 is not a missing column.'
      : `\n${missing} thing(s) missing. The migrations have NOT reached this database.`,
  )
} catch (err) {
  console.error('Could not inspect the database:', err.message)
  process.exit(1)
} finally {
  await pool.end()
}
