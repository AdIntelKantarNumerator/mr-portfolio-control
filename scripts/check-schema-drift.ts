/**
 * Does the database the migrations build match the schema the app queries?
 *
 *   DATABASE_URL=postgres://… tsx scripts/check-schema-drift.ts
 *
 * WHY THIS EXISTS
 *
 * The same question — what columns does `allocations` have — is answered in two
 * places: `drizzle/*.sql` builds them, and `src/db/schema.ts` selects them.
 * Everything in this app that has ever broken in production has been those two
 * disagreeing, and they disagree silently: typecheck passes, tests pass, and
 * the first symptom is a 500 on one page because one SELECT names a column
 * nobody created.
 *
 * The hierarchy rotation made that risk acute — a dozen tables carried a
 * `project_id` that had to become `workstream_id`, and missing one leaves a
 * table that reads fine and queries a column that is not there.
 *
 * So this asks both sides and prints the difference. It does not guess which
 * side is right: a column in the schema and not the database is usually a
 * missing migration, and a column in the database and not the schema is
 * usually a rename that only happened on one side, but both are reported the
 * same way and a person decides.
 */
import { Pool } from 'pg'
import { getTableConfig } from 'drizzle-orm/pg-core'
import type { PgTable } from 'drizzle-orm/pg-core'
import * as schema from '../src/db/schema.js'

const url = process.env.DATABASE_URL?.trim()
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error('DATABASE_URL must be a postgres:// connection string. Nothing was checked.')
  process.exit(1)
}

const pool = new Pool({ connectionString: url })

interface Declared {
  table: string
  columns: Set<string>
}

function declaredTables(): Declared[] {
  const out: Declared[] = []
  for (const value of Object.values(schema)) {
    // A pgTable is the only export with a table config; everything else in the
    // module (types, const arrays, relations) throws or has no columns.
    let config
    try {
      config = getTableConfig(value as PgTable)
    } catch {
      continue
    }
    if (!config?.name || !config.columns?.length) continue
    out.push({ table: config.name, columns: new Set(config.columns.map((c) => c.name)) })
  }
  return out
}

async function actualTables(): Promise<Map<string, Set<string>>> {
  const { rows } = await pool.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position`,
  )
  const map = new Map<string, Set<string>>()
  for (const r of rows) {
    const set = map.get(r.table_name) ?? new Set<string>()
    set.add(r.column_name)
    map.set(r.table_name, set)
  }
  return map
}

async function main() {
  const declared = declaredTables()
  const actual = await actualTables()

  let problems = 0
  const note = (line: string) => {
    problems += 1
    console.log(line)
  }

  for (const { table, columns } of declared) {
    const live = actual.get(table)
    if (!live) {
      note(`MISSING TABLE  ${table} — the app queries it; the database has no such table`)
      continue
    }
    for (const c of columns) {
      if (!live.has(c)) note(`MISSING COLUMN ${table}.${c} — selected by the app, absent from the database`)
    }
  }

  // The other direction is a warning, not a failure: a table can legitimately
  // keep a column the app no longer reads (milestones_legacy exists for exactly
  // that reason). It is still worth printing, because a column that was renamed
  // on one side only shows up here as a pair.
  const declaredNames = new Set(declared.map((d) => d.table))
  const orphans: string[] = []
  for (const [table, cols] of actual) {
    if (table.startsWith('drizzle') || table.endsWith('_legacy')) continue
    if (!declaredNames.has(table)) {
      orphans.push(`  table ${table}`)
      continue
    }
    const want = declared.find((d) => d.table === table)!.columns
    for (const c of cols) if (!want.has(c)) orphans.push(`  ${table}.${c}`)
  }

  console.log(`\n${declared.length} tables declared, ${actual.size} in the database.`)
  if (orphans.length) {
    console.log('\nIn the database, not read by the app (usually fine, sometimes half a rename):')
    console.log(orphans.join('\n'))
  }

  if (problems === 0) {
    console.log('\nNo missing tables or columns. The app can run every query it declares.')
  } else {
    console.log(`\n${problems} problem(s). Each one is a 500 on whichever page runs that query.`)
  }

  await pool.end()
  process.exit(problems === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await pool.end()
  process.exit(1)
})
