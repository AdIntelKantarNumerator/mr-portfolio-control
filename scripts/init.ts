/**
 * Deployment settings that genuinely vary between installs.
 *
 * Branding is NOT here — it is hardcoded in src/lib/brand.ts. Edit those three
 * constants to re-badge the app; no command to run, nothing to get wrong.
 *
 *   npm run init                                  # fill in anything missing
 *   PORTFOLIO_NAME="Acme Platform" npm run init   # set it explicitly
 *
 * Rule: an environment variable that is actually set ALWAYS wins, even if the
 * key already has a value. Keys with no variable are only filled in when
 * missing, so a plain `npm run init` is safe to re-run after an upgrade.
 *
 * (An earlier version skipped every key that already existed, which silently
 * ignored explicit values — the setup step had already written the defaults.)
 *
 * These are all editable at /settings in the app; the CLI exists for scripted
 * deployments, not because anyone should have to use it.
 */
import { sql } from 'drizzle-orm'
import { connect, warnIfServerRunning } from './_connect'

interface Definition {
  key: string
  env: string
  fallback: string
  note: string
}

const DEFINITIONS: Definition[] = [
  {
    key: 'portfolio.horizonStart',
    env: 'PORTFOLIO_HORIZON_START',
    fallback: '',
    note: 'Timeline start, YYYY-MM-DD. Blank derives it from the dated work.',
  },
  {
    key: 'portfolio.horizonEnd',
    env: 'PORTFOLIO_HORIZON_END',
    fallback: '',
    note: 'Timeline end, YYYY-MM-DD. Blank derives it from the dated work.',
  },
  {
    key: 'assessment.staleDays',
    env: 'ASSESSMENT_STALE_DAYS',
    fallback: '21',
    note: 'Days before a health assessment is flagged as stale.',
  },
]

async function main() {
  const { db, close, embedded } = await connect()
  const s = await import('../src/db/schema')

  const existing = await db.select().from(s.settings)
  const have = new Map(existing.map((r) => [r.key, r.value]))

  const set: string[] = []
  const filled: string[] = []

  for (const def of DEFINITIONS) {
    const fromEnv = process.env[def.env]
    const explicit = fromEnv !== undefined && fromEnv !== null

    if (explicit) {
      if (have.get(def.key) === fromEnv) continue
      await db
        .insert(s.settings)
        .values({ key: def.key, value: fromEnv })
        .onConflictDoUpdate({ target: s.settings.key, set: { value: fromEnv } })
      set.push(`  ${def.key} = ${fromEnv || '(blank)'}`)
      continue
    }

    if (!have.has(def.key)) {
      await db.insert(s.settings).values({ key: def.key, value: def.fallback })
      filled.push(`  ${def.key} = ${def.fallback || '(blank)'}  — ${def.note}`)
    }
  }

  if (set.length) console.log(`Set ${set.length} value(s) from the environment:\n${set.join('\n')}`)
  if (filled.length) console.log(`Filled ${filled.length} missing default(s):\n${filled.join('\n')}`)
  if (!set.length && !filled.length) {
    console.log('Nothing to change — every setting already has the requested value.')
    console.log('To change one, pass it explicitly, or edit it at /settings in the app.')
  }

  const count = await db.execute(sql`SELECT count(*)::int AS n FROM projects`)
  const rows = (count as unknown as { rows?: { n: number }[] }).rows ?? []
  const projects = rows[0]?.n ?? 0
  console.log(
    projects === 0
      ? '\nThe portfolio is empty, which is the intended starting state.\n' +
          'Fill it by connecting Linear (npm run sync:linear) and by entering the things\n' +
          'no tracker holds — assessments, decisions, dependencies, intake.\n' +
          'To explore the screens with example content first: npm run seed:demo'
      : `\n${projects} project(s) present.`,
  )

  await warnIfServerRunning(embedded)
  await close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
