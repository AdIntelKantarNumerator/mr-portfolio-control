'use client'

/**
 * One list, with columns you can filter.
 *
 * WHY ONE COMPONENT FOR FOUR PAGES
 *
 * Action items, dependencies, blockers and decisions are four tables and one
 * question — what is outstanding and whose is it. They had four layouts, four
 * filter conventions and four ideas of where the owner goes, so moving between
 * them meant re-learning the page each time. The registers differ in their
 * columns; they do not differ in what a register IS.
 *
 * WHY THE FILTERING IS IN THE BROWSER
 *
 * These lists are hundreds of rows, not hundreds of thousands. Filtering here
 * is instant and keeps the filters and the rows in one place; a URL round trip
 * per keystroke would be slower and would put the state somewhere the table
 * cannot see. The one thing that costs is that a filter is not in the link you
 * send somebody — which, for a working list you scan and act on, is a fair
 * trade.
 *
 * WHY A SELECT AND NOT A SEARCH BOX PER COLUMN
 *
 * A select can only offer values that are actually in the data, so it cannot
 * be filled in with something that matches nothing. Free text is offered only
 * where the column is prose.
 */
import { useMemo, useState } from 'react'

export interface Column<T> {
  key: string
  label: string
  /**
   * How this column narrows the list. 'select' offers the values present;
   * 'text' matches anywhere in the value. Omitted means it does not filter.
   */
  filter?: 'select' | 'text'
  /** The plain value, used for filtering and sorting. */
  value: (row: T) => string | null
  /** What is drawn. Defaults to the value. */
  cell?: (row: T) => React.ReactNode
  /** A CSS width for the column, when the content needs one. */
  width?: string
  className?: string
}

export function RecordTable<T>({
  rows,
  columns,
  getId,
  empty,
  action,
  footNote,
}: {
  rows: T[]
  columns: Column<T>[]
  getId: (row: T) => string
  empty: string
  /** A button for the top right — adding a record, usually. */
  action?: React.ReactNode
  /** One line under the table, when the list needs a caveat. */
  footNote?: React.ReactNode
}) {
  const [filters, setFilters] = useState<Record<string, string>>({})

  const options = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const col of columns) {
      if (col.filter !== 'select') continue
      const seen = new Set<string>()
      for (const row of rows) {
        const v = col.value(row)
        if (v) seen.add(v)
      }
      out[col.key] = [...seen].sort((a, b) => a.localeCompare(b))
    }
    return out
  }, [rows, columns])

  const shown = useMemo(
    () =>
      rows.filter((row) =>
        columns.every((col) => {
          const want = filters[col.key]
          if (!want) return true
          const got = col.value(row) ?? ''
          return col.filter === 'text' ? got.toLowerCase().includes(want.toLowerCase()) : got === want
        }),
      ),
    [rows, columns, filters],
  )

  const filtering = Object.values(filters).some(Boolean)
  const set = (key: string, value: string) => setFilters((f) => ({ ...f, [key]: value }))

  return (
    <>
      <div className="rt-bar">
        {columns
          .filter((c) => c.filter)
          .map((col) =>
            col.filter === 'select' ? (
              <label key={col.key} className="rt-f">
                <span>{col.label}</span>
                <select value={filters[col.key] ?? ''} onChange={(e) => set(col.key, e.target.value)}>
                  <option value="">All</option>
                  {(options[col.key] ?? []).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label key={col.key} className="rt-f">
                <span>{col.label}</span>
                <input
                  value={filters[col.key] ?? ''}
                  onChange={(e) => set(col.key, e.target.value)}
                  placeholder="Find…"
                />
              </label>
            ),
          )}

        {filtering && (
          <button type="button" className="rt-clear" onClick={() => setFilters({})}>
            Clear
          </button>
        )}

        <span className="rt-count">
          {shown.length}
          {filtering && shown.length !== rows.length ? ` of ${rows.length}` : ''}
        </span>

        {action ? <span className="rt-action">{action}</span> : null}
      </div>

      {shown.length === 0 ? (
        <p className="rt-empty">{filtering ? 'Nothing matches those filters.' : empty}</p>
      ) : (
        <div className="rt-wrap">
          <table className="rt">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} style={c.width ? { width: c.width } : undefined} className={c.className}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={getId(row)}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.className}>
                      {c.cell ? c.cell(row) : (c.value(row) ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {footNote ? <p className="rt-foot">{footNote}</p> : null}
    </>
  )
}
