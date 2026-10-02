/**
 * One ClickHouse table, down to the field.
 *
 * Read-only facts come from ClickHouse: engine, keys, row count, size, when
 * it was last written, every column and its type. Everything a person knows
 * sits beside them: what the table holds, what will produce a wrong number,
 * why it is empty if it is, which datasets it belongs to, and a description,
 * meaning, warning and source per column.
 *
 * A column described by a machine and not yet confirmed says "Draft". A
 * column with only a comment in its DDL shows that comment, labelled as such,
 * so the gap between "somebody wrote this down in the schema" and "somebody
 * confirmed it here" stays visible.
 *
 * Two tabs under the table's notes: Fields, and Preview, which shows the
 * first ten rows. The preview is read only when its tab is open, so the
 * Fields tab costs ClickHouse nothing extra, and it goes through the same
 * read-only guard as everything else (lib/clickhouse-guard.ts).
 */
import Link from 'next/link'
import { Kicker } from '@/components/ui'
import { readCatalog, readColumnNotes, readColumns, readDictionaryNotes, readPreview, type PreviewResult } from '@/lib/dictionary'
import {
  DATABASE_STATUS_LABEL,
  EMPTY_REASON_LABEL,
  compactCount,
  excludedByRule,
  previewCell,
  previewProblem,
  readDatabaseStatus,
  readEmptyReason,
  readEnvironment,
  readableBytes,
  tableRef,
} from '@/lib/dictionary-rules'
import { ConnectionNote, DictionaryHeader } from '../../header'
import { ColumnTable, TableNoteEditor, type ColumnRow } from '../../editors'
import { TableDatasets } from '../../assign'
import { dictHref, tableHref, type TablePane } from '../../href'

export const dynamic = 'force-dynamic'

type Params = Promise<{ database: string; table: string }>
type Search = Promise<Record<string, string | string[] | undefined>>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

export async function generateMetadata({ params }: { params: Params }) {
  const { database, table } = await params
  return { title: `${decodeURIComponent(database)}.${decodeURIComponent(table)} · Data Dictionary` }
}

export default async function TablePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { database: rawDb, table: rawTable } = await params
  const sp = await searchParams
  const database = decodeURIComponent(rawDb)
  const table = decodeURIComponent(rawTable)
  const ref = tableRef(database, table)
  const env = readEnvironment(one(sp.env))
  const edit = one(sp.edit) === '1'
  const pane: TablePane = one(sp.view) === 'preview' ? 'preview' : 'fields'

  const [result, notes, columnNotes, columns] = await Promise.all([
    readCatalog(env),
    readDictionaryNotes(),
    readColumnNotes(ref),
    readColumns(env, database, table),
  ])

  const facts = result.state === 'ok' ? result.catalog.tables.find((t) => t.ref === ref) ?? null : null
  // Only a table ClickHouse says exists, on an engine whose read stays inside
  // ClickHouse, is previewed. The check is made here, before anything is sent.
  const blocked = facts ? previewProblem(facts.engine) : null
  const preview: PreviewResult | null = pane === 'preview' && facts && !blocked ? await readPreview(env, database, table) : null
  const note = notes.tables.find((t) => t.tableRef === ref)
  const dbStatus = readDatabaseStatus(notes.databases.find((d) => d.name === database)?.status) ?? 'unreviewed'
  const datasets = notes.datasets.filter((d) => d.tables.includes(ref))
  const reason = readEmptyReason(note?.emptyReason)
  const rule = excludedByRule(table)

  const noteOf = new Map(columnNotes.map((n) => [n.columnName, n]))
  const live = columns.ok ? columns.columns : []
  const rows: ColumnRow[] = live.map((c) => ({
    name: c.name,
    type: c.type,
    ddlComment: c.comment,
    key: c.inPartitionKey && c.inSortingKey ? 'partition + sort key' : c.inPartitionKey ? 'partition key' : c.inSortingKey ? 'sort key' : null,
    note: noteOf.get(c.name) ?? null,
  }))
  // Notes on columns that are no longer in the table: drift, shown rather
  // than dropped, so a rename upstream is noticed.
  const liveNames = new Set(live.map((c) => c.name))
  const orphanNotes = columns.ok ? columnNotes.filter((n) => !liveNames.has(n.columnName)) : []
  const undescribed = rows.filter((r) => !r.note?.description && !r.ddlComment).length
  const drafts = rows.filter((r) => r.note?.draftedBy).length

  const view = { env, edit }
  const hrefFor = (change: { env?: typeof env; edit?: boolean }) =>
    tableHref({ env: change.env ?? env, edit: change.edit ?? edit, pane }, database, table)
  // SELECT * leaves out MATERIALIZED and ALIAS columns, so the preview has
  // fewer columns than the Fields tab. Said on screen rather than left to look
  // like a bug.
  const computed = live.filter((c) => c.defaultKind === 'MATERIALIZED' || c.defaultKind === 'ALIAS').length

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>
            <Link href={dictHref({ env, edit, tab: 'tables', db: database })}>Data Dictionary · {database}</Link>
          </Kicker>
          <h1 className="dd-title">{ref}</h1>
        </div>
      </div>

      <DictionaryHeader env={env} result={result} edit={edit} hrefFor={hrefFor} />
      <ConnectionNote result={result} />

      {result.state === 'ok' && !facts ? (
        <div className="dd-note dd-note-bad">
          This table is not in ClickHouse {env === 'prod' ? 'Prod' : 'Dev'}. {note || columnNotes.length ? 'The notes below were kept, so a rename or a drop can be traced.' : ''}
        </div>
      ) : null}

      <div className="dd-facts">
        <Fact label="Database" value={`${database} · ${DATABASE_STATUS_LABEL[dbStatus]}`} />
        <Fact label="Engine" value={facts?.engine ?? '—'} />
        <Fact label="Sort key" value={facts?.sortingKey || '—'} />
        <Fact label="Partition" value={facts?.partitionKey || 'none'} />
        <Fact label="Rows" value={facts ? facts.rows.toLocaleString('en-US') : '—'} />
        <Fact label="Compressed" value={facts ? readableBytes(facts.bytes) : '—'} />
        <Fact label="Last write" value={facts?.lastWrite?.slice(0, 16) ?? (facts ? 'never' : '—')} />
        <Fact label="Latest partition" value={facts?.latestPartition ?? '—'} />
      </div>

      {note?.watchOut ? (
        <div className="dd-note dd-note-warn">
          <b>Watch out.</b> {note.watchOut}
        </div>
      ) : null}
      {facts && facts.rows === 0 ? (
        <div className={`dd-note ${reason === 'by_design' ? 'dd-note-info' : 'dd-note-warn'}`}>
          <b>Empty.</b> {reason ? `${EMPTY_REASON_LABEL[reason]}.` : 'Nobody has said whether this is by design or awaiting a feed. The two look identical in the schema and mean opposite things to whoever builds on it.'}
        </div>
      ) : null}
      {rule ? <div className="dd-note dd-note-info">Hidden from the dictionary by default: {rule}.</div> : null}

      <section className="dd-section">
        <h2 className="dd-h2">About this table</h2>
        {edit ? (
          <TableNoteEditor
            tableRef={ref}
            note={{
              description: note?.description ?? null,
              owner: note?.owner ?? null,
              watchOut: note?.watchOut ?? null,
              emptyReason: note?.emptyReason ?? null,
              excluded: note?.excluded ?? false,
            }}
            isEmpty={Boolean(facts && facts.rows === 0)}
          />
        ) : null}
        {edit ? (
          <TableDatasets
            tableRef={ref}
            current={datasets.map((d) => ({ id: d.id, name: d.name }))}
            datasets={notes.datasets.map((d) => ({ id: d.id, name: d.name }))}
          />
        ) : (
          <dl className="dd-kv">
            <dt>Holds</dt>
            <dd>
              {note?.description ?? (facts?.comment ? facts.comment : <span className="dd-gap">Not described yet</span>)}
              {!note?.description && facts?.comment ? <span className="dd-src">From the table comment in ClickHouse</span> : null}
            </dd>
            <dt>Owner</dt>
            <dd>{note?.owner ?? <span className="dd-gap">Nobody named</span>}</dd>
            <dt>Datasets</dt>
            <dd>
              {datasets.length ? (
                datasets.map((d, i) => (
                  <span key={d.id}>
                    {i ? ', ' : ''}
                    <Link href={dictHref({ env, edit })}>{d.name}</Link>
                  </span>
                ))
              ) : (
                <span className="dd-gap">In no dataset</span>
              )}
            </dd>
            {note?.updatedBy && note.updatedBy !== 'seed' ? (
              <>
                <dt>Notes by</dt>
                <dd>{note.updatedBy}</dd>
              </>
            ) : null}
          </dl>
        )}
        {edit && facts?.comment ? (
          <p className="dd-src">
            Table comment in ClickHouse: <span className="dd-quiet">{facts.comment}</span>
          </p>
        ) : null}
      </section>

      <section className="dd-section">
        <nav className="dd-tabs" aria-label="Table sections">
          <Link href={tableHref({ env, edit, pane: 'fields' }, database, table)} className={pane === 'fields' ? 'on' : ''} aria-current={pane === 'fields' ? 'page' : undefined}>
            Fields
          </Link>
          <Link href={tableHref({ env, edit, pane: 'preview' }, database, table)} className={pane === 'preview' ? 'on' : ''} aria-current={pane === 'preview' ? 'page' : undefined}>
            Preview
          </Link>
        </nav>

        {pane === 'preview' ? (
          <PreviewPane envLabel={env === 'prod' ? 'Prod' : 'Dev'} exists={Boolean(facts)} catalogOk={result.state === 'ok'} blocked={blocked} preview={preview} computed={computed} />
        ) : (
          <>
        <p className="dd-h2-note dd-pane-note">
          {columns.ok
            ? `${rows.length} fields · ${rows.length - undescribed} described${drafts ? ` · ${drafts} drafts to confirm` : ''}`
            : ''}
        </p>
        {columns.ok ? (
          <ColumnTable tableRef={ref} columns={rows} edit={edit} />
        ) : (
          <p className="dd-foot">{columns.message} Notes on this table&apos;s fields are kept and reappear when it can be read.</p>
        )}
        {orphanNotes.length ? (
          <div className="dd-note dd-note-warn">
            <b>Notes on fields no longer in this table:</b> {orphanNotes.map((n) => n.columnName).join(', ')}. Renamed or dropped upstream; worth
            moving the notes or deleting them.
          </div>
        ) : null}
          </>
        )}
      </section>

      <p className="dd-foot">
        <Link href={dictHref({ ...view, tab: 'tables', db: database })}>← All tables in {database}</Link>
        {facts ? <span className="dd-quiet"> · {compactCount(facts.rows)} rows · {facts.columnCount} fields</span> : null}
      </p>
    </div>
  )
}

function PreviewPane({
  envLabel,
  exists,
  catalogOk,
  blocked,
  preview,
  computed,
}: {
  envLabel: string
  exists: boolean
  catalogOk: boolean
  blocked: string | null
  preview: PreviewResult | null
  computed: number
}) {
  if (!catalogOk) return <p className="dd-foot">ClickHouse {envLabel} could not be read, so there is nothing to preview.</p>
  if (!exists) return <p className="dd-foot">This table is not in ClickHouse {envLabel}, so there are no rows to show.</p>
  if (blocked) return <div className="dd-note dd-note-info">{blocked}</div>
  if (!preview) return null
  if (!preview.ok) return <p className="dd-foot">{preview.message}</p>
  if (preview.rows.length === 0) return <p className="dd-foot">ClickHouse returned no rows: the table is empty in {envLabel}.</p>

  return (
    <>
      <p className="dd-h2-note dd-pane-note">
        The first {preview.rows.length} rows ClickHouse read, in no particular order · {preview.columns.length} columns · read{' '}
        {preview.readAt.slice(11, 16)} UTC, read-only, not stored
        {computed ? ` · ${computed} computed ${computed === 1 ? 'column is' : 'columns are'} not part of a plain read and ${computed === 1 ? 'is' : 'are'} left out` : ''}
      </p>
      <div className="dd-tablewrap dd-preview-wrap">
        <table className="dd-table dd-preview">
          <thead>
            <tr>
              {preview.columns.map((c) => (
                <th key={c.name} title={c.type}>
                  {c.name}
                  <span className="dd-preview-type">{c.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, i) => (
              <tr key={i}>
                {preview.columns.map((c) => {
                  const cell = previewCell(row[c.name], c.type)
                  return (
                    <td key={c.name} className={`dd-cell-${cell.kind}`} title={cell.title}>
                      {cell.text}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="dd-fact">
      {label}
      <b title={value}>{value}</b>
    </div>
  )
}
