'use server'

/**
 * Editing the Data Dictionary: datasets, database status, and notes on
 * tables and columns.
 *
 * Nothing here writes to ClickHouse. Every action writes to the portfolio's
 * own dictionary_* tables; ClickHouse is only ever read (lib/clickhouse.ts).
 * The one action that touches the ClickHouse side, `rereadCatalog`, empties
 * the in-memory cache so the next page load reads afresh.
 */
import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  dictionaryColumns,
  dictionaryDatabases,
  dictionaryDatasets,
  dictionaryDatasetTables,
  dictionaryTables,
} from '@/db/schema'
import { editor } from '@/lib/auth/editor'
import { forgetCatalog } from '@/lib/dictionary'
import {
  assignProblem,
  parseTableRef,
  readDatabaseStatus,
  readEmptyReason,
  readEnvironment,
  readIntent,
  DATABASE_STATUS_LABEL,
} from '@/lib/dictionary-rules'
import { logChange } from '@/lib/portfolio'

export interface DictState {
  ok?: boolean
  /** A line to show after a success, e.g. "Added 3 tables to Sports Sponsorship." */
  message?: string
  error?: string
  fieldErrors?: Record<string, string>
  id?: string
  stamp?: number
}

function refresh() {
  revalidatePath('/data-dictionary', 'layout')
  revalidatePath('/changes')
}

const text = (fd: FormData, k: string, max = 4000) => {
  const v = String(fd.get(k) ?? '').trim()
  return v ? v.slice(0, max) : null
}

/**
 * Where a new dataset goes: at the end of the board, after the ones people
 * have already arranged, rather than jumping to the front with sortOrder 0.
 */
async function nextDatasetOrder(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`coalesce(max(${dictionaryDatasets.sortOrder}), -1)` }).from(dictionaryDatasets)
  return Number(row?.n ?? -1) + 1
}

export async function saveDataset(_prev: DictState, fd: FormData): Promise<DictState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }

  const name = text(fd, 'name', 120)
  const intentDev = readIntent(fd.get('intentDev'))
  const intentProd = readIntent(fd.get('intentProd'))
  const fieldErrors: Record<string, string> = {}
  if (!name) fieldErrors.name = 'Give the dataset the name people use for it.'
  if (!intentDev) fieldErrors.intentDev = 'Pick what Dev should hold.'
  if (!intentProd) fieldErrors.intentProd = 'Pick what Prod should hold.'

  // Table refs arrive as repeated "table" fields. Anything that is not
  // "database.table" is refused rather than stored as a ref nobody can open.
  const refs = [...new Set(fd.getAll('table').map((v) => String(v).trim()).filter(Boolean))]
  const bad = refs.filter((r) => !parseTableRef(r))
  if (bad.length) fieldErrors.tables = `Not a database.table name: ${bad.join(', ')}`
  if (Object.keys(fieldErrors).length) return { fieldErrors }

  const values = {
    name: name!,
    owner: text(fd, 'owner', 120),
    description: text(fd, 'description'),
    intentDev: intentDev!,
    intentProd: intentProd!,
    explainedBy: text(fd, 'explainedBy', 400),
    updatedBy: who.name,
    updatedAt: new Date(),
  }

  let id = text(fd, 'id', 64)
  let before: string[] = []
  if (id) {
    const [row] = await db.select().from(dictionaryDatasets).where(eq(dictionaryDatasets.id, id)).limit(1)
    if (!row) return { error: 'That dataset no longer exists. Reload the page.' }
    before = (await db.select().from(dictionaryDatasetTables).where(eq(dictionaryDatasetTables.datasetId, id))).map((r) => r.tableRef)
    await db.update(dictionaryDatasets).set(values).where(eq(dictionaryDatasets.id, id))
  } else {
    const [row] = await db.insert(dictionaryDatasets).values({ ...values, sortOrder: await nextDatasetOrder() }).returning({ id: dictionaryDatasets.id })
    id = row!.id
  }

  // Replace the table list wholesale: the form always submits all of it.
  await db.delete(dictionaryDatasetTables).where(eq(dictionaryDatasetTables.datasetId, id))
  if (refs.length) await db.insert(dictionaryDatasetTables).values(refs.map((tableRef) => ({ datasetId: id!, tableRef })))

  const added = refs.filter((r) => !before.includes(r))
  const removed = before.filter((r) => !refs.includes(r))
  const tableNote = [added.length ? `added ${added.join(', ')}` : '', removed.length ? `removed ${removed.join(', ')}` : '']
    .filter(Boolean)
    .join('; ')
  await logChange({
    actor: who.name,
    summary: before.length || fd.get('id') ? `Data dictionary: ${values.name} edited` : `Data dictionary: added dataset ${values.name}`,
    detail: tableNote || null,
    entityType: 'dataset',
    entityId: id,
  })
  refresh()
  return { ok: true, id, stamp: Date.now() }
}

/**
 * Add tables to a dataset, an existing one or a new one made on the spot.
 *
 * Added 2 October 2026 so the tables nobody has put in a dataset can be
 * found and sorted from the Tables tab, several at a time, rather than by
 * opening each dataset and typing table names into it. Adding a table a
 * dataset already has is not an error; it is simply already there. A new
 * dataset starts "Undecided" for Dev and Prod, which is what puts it on the
 * Datasets tab's needs-attention count until somebody says what it should be.
 */
export async function addTablesToDataset(_prev: DictState, fd: FormData): Promise<DictState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }

  const refs = [...new Set(fd.getAll('table').map((v) => String(v).trim()).filter(Boolean))]
  const datasetId = text(fd, 'datasetId', 64)
  const newName = text(fd, 'newName', 200)
  const datasets = await db.select({ id: dictionaryDatasets.id, name: dictionaryDatasets.name }).from(dictionaryDatasets)
  const problem = assignProblem({ datasetId, newName, refs, datasets })
  if (problem) return { error: problem }

  let id = datasetId
  let name = datasets.find((d) => d.id === datasetId)?.name ?? ''
  if (!id) {
    name = newName!.replace(/\s+/g, ' ').trim()
    const [row] = await db
      .insert(dictionaryDatasets)
      .values({
        name,
        intentDev: 'undecided',
        intentProd: 'undecided',
        updatedBy: who.name,
        sortOrder: await nextDatasetOrder(),
      })
      .returning({ id: dictionaryDatasets.id })
    id = row!.id
  }
  const had = new Set((await db.select().from(dictionaryDatasetTables).where(eq(dictionaryDatasetTables.datasetId, id!))).map((r) => r.tableRef))
  const fresh = refs.filter((r) => !had.has(r))
  if (fresh.length) await db.insert(dictionaryDatasetTables).values(fresh.map((tableRef) => ({ datasetId: id!, tableRef })))

  await logChange({
    actor: who.name,
    summary: datasetId ? `Data dictionary: added ${fresh.length} table${fresh.length === 1 ? '' : 's'} to ${name}` : `Data dictionary: added dataset ${name}`,
    detail: fresh.length ? fresh.join(', ') : 'Every table was already in it.',
    entityType: 'dataset',
    entityId: id!,
  })
  refresh()
  const already = refs.length - fresh.length
  const message = already
    ? `Added ${fresh.length} to ${name}; ${already} ${already === 1 ? 'was' : 'were'} already in it.`
    : `Added ${fresh.length} table${fresh.length === 1 ? '' : 's'} to ${name}.`
  return { ok: true, id: id!, stamp: Date.now(), message }
}

/**
 * The order of the dataset tiles, as somebody arranged them by dragging.
 *
 * One order for everybody, unlike the home page's per-person card order: the
 * Datasets tab is shared reference, and the arrangement is part of what it
 * says (what matters first). Ids not on the board are ignored, and any
 * dataset left out keeps its place after the ones that were sent, so a
 * dataset added in another tab mid-drag is not lost to the bottom of nowhere.
 */
export async function reorderDatasets(ids: string[]): Promise<DictState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }

  const rows = await db
    .select({ id: dictionaryDatasets.id, sortOrder: dictionaryDatasets.sortOrder, name: dictionaryDatasets.name })
    .from(dictionaryDatasets)
  const known = new Set(rows.map((r) => r.id))
  const sent = [...new Set(ids)].filter((id) => known.has(id))
  const rest = rows
    .filter((r) => !sent.includes(r.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((r) => r.id)
  const order = [...sent, ...rest]

  await db.transaction(async (tx) => {
    for (const [i, id] of order.entries()) {
      await tx.update(dictionaryDatasets).set({ sortOrder: i }).where(eq(dictionaryDatasets.id, id))
    }
  })
  const first = rows.find((r) => r.id === order[0])?.name
  await logChange({
    actor: who.name,
    summary: 'Data dictionary: datasets reordered',
    detail: first ? `${first} is now first` : null,
    entityType: 'dataset',
    entityId: order[0] ?? 'datasets',
  })
  refresh()
  return { ok: true }
}

/** Take one table out of one dataset. The table and its notes are untouched. */
export async function removeTableFromDataset(datasetId: string, tableRef: string): Promise<DictState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  const [ds] = await db.select().from(dictionaryDatasets).where(eq(dictionaryDatasets.id, datasetId)).limit(1)
  if (!ds) return { ok: true }
  await db
    .delete(dictionaryDatasetTables)
    .where(and(eq(dictionaryDatasetTables.datasetId, datasetId), eq(dictionaryDatasetTables.tableRef, tableRef)))
  await logChange({
    actor: who.name,
    summary: `Data dictionary: removed ${tableRef} from ${ds.name}`,
    entityType: 'dataset',
    entityId: datasetId,
  })
  refresh()
  return { ok: true }
}

export async function deleteDataset(id: string): Promise<DictState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  const [row] = await db.select().from(dictionaryDatasets).where(eq(dictionaryDatasets.id, id)).limit(1)
  if (!row) return { ok: true }
  await db.delete(dictionaryDatasets).where(eq(dictionaryDatasets.id, id))
  await logChange({
    actor: who.name,
    summary: `Data dictionary: removed dataset ${row.name}`,
    detail: 'Its tables are untouched; only the grouping went.',
    entityType: 'dataset',
    entityId: id,
  })
  refresh()
  return { ok: true }
}

export async function saveDatabaseNote(_prev: DictState, fd: FormData): Promise<DictState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  const name = text(fd, 'name', 200)
  const status = readDatabaseStatus(fd.get('status'))
  if (!name) return { error: 'Which database?' }
  if (!status) return { fieldErrors: { status: 'Pick a status.' } }
  const description = text(fd, 'description')

  const [before] = await db.select().from(dictionaryDatabases).where(eq(dictionaryDatabases.name, name)).limit(1)
  await db
    .insert(dictionaryDatabases)
    .values({ name, status, description, updatedBy: who.name })
    .onConflictDoUpdate({ target: dictionaryDatabases.name, set: { status, description, updatedBy: who.name, updatedAt: new Date() } })

  if (before?.status !== status || (before?.description ?? null) !== description) {
    await logChange({
      actor: who.name,
      summary: `Data dictionary: database ${name} ${before?.status !== status ? `is now ${DATABASE_STATUS_LABEL[status].toLowerCase()}` : 'description edited'}`,
      detail: before && before.status !== status ? `${DATABASE_STATUS_LABEL[readDatabaseStatus(before.status) ?? 'unreviewed']} → ${DATABASE_STATUS_LABEL[status]}` : null,
      entityType: 'database',
      entityId: name,
    })
  }
  refresh()
  return { ok: true, stamp: Date.now() }
}

export async function saveTableNote(_prev: DictState, fd: FormData): Promise<DictState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  const ref = text(fd, 'ref', 400)
  if (!ref || !parseTableRef(ref)) return { error: 'Which table?' }

  const rawReason = String(fd.get('emptyReason') ?? '')
  const emptyReason = rawReason ? readEmptyReason(rawReason) : null
  if (rawReason && !emptyReason) return { fieldErrors: { emptyReason: 'Pick why it is empty.' } }

  const values = {
    description: text(fd, 'description'),
    owner: text(fd, 'owner', 120),
    watchOut: text(fd, 'watchOut'),
    emptyReason,
    excluded: fd.get('excluded') === 'on',
    updatedBy: who.name,
  }
  await db
    .insert(dictionaryTables)
    .values({ tableRef: ref, ...values })
    .onConflictDoUpdate({ target: dictionaryTables.tableRef, set: { ...values, updatedAt: new Date() } })
  await logChange({
    actor: who.name,
    summary: `Data dictionary: notes on ${ref} edited`,
    detail: values.excluded ? 'Hidden from the dictionary.' : null,
    entityType: 'table',
    entityId: ref,
  })
  refresh()
  return { ok: true, stamp: Date.now() }
}

export async function saveColumnNote(_prev: DictState, fd: FormData): Promise<DictState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  const ref = text(fd, 'ref', 400)
  const column = text(fd, 'column', 400)
  if (!ref || !parseTableRef(ref) || !column) return { error: 'Which column?' }

  // A person saving clears the draft marker: from here on the cell is theirs,
  // and says so, the same rule the home page applies to a rewritten verdict.
  const values = {
    description: text(fd, 'description'),
    meaning: text(fd, 'meaning'),
    watchOut: text(fd, 'watchOut'),
    source: text(fd, 'source', 400),
    draftedBy: null,
    updatedBy: who.name,
  }
  await db
    .insert(dictionaryColumns)
    .values({ tableRef: ref, columnName: column, ...values })
    .onConflictDoUpdate({
      target: [dictionaryColumns.tableRef, dictionaryColumns.columnName],
      set: { ...values, updatedAt: new Date() },
    })
  await logChange({
    actor: who.name,
    summary: `Data dictionary: ${ref}.${column} described`,
    entityType: 'column',
    entityId: `${ref}.${column}`,
  })
  refresh()
  return { ok: true, stamp: Date.now() }
}

export async function rereadCatalog(fd: FormData): Promise<void> {
  const who = await editor()
  if (!who.ok) return
  forgetCatalog(readEnvironment(fd.get('env')))
  revalidatePath('/data-dictionary', 'layout')
}
