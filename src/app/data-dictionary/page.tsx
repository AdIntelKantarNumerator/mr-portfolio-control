/**
 * Data Dictionary: the ClickHouse client-consumable model, as it is and as
 * people say it should be.
 *
 * Three levels, each a tab:
 *
 *   Datasets  named things people talk about (Sports Sponsorship,
 *             Television), the tables each one hits, and whether it is
 *             loaded — computed — against whether it should be — stated.
 *   Schemas   every database on the instance and whether it is part of the
 *             client contract.
 *   Tables    every table, with a page per table down to the field.
 *
 * Structure is read live from ClickHouse's system tables; the portfolio only
 * ever reads it (lib/clickhouse-guard.ts). Meaning, intent and warnings are
 * the portfolio's own, edited behind the Edit button.
 */
import Link from 'next/link'
import { Kicker } from '@/components/ui'
import { describedColumnCounts, readCatalog, readDictionaryNotes, type CatalogTable } from '@/lib/dictionary'
import {
  DATABASE_STATUS_LABEL,
  DATASET_STATUS_LABEL,
  EMPTY_REASON_LABEL,
  compactCount,
  databaseShownByDefault,
  datasetStatus,
  excludedByRule,
  needsAttention,
  readDatabaseStatus,
  readEmptyReason,
  readEnvironment,
  readIntent,
  readableBytes,
  type DatabaseStatus,
  type EmptyReason,
} from '@/lib/dictionary-rules'
import { ConnectionNote, DictionaryHeader } from './header'
import { DatasetBoard, type DatasetTile } from './board'
import { DatabaseRow } from './editors'
import { dictHref, tableHref, type DictView } from './href'
import { BULK_FORM, BulkAssignBar, SelectAllBox } from './assign'
import { AutoSubmitSelect } from './auto-submit'

export const metadata = { title: 'Data Dictionary' }
export const dynamic = 'force-dynamic'

type Search = Promise<Record<string, string | string[] | undefined>>

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

const STATUS_ORDER: DatabaseStatus[] = ['contract', 'internal', 'unreviewed', 'transition', 'superseded', 'excluded']
const STATUS_TONE: Record<DatabaseStatus, string> = {
  contract: 'tone-green',
  internal: 'tone-blue',
  unreviewed: 'tone-amber',
  transition: 'tone-red',
  superseded: 'tone-slate',
  excluded: 'tone-slate',
}

export default async function DataDictionaryPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const view: DictView = {
    env: readEnvironment(one(sp.env)),
    tab: one(sp.tab) === 'schemas' ? 'schemas' : one(sp.tab) === 'tables' ? 'tables' : 'datasets',
    edit: one(sp.edit) === '1',
    showAll: one(sp.show) === 'all',
    q: one(sp.q).trim(),
    db: one(sp.db).trim(),
    unassigned: one(sp.only) === 'unassigned',
  }

  const [result, notes, described] = await Promise.all([readCatalog(view.env), readDictionaryNotes(), describedColumnCounts()])

  const statusOf = new Map(notes.databases.map((d) => [d.name, readDatabaseStatus(d.status) ?? 'unreviewed']))
  const dbNote = new Map(notes.databases.map((d) => [d.name, d]))
  const tableNote = new Map(notes.tables.map((t) => [t.tableRef, t]))
  const emptyReasons = new Map<string, EmptyReason>()
  for (const t of notes.tables) {
    const r = readEmptyReason(t.emptyReason)
    if (r) emptyReasons.set(t.tableRef, r)
  }

  const catalog = result.state === 'ok' ? result.catalog : null
  const allTables = catalog?.tables ?? []
  const rowsOf = catalog ? new Map(allTables.map((t) => [t.ref, { rows: t.rows }])) : null

  // What the dictionary shows by default: not a backup or scratch table, not
  // hidden by hand, and in a database that is not excluded or superseded.
  const hiddenWhy = (t: CatalogTable): string | null => {
    const rule = excludedByRule(t.name)
    if (rule) return rule
    if (tableNote.get(t.ref)?.excluded) return 'hidden by hand'
    if (!databaseShownByDefault(statusOf.get(t.database) ?? 'unreviewed')) return `in a ${DATABASE_STATUS_LABEL[statusOf.get(t.database)!].toLowerCase()} database`
    return null
  }
  const shownTables = allTables.filter((t) => view.showAll || !hiddenWhy(t))
  const hiddenCount = allTables.length - allTables.filter((t) => !hiddenWhy(t)).length

  const datasetsOfTable = new Map<string, string[]>()
  for (const d of notes.datasets) for (const ref of d.tables) datasetsOfTable.set(ref, [...(datasetsOfTable.get(ref) ?? []), d.name])

  const hrefFor = (change: Partial<DictView>) => dictHref({ ...view, ...change })

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Reference</Kicker>
          <h1>Data Dictionary</h1>
        </div>
      </div>

      <DictionaryHeader env={view.env} result={result} edit={Boolean(view.edit)} hrefFor={(c) => hrefFor(c)} />
      <ConnectionNote result={result} />

      <nav className="dd-tabs" aria-label="Data Dictionary sections">
        {(['datasets', 'schemas', 'tables'] as const).map((t) => (
          <Link key={t} href={hrefFor({ tab: t, q: '', db: t === 'tables' ? view.db : '' })} className={view.tab === t ? 'on' : ''} aria-current={view.tab === t ? 'page' : undefined}>
            {t === 'datasets' ? 'Datasets' : t === 'schemas' ? 'Schemas' : 'Tables'}
          </Link>
        ))}
      </nav>

      {view.tab === 'datasets' ? (
        <DatasetsTab view={view} notes={notes} rowsOf={rowsOf} emptyReasons={emptyReasons} allRefs={allTables.filter((t) => !hiddenWhy(t)).map((t) => t.ref)} />
      ) : view.tab === 'schemas' ? (
        <SchemasTab view={view} catalogOk={Boolean(catalog)} databases={catalog?.databases ?? []} tables={allTables} statusOf={statusOf} dbNote={dbNote} />
      ) : (
        <TablesTab
          view={view}
          catalogOk={Boolean(catalog)}
          tables={shownTables}
          hiddenCount={hiddenCount}
          hiddenWhy={hiddenWhy}
          tableNote={tableNote}
          datasetsOfTable={datasetsOfTable}
          described={described}
          databases={[...new Set(allTables.map((t) => t.database))].sort()}
          datasets={notes.datasets.map((d) => ({ id: d.id, name: d.name }))}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function DatasetsTab({
  view,
  notes,
  rowsOf,
  emptyReasons,
  allRefs,
}: {
  view: DictView
  notes: Awaited<ReturnType<typeof readDictionaryNotes>>
  rowsOf: Map<string, { rows: number }> | null
  emptyReasons: Map<string, EmptyReason>
  allRefs: string[]
}) {
  const tiles: DatasetTile[] = notes.datasets.map((d) => {
    const s = datasetStatus(d.tables, rowsOf, emptyReasons)
    const intentKey = readIntent(view.env === 'prod' ? d.intentProd : d.intentDev) ?? 'undecided'
    return {
      id: d.id,
      name: d.name,
      owner: d.owner,
      description: d.description,
      explainedBy: d.explainedBy,
      intentDev: d.intentDev,
      intentProd: d.intentProd,
      intentHere: intentKey,
      status: s.status,
      attention: needsAttention(s.status, intentKey),
      rows: s.tables.reduce((n, t) => n + t.rows, 0),
      tables: s.tables.map((t) => ({
        ref: t.ref,
        state: rowsOf ? t.state : 'unknown',
        rows: t.rows,
        reason: t.emptyReason,
        href: (() => {
          const [database, ...rest] = t.ref.split('.')
          return tableHref(view, database!, rest.join('.'))
        })(),
      })),
    }
  })

  const by = (s: string) => tiles.filter((t) => t.status === s).length
  const attention = tiles.filter((t) => t.attention).length

  return (
    <section>
      <div className="dd-note dd-note-info">
        {tiles.length} datasets.{' '}
        {rowsOf ? (
          <>
            <b>{by('loaded')}</b> {DATASET_STATUS_LABEL.loaded.toLowerCase()}, <b>{by('partial')}</b> partial, <b>{by('not_loaded')}</b>{' '}
            {DATASET_STATUS_LABEL.not_loaded.toLowerCase()} in {view.env === 'prod' ? 'Prod' : 'Dev'}. <b>{attention}</b> where what is loaded
            disagrees with what people said should be, or nobody has said.
          </>
        ) : (
          <>Loaded status is unknown until {view.env === 'prod' ? 'Prod' : 'Dev'} can be read; intent is shown.</>
        )}
      </div>
      <DatasetBoard tiles={tiles} edit={Boolean(view.edit)} env={view.env} tableOptions={allRefs} />
    </section>
  )
}

function SchemasTab({
  view,
  catalogOk,
  databases,
  tables,
  statusOf,
  dbNote,
}: {
  view: DictView
  catalogOk: boolean
  databases: { name: string; comment: string }[]
  tables: CatalogTable[]
  statusOf: Map<string, DatabaseStatus>
  dbNote: Map<string, { description: string | null; updatedBy: string | null }>
}) {
  // Databases known to ClickHouse, plus any with a note but not (or no
  // longer) on the instance, so a dropped database shows as drift.
  const names = [...new Set([...databases.map((d) => d.name), ...(catalogOk ? [] : [...dbNote.keys()])])]
  const comment = new Map(databases.map((d) => [d.name, d.comment]))
  const rows = names
    .map((name) => {
      const status = statusOf.get(name) ?? 'unreviewed'
      const own = tables.filter((t) => t.database === name)
      const visible = own.filter((t) => !excludedByRule(t.name))
      return {
        name,
        status,
        description: dbNote.get(name)?.description ?? comment.get(name) ?? null,
        fromComment: !dbNote.get(name)?.description && Boolean(comment.get(name)),
        tables: visible.length,
        hiddenByRule: own.length - visible.length,
        rows: visible.reduce((n, t) => n + t.rows, 0),
        empty: visible.filter((t) => t.rows === 0).length,
        bytes: visible.reduce((n, t) => n + t.bytes, 0),
        onInstance: comment.has(name),
      }
    })
    .filter((r) => view.showAll || databaseShownByDefault(r.status))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name))

  const hidden = names.length - rows.length

  return (
    <section>
      <div className="dd-tablewrap">
        <table className="dd-table">
          <thead>
            <tr>
              <th>Database</th>
              <th>Status</th>
              <th>What it is</th>
              <th className="dd-num">Tables</th>
              <th className="dd-num">Rows</th>
              <th className="dd-num">Empty</th>
              <th className="dd-num">Size</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              view.edit ? (
                <DatabaseRow
                  key={r.name}
                  name={r.name}
                  status={r.status}
                  description={r.fromComment ? '' : (r.description ?? '')}
                  placeholder={r.fromComment ? (r.description ?? '') : ''}
                  stats={{ tables: r.tables, rows: compactCount(r.rows), empty: r.empty, size: readableBytes(r.bytes) }}
                  tablesHref={dictHref({ ...view, tab: 'tables', db: r.name, edit: true })}
                />
              ) : (
                <tr key={r.name}>
                  <td className="dd-mono">
                    <Link href={dictHref({ ...view, tab: 'tables', db: r.name })}>{r.name}</Link>
                    {!r.onInstance && catalogOk ? <span className="dd-drift">not on the instance</span> : null}
                  </td>
                  <td>
                    <span className={`pill ${STATUS_TONE[r.status]}`}>{DATABASE_STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="dd-desc">
                    {r.description ? (
                      <>
                        {r.description}
                        {r.fromComment ? <span className="dd-src">From the database comment in ClickHouse</span> : null}
                      </>
                    ) : (
                      <span className="dd-gap">Not described</span>
                    )}
                  </td>
                  <td className="dd-num">
                    {r.tables}
                    {r.hiddenByRule ? <span className="dd-src">+{r.hiddenByRule} hidden</span> : null}
                  </td>
                  <td className="dd-num" title={r.rows.toLocaleString('en-US')}>
                    {catalogOk ? compactCount(r.rows) : '—'}
                  </td>
                  <td className="dd-num">{catalogOk ? r.empty : '—'}</td>
                  <td className="dd-num">{catalogOk ? readableBytes(r.bytes) : '—'}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <p className="dd-foot">
        {hidden ? (
          view.showAll ? (
            <Link href={dictHref({ ...view, showAll: false })}>Hide excluded and superseded databases</Link>
          ) : (
            <Link href={dictHref({ ...view, showAll: true })}>
              Show {hidden} excluded or superseded database{hidden === 1 ? '' : 's'}
            </Link>
          )
        ) : null}
        {view.edit ? <span> Status and description are saved per database and recorded in Activity.</span> : null}
      </p>
    </section>
  )
}

function TablesTab({
  view,
  catalogOk,
  tables,
  hiddenCount,
  hiddenWhy,
  tableNote,
  datasetsOfTable,
  described,
  databases,
  datasets,
}: {
  view: DictView
  catalogOk: boolean
  datasets: Array<{ id: string; name: string }>
  tables: CatalogTable[]
  hiddenCount: number
  hiddenWhy: (t: CatalogTable) => string | null
  tableNote: Map<string, { description: string | null; watchOut: string | null; emptyReason: string | null }>
  datasetsOfTable: Map<string, string[]>
  described: Map<string, number>
  databases: string[]
}) {
  const q = (view.q ?? '').toLowerCase()
  const inDb = tables.filter((t) => !view.db || t.database === view.db)
  // Counted before the text filter, so the number answers "how many tables
  // in this database still need a dataset?" whatever is typed in the box.
  const unassignedCount = inDb.filter((t) => !(datasetsOfTable.get(t.ref) ?? []).length).length
  const list = inDb
    .filter((t) => !view.unassigned || !(datasetsOfTable.get(t.ref) ?? []).length)
    .filter((t) => !q || `${t.ref} ${(datasetsOfTable.get(t.ref) ?? []).join(' ')} ${tableNote.get(t.ref)?.description ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => a.ref.localeCompare(b.ref))

  if (!catalogOk) return <p className="dd-foot">The table list comes from ClickHouse, which could not be read. Notes are kept and reappear when it can.</p>

  return (
    <section>
      <form className="dd-filter" action="/data-dictionary">
        <input type="hidden" name="tab" value="tables" />
        {view.env !== 'dev' ? <input type="hidden" name="env" value={view.env} /> : null}
        {view.edit ? <input type="hidden" name="edit" value="1" /> : null}
        {view.showAll ? <input type="hidden" name="show" value="all" /> : null}
        <input type="search" name="q" defaultValue={view.q} placeholder="Filter by table, dataset or description" aria-label="Filter tables" />
        <AutoSubmitSelect name="db" defaultValue={view.db} aria-label="Database">
          <option value="">All databases</option>
          {databases.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </AutoSubmitSelect>
        <AutoSubmitSelect name="only" defaultValue={view.unassigned ? 'unassigned' : ''} aria-label="Which tables">
          <option value="">All tables</option>
          <option value="unassigned">Not in a dataset</option>
        </AutoSubmitSelect>
        <button type="submit" className="btn">
          Filter
        </button>
        <span className="dd-count">
          {list.length} table{list.length === 1 ? '' : 's'}
          {!view.unassigned && unassignedCount ? (
            <>
              {' · '}
              <Link href={dictHref({ ...view, unassigned: true })}>{unassignedCount} not in a dataset</Link>
            </>
          ) : null}
        </span>
      </form>
      {view.edit ? <BulkAssignBar datasets={datasets} /> : null}
      <div className="dd-tablewrap">
        <table className="dd-table">
          <thead>
            <tr>
              {view.edit ? (
                <th className="dd-check">
                  <SelectAllBox />
                </th>
              ) : null}
              <th>Table</th>
              <th className="dd-num">Rows</th>
              <th>Status</th>
              <th>Datasets</th>
              <th>Fields described</th>
              <th>Last write</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => {
              const note = tableNote.get(t.ref)
              const reason = readEmptyReason(note?.emptyReason)
              const hid = hiddenWhy(t)
              return (
                <tr key={t.ref} className={hid ? 'dd-hidden' : ''}>
                  {view.edit ? (
                    <td className="dd-check">
                      <input type="checkbox" name="table" value={t.ref} form={BULK_FORM} aria-label={`Select ${t.ref}`} />
                    </td>
                  ) : null}
                  <td className="dd-mono">
                    <Link href={tableHref(view, t.database, t.name)}>{t.ref}</Link>
                    {note?.watchOut ? (
                      <span className="dd-watch" title={note.watchOut}>
                        watch out
                      </span>
                    ) : null}
                    {hid ? <span className="dd-src">Hidden: {hid}</span> : null}
                  </td>
                  <td className="dd-num" title={t.rows.toLocaleString('en-US')}>
                    {compactCount(t.rows)}
                  </td>
                  <td>
                    {t.rows > 0 ? (
                      <span className="pill tone-green">Loaded</span>
                    ) : (
                      <span className={`pill ${reason === 'by_design' ? 'tone-slate' : reason === 'awaiting_feed' ? 'tone-amber' : 'tone-red'}`}>
                        {reason ? EMPTY_REASON_LABEL[reason] : 'Empty, reason not stated'}
                      </span>
                    )}
                  </td>
                  <td className="dd-sets">{(datasetsOfTable.get(t.ref) ?? []).join(', ') || <span className="dd-gap">None</span>}</td>
                  <td>
                    {described.get(t.ref) ?? 0} of {t.columnCount}
                  </td>
                  <td className="dd-mono dd-quiet">{t.lastWrite ? t.lastWrite.slice(0, 16) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="dd-foot">
        {hiddenCount ? (
          view.showAll ? (
            <Link href={dictHref({ ...view, showAll: false })}>Hide backups, scratch tables and tables in excluded databases</Link>
          ) : (
            <Link href={dictHref({ ...view, showAll: true })}>
              Show {hiddenCount} hidden table{hiddenCount === 1 ? '' : 's'}: backups, scratch tables, and tables in excluded or superseded databases
            </Link>
          )
        ) : null}
      </p>
    </section>
  )
}
