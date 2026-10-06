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
 *
 * SORTING IS IN THE BROWSER FOR THE SAME REASON, AND IS OPT-IN PER COLUMN
 *
 * A column says whether it can be sorted and on what. Most sort on the value
 * they already show; the date columns sort on the date behind a filter bucket
 * like "Past due", and the status columns on the workflow order rather than
 * the alphabet, because Resolved does not come before Watching in any sense a
 * reader means. A column of controls sorts on nothing and its heading stays a
 * heading.
 */
import { useMemo, useState } from 'react'

/** A named order for the "Sort by" menu. The first is the default. */
export interface SortOption<T> {
  key: string
  label: string
  compare: (a: T, b: T) => number
}
import { nextOrder, sortRows, type Order, type SortKind, type SortValue } from '@/lib/record-sort'

export interface Column<T> {
  key: string
  label: string
  /**
   * How this column narrows the list. 'select' offers the values present;
   * 'text' matches anywhere in the value. Omitted means it does not filter.
   */
  filter?: 'select' | 'text'
  /** The plain value, used for filtering and as the default sort key. */
  value: (row: T) => string | null
  /**
   * Makes the heading a sort control. A kind on its own sorts by `value`; pass
   * `{ by }` where the displayed value is a bucket rather than the fact — the
   * Due column filters on "Past due / Dated / Unknown" and sorts on the date.
   */
  sort?: SortKind | { kind: SortKind; by: (row: T) => SortValue }
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
  sortOptions,
  pageSize,
  controls,
  onFilterChange,
}: {
  rows: T[]
  columns: Column<T>[]
  getId: (row: T) => string
  empty: string
  /** A button for the top right — adding a record, usually. */
  action?: React.ReactNode
  /** One line under the table, when the list needs a caveat. */
  footNote?: React.ReactNode
  /**
   * A "Sort by" menu, for the work-in-progress dashboards (importance, ref,
   * date). A clicked heading still wins while it is set.
   */
  sortOptions?: SortOption<T>[]
  /** Rows per page; unset shows them all, as every list did before. */
  pageSize?: number
  /** More controls for the filter bar: the dashboards' include/exclude switches. */
  controls?: React.ReactNode
  /** Told whenever a filter changes, so a page can widen what the filter runs over. */
  onFilterChange?: () => void
}) {
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [order, setOrder] = useState<Order | null>(null)
  const [sortKey, setSortKey] = useState(sortOptions?.[0]?.key ?? '')
  const [page, setPage] = useState(0)

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

  /*
   * Sorted after filtering, and only when a heading has been clicked: with no
   * order of its own the table shows the rows in the order the page sent them,
   * which each page has thought about. See lib/record-sort.ts.
   */
  const ordered = useMemo(() => {
    if (!order) {
      const named = sortOptions?.find((o) => o.key === sortKey)
      return named ? [...shown].sort(named.compare) : shown
    }
    const col = columns.find((c) => c.key === order.key)
    if (!col?.sort) return shown
    const kind = typeof col.sort === 'string' ? col.sort : col.sort.kind
    const by = typeof col.sort === 'string' ? col.value : col.sort.by
    return sortRows(shown, by, kind, order.dir)
  }, [shown, columns, order, sortOptions, sortKey])

  const filtering = Object.values(filters).some(Boolean)
  const set = (key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(0)
    onFilterChange?.()
  }

  // Paged after filtering and ordering, so page 1 is always the first of
  // what the reader asked for.
  const pages = pageSize ? Math.max(1, Math.ceil(ordered.length / pageSize)) : 1
  const at = Math.min(page, pages - 1)
  const visible = pageSize ? ordered.slice(at * pageSize, at * pageSize + pageSize) : ordered

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

        {sortOptions && sortOptions.length > 1 ? (
          <label className="rt-f">
            <span>Sort by</span>
            <select
              value={sortKey}
              onChange={(e) => {
                setSortKey(e.target.value)
                setOrder(null)
                setPage(0)
              }}
            >
              {sortOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {controls}

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
                {columns.map((c) => {
                  const on = order?.key === c.key ? order.dir : null
                  return (
                    <th
                      key={c.key}
                      style={c.width ? { width: c.width } : undefined}
                      className={c.className}
                      // Announced to a screen reader, which otherwise has no
                      // way to know the list is ordered by this column.
                      aria-sort={on === 1 ? 'ascending' : on === -1 ? 'descending' : undefined}
                    >
                      {c.sort ? (
                        <button
                          type="button"
                          className={`rt-sort${on ? ' on' : ''}`}
                          onClick={() => setOrder((o) => nextOrder(o, c.key))}
                          title={
                            on === 1
                              ? `Sorted by ${c.label || 'this column'} — click for the reverse`
                              : on === -1
                                ? 'Click to go back to the page order'
                                : `Sort by ${c.label || 'this column'}`
                          }
                        >
                          {c.label}
                          <span aria-hidden="true">{on === 1 ? '\u2191' : on === -1 ? '\u2193' : '\u2195'}</span>
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
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

      {pageSize && pages > 1 ? (
        <nav className="rt-pages" aria-label="Pages">
          <button type="button" onClick={() => setPage(at - 1)} disabled={at === 0}>
            ‹ Previous
          </button>
          <span>
            Page {at + 1} of {pages}
          </span>
          <button type="button" onClick={() => setPage(at + 1)} disabled={at >= pages - 1}>
            Next ›
          </button>
        </nav>
      ) : null}

      {footNote ? <p className="rt-foot">{footNote}</p> : null}
    </>
  )
}
