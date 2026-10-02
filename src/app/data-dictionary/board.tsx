'use client'

/**
 * The Datasets tab: one tile per dataset, and the dialog that edits one.
 *
 * Each tile shows the two things the tab exists to compare — loaded status,
 * computed from the tables, and intent, stated by a person — and the tables
 * themselves as chips coloured by what they hold, so a "Partial" can be read
 * down to which table is the reason without opening anything.
 */
import Link from 'next/link'
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import {
  DATASET_STATUS_LABEL,
  EMPTY_REASON_LABEL,
  INTENTS,
  INTENT_LABEL,
  compactCount,
  type DatasetStatus,
  type EmptyReason,
  type Environment,
  type Intent,
} from '@/lib/dictionary-rules'
import { deleteDataset, reorderDatasets, saveDataset, type DictState } from './actions'
import { dropsBelow, moveCard } from '@/lib/reorder'

export interface DatasetTile {
  id: string
  name: string
  owner: string | null
  description: string | null
  explainedBy: string | null
  intentDev: string
  intentProd: string
  intentHere: Intent
  status: DatasetStatus
  attention: boolean
  rows: number
  tables: { ref: string; state: 'rows' | 'empty' | 'missing' | 'unknown'; rows: number; reason: EmptyReason | null; href: string }[]
}

const STATUS_TONE: Record<DatasetStatus, string> = {
  loaded: 'tone-green',
  partial: 'tone-amber',
  not_loaded: 'tone-red',
  unknown: 'tone-slate',
}

export function DatasetBoard({
  tiles,
  edit,
  env,
  tableOptions,
}: {
  tiles: DatasetTile[]
  edit: boolean
  env: Environment
  tableOptions: string[]
}) {
  const [editing, setEditing] = useState<DatasetTile | 'new' | null>(null)

  /*
   * Dragging tiles into a new order, in edit mode.
   *
   * The same arrangement as the home page's cards (components/sortable-cards
   * and lib/reorder): a grip to hold, so the table chips and buttons inside a
   * tile still click; the tile moves at once and the server is told after;
   * a failed save says so and the next render puts it back. The grip also
   * takes the arrow keys, so the order can be changed without a mouse.
   */
  const [order, setOrder] = useState<string[] | null>(null)
  const [held, setHeld] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [orderError, setOrderError] = useState<string | null>(null)
  const serverIds = tiles.map((t) => t.id).join(',')
  const [seenIds, setSeenIds] = useState(serverIds)
  if (serverIds !== seenIds) {
    setSeenIds(serverIds)
    setOrder(null)
  }
  const byId = new Map(tiles.map((t) => [t.id, t]))
  const shown = order ? (order.map((id) => byId.get(id)).filter(Boolean) as DatasetTile[]) : tiles
  const ids = shown.map((t) => t.id)

  function commit(next: string[]) {
    if (next === ids || next.join(',') === ids.join(',')) return
    setOrder(next)
    setOrderError(null)
    void reorderDatasets(next)
      .then((r) => setOrderError(r.error ?? null))
      .catch(() => setOrderError('The new order could not be saved.'))
  }
  const nudge = (id: string, by: -1 | 1) => {
    const at = ids.indexOf(id)
    const to = ids[at + by]
    if (to) commit(moveCard(ids, id, to))
  }

  return (
    <>
      {edit ? (
        <div className="dd-actions">
          <button type="button" className="btn" onClick={() => setEditing('new')}>
            + Add dataset
          </button>
          {orderError ? <b className="dd-bad">{orderError}</b> : null}
        </div>
      ) : null}
      {tiles.length === 0 ? (
        <p className="dd-foot">
          No datasets defined yet. Run <code>npm run seed:reference</code> for the starting set, or press Edit and add one.
        </p>
      ) : (
        <div className="dd-tiles">
          {shown.map((t) => (
            <article
              key={t.id}
              className={[
                `dd-tile dd-s-${t.status}`,
                held === t.id ? 'dd-held' : '',
                over === t.id && held && held !== t.id ? (dropsBelow(ids, held, t.id) ? 'dd-over-after' : 'dd-over-before') : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onDragOver={(e) => {
                if (!edit || !held) return
                // Without this the drop is refused and the tile springs back.
                e.preventDefault()
                setOver(t.id)
              }}
              onDrop={(e) => {
                if (!edit || !held) return
                e.preventDefault()
                commit(moveCard(ids, held, t.id))
                setHeld(null)
                setOver(null)
              }}
            >
              <header className="dd-tile-head">
                {edit ? (
                  <button
                    type="button"
                    className="dd-grip"
                    draggable
                    onDragStart={(e) => {
                      setHeld(t.id)
                      e.dataTransfer.effectAllowed = 'move'
                      // Firefox refuses to start a drag with an empty payload.
                      e.dataTransfer.setData('text/plain', t.id)
                    }}
                    onDragEnd={() => {
                      setHeld(null)
                      setOver(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                        e.preventDefault()
                        nudge(t.id, -1)
                      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                        e.preventDefault()
                        nudge(t.id, 1)
                      }
                    }}
                    aria-label={`Move ${t.name}: drag, or use the arrow keys`}
                    title="Drag to reorder (or focus and use the arrow keys)"
                  >
                    ⠿
                  </button>
                ) : null}
                <h3>{t.name}</h3>
                <span className={`pill ${STATUS_TONE[t.status]}`}>{DATASET_STATUS_LABEL[t.status]}</span>
              </header>
              {t.description ? <p className="dd-tile-desc">{t.description}</p> : <p className="dd-tile-desc dd-gap">Not described yet.</p>}
              <div className="dd-tile-nums">
                <span>
                  Tables<b>{t.tables.length}</b>
                </span>
                <span>
                  Rows<b>{t.status === 'unknown' ? '—' : compactCount(t.rows)}</b>
                </span>
                <span>
                  Intent · {env === 'prod' ? 'Prod' : 'Dev'}
                  <b className={t.attention ? 'dd-attn' : ''}>{INTENT_LABEL[t.intentHere]}</b>
                </span>
              </div>
              <div className="dd-chiprow">
                {t.tables.map((x) => (
                  <Link
                    key={x.ref}
                    href={x.href}
                    className={`dd-tchip dd-t-${x.state}${x.state === 'empty' && x.reason === 'by_design' ? ' dd-t-design' : ''}`}
                    title={
                      x.state === 'rows'
                        ? `${x.ref}: ${x.rows.toLocaleString('en-US')} rows`
                        : x.state === 'empty'
                          ? `${x.ref}: empty${x.reason ? ` (${EMPTY_REASON_LABEL[x.reason].toLowerCase()})` : ', reason not stated'}`
                          : x.state === 'missing'
                            ? `${x.ref}: not in ClickHouse`
                            : x.ref
                    }
                  >
                    {x.ref.split('.').slice(1).join('.')}
                  </Link>
                ))}
              </div>
              <footer className="dd-tile-foot">
                <span>
                  {t.owner ? `Owner: ${t.owner}` : 'No owner named'}
                  {t.explainedBy ? ` · ${t.explainedBy}` : ''}
                </span>
                {edit ? (
                  <button type="button" className="btn" onClick={() => setEditing(t)}>
                    Edit
                  </button>
                ) : null}
              </footer>
            </article>
          ))}
        </div>
      )}
      {editing ? <DatasetEditor tile={editing === 'new' ? null : editing} tableOptions={tableOptions} onClose={() => setEditing(null)} /> : null}
    </>
  )
}

const EMPTY: DictState = {}

function DatasetEditor({ tile, tableOptions, onClose }: { tile: DatasetTile | null; tableOptions: string[]; onClose: () => void }) {
  const [state, save, saving] = useActionState(saveDataset, EMPTY)
  const [tables, setTables] = useState<string[]>(tile?.tables.map((t) => t.ref) ?? [])
  const [pick, setPick] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [deleting, startDelete] = useTransition()
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (state.ok) onClose()
  }, [state.ok, state.stamp, onClose])

  const options = useMemo(() => [...new Set([...tableOptions, ...tables])].sort(), [tableOptions, tables])
  const add = () => {
    const ref = pick.trim()
    if (ref && !tables.includes(ref)) setTables([...tables, ref].sort())
    setPick('')
  }
  const err = state.fieldErrors ?? {}

  return (
    <div className="modal-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal dd-modal" role="dialog" aria-modal="true" aria-label={tile ? `Edit ${tile.name}` : 'Add a dataset'}>
        <div className="modal-head">
          <h3>{tile ? `Edit ${tile.name}` : 'Add a dataset'}</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form action={save}>
          {tile ? <input type="hidden" name="id" value={tile.id} /> : null}
          {tables.map((t) => (
            <input key={t} type="hidden" name="table" value={t} />
          ))}

          <label className="mr-label" htmlFor="ds-name">
            Name
          </label>
          <input id="ds-name" name="name" defaultValue={tile?.name ?? ''} placeholder="e.g. Sports Sponsorship" required />
          {err.name ? <p className="mr-said mr-bad">{err.name}</p> : null}

          <label className="mr-label" htmlFor="ds-desc">
            What it is
          </label>
          <textarea id="ds-desc" name="description" rows={3} defaultValue={tile?.description ?? ''} placeholder="What a client or a loader team means by it" />

          <div className="mr-grid dd-grid3">
            <span>
              <label className="mr-label" htmlFor="ds-owner">
                Owner
              </label>
              <input id="ds-owner" name="owner" defaultValue={tile?.owner ?? ''} placeholder="Team or person" />
            </span>
            <span>
              <label className="mr-label" htmlFor="ds-dev">
                Should Dev hold it?
              </label>
              <select id="ds-dev" name="intentDev" defaultValue={tile?.intentDev ?? 'undecided'}>
                {INTENTS.map((i) => (
                  <option key={i} value={i}>
                    {INTENT_LABEL[i]}
                  </option>
                ))}
              </select>
            </span>
            <span>
              <label className="mr-label" htmlFor="ds-prod">
                Should Prod hold it?
              </label>
              <select id="ds-prod" name="intentProd" defaultValue={tile?.intentProd ?? 'undecided'}>
                {INTENTS.map((i) => (
                  <option key={i} value={i}>
                    {INTENT_LABEL[i]}
                  </option>
                ))}
              </select>
            </span>
          </div>

          <label className="mr-label" htmlFor="ds-why">
            Explained by
          </label>
          <input id="ds-why" name="explainedBy" defaultValue={tile?.explainedBy ?? ''} placeholder="The Blocker, Decision or Initiative behind its status" />

          <label className="mr-label" htmlFor="ds-pick">
            Tables it hits
          </label>
          <div className="dd-picked">
            {tables.length ? (
              tables.map((t) => (
                <span key={t} className="dd-pickchip">
                  {t}
                  <button type="button" aria-label={`Remove ${t}`} onClick={() => setTables(tables.filter((x) => x !== t))}>
                    ×
                  </button>
                </span>
              ))
            ) : (
              <span className="dd-gap">No tables yet.</span>
            )}
          </div>
          <div className="dd-pickrow">
            <input
              id="ds-pick"
              list="ds-table-options"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  add()
                }
              }}
              placeholder="Type to find a table, e.g. gpc_detail.sports"
            />
            <datalist id="ds-table-options">
              {options.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
            <button type="button" className="btn" onClick={add} disabled={!pick.trim()}>
              Add table
            </button>
          </div>
          {err.tables ? <p className="mr-said mr-bad">{err.tables}</p> : null}

          <div className="mr-row">
            <button type="submit" className="mr-go" disabled={saving}>
              {saving ? 'Saving…' : tile ? 'Save' : 'Add dataset'}
            </button>
            {state.error ? <span className="mr-said mr-bad">{state.error}</span> : null}
            {tile ? (
              confirm ? (
                <span className="dd-confirm">
                  Remove the dataset? Its tables are not touched.
                  <button
                    type="button"
                    className="btn wa-btn-danger"
                    disabled={deleting}
                    onClick={() =>
                      startDelete(async () => {
                        const r = await deleteDataset(tile.id)
                        if (r.error) setDeleteError(r.error)
                        else onClose()
                      })
                    }
                  >
                    Remove
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirm(false)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="btn wa-btn-danger dd-right" onClick={() => setConfirm(true)}>
                  Remove dataset
                </button>
              )
            ) : null}
          </div>
          {deleteError ? <p className="mr-said mr-bad">{deleteError}</p> : null}
        </form>
      </div>
    </div>
  )
}
