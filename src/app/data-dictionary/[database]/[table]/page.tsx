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
 */
import Link from 'next/link'
import { Kicker } from '@/components/ui'
import { readCatalog, readColumnNotes, readColumns, readDictionaryNotes } from '@/lib/dictionary'
import {
  DATABASE_STATUS_LABEL,
  EMPTY_REASON_LABEL,
  compactCount,
  excludedByRule,
  readDatabaseStatus,
  readEmptyReason,
  readEnvironment,
  readableBytes,
  tableRef,
} from '@/lib/dictionary-rules'
import { ConnectionNote, DictionaryHeader } from '../../header'
import { ColumnTable, TableNoteEditor, type ColumnRow } from '../../editors'
import { dictHref, tableHref } from '../../href'

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

  const [result, notes, columnNotes, columns] = await Promise.all([
    readCatalog(env),
    readDictionaryNotes(),
    readColumnNotes(ref),
    readColumns(env, database, table),
  ])

  const facts = result.state === 'ok' ? result.catalog.tables.find((t) => t.ref === ref) ?? null : null
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
  const hrefFor = (change: { env?: typeof env; edit?: boolean }) => tableHref({ env: change.env ?? env, edit: change.edit ?? edit }, database, table)

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
        <h2 className="dd-h2">
          Fields
          <span className="dd-h2-note">
            {columns.ok
              ? `${rows.length} fields · ${rows.length - undescribed} described${drafts ? ` · ${drafts} drafts to confirm` : ''}`
              : ''}
          </span>
        </h2>
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
      </section>

      <p className="dd-foot">
        <Link href={dictHref({ ...view, tab: 'tables', db: database })}>← All tables in {database}</Link>
        {facts ? <span className="dd-quiet"> · {compactCount(facts.rows)} rows · {facts.columnCount} fields</span> : null}
      </p>
    </div>
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
