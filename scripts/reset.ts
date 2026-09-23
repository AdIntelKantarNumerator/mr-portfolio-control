/**
 * Empties every table, including the process reference and settings.
 *
 * Used by `npm run db:reset`, which then migrates, reloads the process
 * reference and re-initialises settings — leaving an empty portfolio, which is
 * the intended starting state.
 *
 * It truncates rather than dropping, so the migration history stays
 * authoritative and a reset never silently reverts a schema change.
 */
import { sql } from 'drizzle-orm'
import { ALL_TABLES, connect, warnIfServerRunning } from './_connect'

async function main() {
  const { db, close, embedded } = await connect()
  try {
    await db.execute(sql.raw(`TRUNCATE TABLE ${ALL_TABLES} RESTART IDENTITY CASCADE`))
    console.log('All tables emptied.')
  } catch (err) {
    // A reset before the first migration is a normal thing to do, not an error.
    const message = err instanceof Error ? err.message : String(err)
    if (/does not exist/i.test(message)) console.log('Nothing to empty — no tables yet.')
    else throw err
  }
  await warnIfServerRunning(embedded)
  await close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
