/**
 * Starting content for the Workflow Assessment map and the Data Dictionary.
 *
 *   npm run seed:reference          # fills whichever of the two is empty
 *
 * WHY IT ONLY FILLS EMPTY TABLES
 *
 * seed:process truncates and reloads, because process reference data is
 * defined by its source file. This is the opposite kind of data: it starts
 * from a file and then belongs to the people editing it on screen. A re-run
 * that replaced the map would throw away every owner somebody corrected and
 * every connection somebody added, silently, on the next deploy.
 *
 * So each part checks its own table and skips if anything is there. The map
 * and the dictionary are checked separately, so a deploy that already has a
 * map still picks up the dictionary seed the first time it runs.
 *
 * Every row it writes is attributed to "seed", which is how the screens tell a
 * starting guess from something a person said.
 */
import { randomUUID } from 'node:crypto'
import { count } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { connect, warnIfServerRunning } from './_connect'
import {
  SEED_COLUMN_NOTES,
  SEED_COMPONENTS,
  SEED_DATABASES,
  SEED_DATASETS,
  SEED_GROUPS,
  SEED_LINKS,
  SEED_TABLE_NOTES,
} from '../src/lib/reference-seed'

const SEED = 'seed'

async function main() {
  const { db, close, embedded } = await connect()
  const s = await import('../src/db/schema')
  const empty = async (table: PgTable) => {
    const [row] = await db.select({ n: count() }).from(table)
    return Number(row?.n ?? 0) === 0
  }

  // ---- the map ------------------------------------------------------------
  if (await empty(s.workflowComponents)) {
    await db
      .insert(s.workflowGroups)
      .values(SEED_GROUPS.map((g, i) => ({ key: g.key, name: g.name, kind: g.kind, sortOrder: i })))
      .onConflictDoNothing()

    const idOf = new Map<string, string>()
    await db.insert(s.workflowComponents).values(
      SEED_COMPONENTS.map((c) => {
        const id = randomUUID()
        idOf.set(c.key, id)
        return {
          id,
          name: c.name,
          kind: c.kind,
          groupKey: c.group,
          owner: c.owner,
          description: c.description,
          detail: c.detail,
          aliases: c.aliases,
          isData: c.isData,
          createdBy: SEED,
          updatedBy: SEED,
        }
      }),
    )
    await db.insert(s.workflowLinks).values(
      SEED_LINKS.map(([from, to]) => {
        const fromId = idOf.get(from)
        const toId = idOf.get(to)
        // tests/reference-seed.test.ts guards this; failing loudly here too
        // beats inserting a link to nothing.
        if (!fromId || !toId) throw new Error(`Seed link ${from} → ${to} names a component that is not in the seed.`)
        return { fromId, toId, createdBy: SEED }
      }),
    )
    console.log(`Map: ${SEED_GROUPS.length} groups, ${SEED_COMPONENTS.length} components, ${SEED_LINKS.length} links.`)
  } else {
    console.log('Map: already has components. Left alone.')
  }

  // ---- the dictionary -----------------------------------------------------
  if (await empty(s.dictionaryDatabases)) {
    await db.insert(s.dictionaryDatabases).values(SEED_DATABASES.map((d) => ({ ...d, updatedBy: SEED })))
    console.log(`Dictionary: ${SEED_DATABASES.length} database statuses.`)
  } else {
    console.log('Dictionary: database statuses already set. Left alone.')
  }

  if (await empty(s.dictionaryDatasets)) {
    for (const [i, d] of SEED_DATASETS.entries()) {
      const id = randomUUID()
      await db.insert(s.dictionaryDatasets).values({
        id,
        name: d.name,
        owner: d.owner,
        description: d.description,
        intentDev: d.intentDev,
        intentProd: d.intentProd,
        explainedBy: d.explainedBy,
        sortOrder: i,
        updatedBy: SEED,
      })
      const refs = [...new Set(d.tables)]
      if (refs.length) await db.insert(s.dictionaryDatasetTables).values(refs.map((tableRef) => ({ datasetId: id, tableRef })))
    }
    console.log(`Dictionary: ${SEED_DATASETS.length} datasets.`)
  } else {
    console.log('Dictionary: datasets already defined. Left alone.')
  }

  if (await empty(s.dictionaryTables)) {
    // Later notes for the same table win over earlier ones field by field, so
    // a trap and an empty-reason written in different places combine.
    const merged = new Map<string, Record<string, unknown>>()
    for (const n of SEED_TABLE_NOTES) {
      const { tableRef, ...rest } = n
      merged.set(tableRef, { ...(merged.get(tableRef) ?? {}), ...rest })
    }
    await db.insert(s.dictionaryTables).values(
      [...merged.entries()].map(([tableRef, n]) => ({
        tableRef,
        description: (n.description as string) ?? null,
        watchOut: (n.watchOut as string) ?? null,
        emptyReason: (n.emptyReason as string) ?? null,
        excluded: Boolean(n.excluded),
        updatedBy: SEED,
      })),
    )
    console.log(`Dictionary: notes on ${merged.size} tables.`)
  } else {
    console.log('Dictionary: table notes already exist. Left alone.')
  }

  if (await empty(s.dictionaryColumns)) {
    await db.insert(s.dictionaryColumns).values(
      SEED_COLUMN_NOTES.map((c) => ({
        tableRef: c.tableRef,
        columnName: c.column,
        description: c.description ?? null,
        meaning: c.meaning ?? null,
        watchOut: c.watchOut ?? null,
        source: c.source ?? null,
        draftedBy: SEED,
        updatedBy: SEED,
      })),
    )
    console.log(`Dictionary: draft notes on ${SEED_COLUMN_NOTES.length} columns.`)
  } else {
    console.log('Dictionary: column notes already exist. Left alone.')
  }

  await warnIfServerRunning(embedded)
  await close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
