'use client'

/**
 * The Data Dictionary's in-place editors: a database's status, a table's
 * notes, and a column's notes.
 *
 * Each saves through its own server action and says "Saved" in place. None of
 * them writes to ClickHouse; see actions.ts.
 */
import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'
import {
  DATABASE_STATUSES,
  DATABASE_STATUS_LABEL,
  EMPTY_REASONS,
  EMPTY_REASON_LABEL,
  type DatabaseStatus,
} from '@/lib/dictionary-rules'
import { saveColumnNote, saveDatabaseNote, saveTableNote, type DictState } from './actions'

const EMPTY: DictState = {}

export function DatabaseRow({
  name,
  status,
  description,
  placeholder,
  stats,
  tablesHref,
}: {
  name: string
  status: DatabaseStatus
  description: string
  placeholder: string
  stats: { tables: number; rows: string; empty: number; size: string }
  tablesHref: string
}) {
  const [state, save, saving] = useActionState(saveDatabaseNote, EMPTY)
  const formId = `db-${name}`
  return (
    <tr className="dd-editrow">
      <td className="dd-mono">
        <Link href={tablesHref}>{name}</Link>
        <form id={formId} action={save}>
          <input type="hidden" name="name" value={name} />
        </form>
      </td>
      <td>
        <select name="status" form={formId} defaultValue={status} aria-label={`Status of ${name}`}>
          {DATABASE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DATABASE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </td>
      <td className="dd-desc">
        <textarea
          name="description"
          form={formId}
          rows={2}
          defaultValue={description}
          placeholder={placeholder || 'What this database holds, and who reads it'}
          aria-label={`Description of ${name}`}
        />
        <div className="dd-saverow">
          <button type="submit" form={formId} className="btn" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {state.ok ? <span className="wa-ok">Saved</span> : null}
          {state.error || state.fieldErrors?.status ? <span className="wa-err">{state.error ?? state.fieldErrors?.status}</span> : null}
        </div>
      </td>
      <td className="dd-num">{stats.tables}</td>
      <td className="dd-num">{stats.rows}</td>
      <td className="dd-num">{stats.empty}</td>
      <td className="dd-num">{stats.size}</td>
    </tr>
  )
}

export function TableNoteEditor({
  tableRef,
  note,
  isEmpty,
}: {
  tableRef: string
  note: { description: string | null; owner: string | null; watchOut: string | null; emptyReason: string | null; excluded: boolean }
  isEmpty: boolean
}) {
  const [state, save, saving] = useActionState(saveTableNote, EMPTY)
  return (
    <form action={save} className="dd-noteform">
      <input type="hidden" name="ref" value={tableRef} />
      <div className="dd-noteform-grid">
        <span>
          <label className="wa-label" htmlFor="tn-desc">
            What this table holds
          </label>
          <textarea id="tn-desc" name="description" rows={3} defaultValue={note.description ?? ''} placeholder="One row per…, used for…" />
        </span>
        <span>
          <label className="wa-label" htmlFor="tn-watch">
            Watch out
          </label>
          <textarea id="tn-watch" name="watchOut" rows={3} defaultValue={note.watchOut ?? ''} placeholder="Anything that will produce a wrong number if you do not know it" />
        </span>
        <span>
          <label className="wa-label" htmlFor="tn-owner">
            Owner
          </label>
          <input id="tn-owner" name="owner" defaultValue={note.owner ?? ''} placeholder="Team or person" />
        </span>
        <span>
          <label className="wa-label" htmlFor="tn-empty">
            If empty, why
          </label>
          <select id="tn-empty" name="emptyReason" defaultValue={note.emptyReason ?? ''}>
            <option value="">{isEmpty ? 'Not stated' : 'Not applicable'}</option>
            {EMPTY_REASONS.map((r) => (
              <option key={r} value={r}>
                {EMPTY_REASON_LABEL[r]}
              </option>
            ))}
          </select>
        </span>
      </div>
      <label className="dd-check">
        <input type="checkbox" name="excluded" defaultChecked={note.excluded} />
        Hide this table from the dictionary (a backup, a scratch table, a mistake)
      </label>
      <div className="wa-row">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save table notes'}
        </button>
        {state.ok ? <span className="wa-ok">Saved and recorded in Activity.</span> : null}
        {state.error || state.fieldErrors?.emptyReason ? <span className="wa-err">{state.error ?? state.fieldErrors?.emptyReason}</span> : null}
      </div>
    </form>
  )
}

export interface ColumnRow {
  name: string
  type: string
  ddlComment: string
  key: string | null
  note: {
    description: string | null
    meaning: string | null
    watchOut: string | null
    source: string | null
    draftedBy: string | null
    updatedBy: string | null
  } | null
}

export function ColumnTable({ tableRef, columns, edit }: { tableRef: string; columns: ColumnRow[]; edit: boolean }) {
  const [open, setOpen] = useState<ColumnRow | null>(null)
  return (
    <>
      <div className="dd-tablewrap">
        <table className="dd-table dd-cols">
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Description</th>
              <th>Business meaning</th>
              <th>Watch out</th>
              <th>Source</th>
              {edit ? <th aria-label="Edit" /> : null}
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => {
              const n = c.note
              const description = n?.description ?? (c.ddlComment || null)
              return (
                <tr key={c.name}>
                  <td className="dd-mono">
                    {c.name}
                    {c.key ? <span className="dd-src">{c.key}</span> : null}
                  </td>
                  <td className="dd-mono dd-quiet">{c.type}</td>
                  <td>
                    {description ? description : <span className="dd-gap">Not described</span>}
                    {!n?.description && c.ddlComment ? <span className="dd-src">From the column comment in ClickHouse</span> : null}
                    {n?.draftedBy ? <span className="dd-src">Draft, not yet confirmed by a person</span> : null}
                    {n && !n.draftedBy && n.updatedBy ? <span className="dd-src">Written by {n.updatedBy}</span> : null}
                  </td>
                  <td>{n?.meaning ?? <span className="dd-gap">—</span>}</td>
                  <td className={n?.watchOut ? 'dd-watchcell' : ''}>{n?.watchOut ?? <span className="dd-gap">—</span>}</td>
                  <td className="dd-quiet">{n?.source ?? '—'}</td>
                  {edit ? (
                    <td>
                      <button type="button" className="btn" onClick={() => setOpen(c)}>
                        Edit
                      </button>
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {open ? <ColumnEditor tableRef={tableRef} column={open} onClose={() => setOpen(null)} /> : null}
    </>
  )
}

function ColumnEditor({ tableRef, column, onClose }: { tableRef: string; column: ColumnRow; onClose: () => void }) {
  const [state, save, saving] = useActionState(saveColumnNote, EMPTY)
  useEffect(() => {
    if (state.ok) onClose()
  }, [state.ok, state.stamp, onClose])
  const n = column.note
  return (
    <div className="modal-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal dd-modal" role="dialog" aria-modal="true" aria-label={`Describe ${column.name}`}>
        <div className="modal-head">
          <h3>
            <span className="dd-mono">{column.name}</span> <span className="dd-quiet dd-mono">{column.type}</span>
          </h3>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form action={save}>
          <input type="hidden" name="ref" value={tableRef} />
          <input type="hidden" name="column" value={column.name} />
          <label className="mr-label" htmlFor="cn-desc">
            Description
          </label>
          <textarea id="cn-desc" name="description" rows={2} defaultValue={n?.description ?? column.ddlComment ?? ''} placeholder="What the field holds" />
          <label className="mr-label" htmlFor="cn-meaning">
            Business meaning
          </label>
          <textarea id="cn-meaning" name="meaning" rows={2} defaultValue={n?.meaning ?? ''} placeholder="What it means to a client, and what it joins to" />
          <label className="mr-label" htmlFor="cn-watch">
            Watch out
          </label>
          <textarea id="cn-watch" name="watchOut" rows={2} defaultValue={n?.watchOut ?? ''} placeholder="Anything that will produce a wrong number" />
          <label className="mr-label" htmlFor="cn-source">
            Source
          </label>
          <input id="cn-source" name="source" defaultValue={n?.source ?? ''} placeholder="Where the value comes from" />
          {n?.draftedBy ? <p className="dd-src">These notes are a draft. Saving makes them yours.</p> : null}
          <div className="mr-row">
            <button type="submit" className="mr-go" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {state.error ? <span className="mr-said mr-bad">{state.error}</span> : null}
          </div>
        </form>
      </div>
    </div>
  )
}
