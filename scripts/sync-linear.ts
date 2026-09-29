/**
 * Command-line Linear sync — the same code path the API route uses.
 *
 *   npm run sync:linear              full backfill
 *   npm run sync:linear -- --since   incremental from the last successful run
 *   npm run sync:linear -- --probe   report which fields this workspace exposes
 *
 * Run the probe first against a new workspace: it prints exactly which
 * initiative and project fields are available, which is the difference between
 * a five-minute setup and an afternoon of guessing at GraphQL errors.
 */
import 'dotenv/config'

async function main() {
  const args = process.argv.slice(2)
  const { syncLinear, introspect } = await import('../src/lib/sources/linear')

  if (!process.env.LINEAR_API_KEY) {
    console.error('LINEAR_API_KEY is not set. Add it to .env (never commit it).')
    process.exit(1)
  }

  if (args.includes('--probe')) {
    const caps = await introspect()
    const report = (type: string, fields: string[]) => {
      const have = fields.filter((f) => caps.has(type, f))
      const miss = fields.filter((f) => !caps.has(type, f))
      console.log(`\n${type}`)
      console.log(`  available: ${have.join(', ') || '(none)'}`)
      if (miss.length) console.log(`  missing:   ${miss.join(', ')}`)
    }
    console.log(`initiatives query: ${caps.hasQuery('initiatives') ? 'yes' : 'no'}`)
    report('Initiative', ['id', 'name', 'description', 'targetDate', 'startedAt', 'status', 'owner', 'url', 'sortOrder'])
    report('Project', [
      'id', 'name', 'description', 'url', 'state', 'status', 'priority', 'progress',
      'health', 'startDate', 'targetDate', 'startedAt', 'completedAt', 'lead', 'teams',
      'initiatives', 'projectMilestones',
    ])
    report('Team', ['id', 'key', 'name', 'description'])
    report('User', ['id', 'name', 'email', 'active'])
    return
  }

  let since: Date | null = null
  if (args.includes('--since')) {
    const { db } = await import('../src/db/client')
    const { syncRuns } = await import('../src/db/schema')
    const { and, desc, eq } = await import('drizzle-orm')
    const [last] = await db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.system, 'linear'), eq(syncRuns.status, 'success')))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1)
    since = last?.cursor ?? null
    console.log(since ? `Incremental sync since ${since.toISOString()}` : 'No prior run; full backfill')
  }

  const result = await syncLinear({ since, trigger: 'manual' })
  console.log(`\nStatus: ${result.status}`)
  for (const [entity, counts] of Object.entries(result.counters)) {
    console.log(`  ${entity}: ${counts.created} created, ${counts.updated} updated`)
  }
  for (const w of result.warnings) console.log(`  warning: ${w}`)
  if (result.error) {
    console.error(`  error: ${result.error}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
