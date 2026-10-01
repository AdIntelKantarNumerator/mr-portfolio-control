'use client'

/**
 * The Workflow Assessment map: grouped or component view, a card for whatever
 * is selected, and the editor behind the Edit map button.
 *
 * WHAT THE COLOURS MEAN
 *
 * Box fill says what a thing is: plain for software, violet and rounded for a
 * human workflow, dashed for a rule set somebody owns. Red and amber are
 * reserved for reach: when a component's card has "Show what this reaches"
 * switched on, red is what it feeds directly and amber is everything further
 * downstream. Those two colours mean nothing else on this page, so the eye
 * can trust them.
 *
 * WHY THE SIDE PANEL AND NOT A MODAL
 *
 * Editing a component is mostly editing its connections, and you cannot pick
 * the other end of a connection while a dialog covers the map. The panel
 * keeps the map visible and the selection live.
 */
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import type { WorkflowComponentRow, WorkflowGroupRow, WorkflowLinkRow } from '@/lib/workflow'
import {
  COMPONENT_KINDS,
  KIND_LABEL,
  downstream,
  groupLinks,
  layout,
  type ComponentKind,
  type MapLink,
} from '@/lib/workflow-map'
import { addLink, deleteComponent, removeLink, saveComponent, type ComponentState } from './actions'

type View = 'groups' | 'components'
type Panel = { mode: 'none' } | { mode: 'card'; id: string } | { mode: 'edit'; id: string } | { mode: 'new'; kind: ComponentKind }

const SIZE = {
  groups: { w: 176, h: 56, colGap: 58, rowGap: 22 },
  components: { w: 150, h: 42, colGap: 34, rowGap: 14 },
}
const PAD = 14

/** SVG text does not wrap. Trim to roughly what fits, and say so with an ellipsis. */
function fit(text: string, chars: number): string {
  return text.length <= chars ? text : `${text.slice(0, chars - 1).trimEnd()}…`
}

export function WorkflowMap({
  groups,
  components,
  links,
}: {
  groups: WorkflowGroupRow[]
  components: WorkflowComponentRow[]
  links: WorkflowLinkRow[]
}) {
  const [view, setView] = useState<View>('groups')
  const [editing, setEditing] = useState(false)
  const [focusGroup, setFocusGroup] = useState<string | null>(null)
  const [reach, setReach] = useState(false)
  const [find, setFind] = useState('')

  const byId = useMemo(() => new Map(components.map((c) => [c.id, c])), [components])
  const groupBy = useMemo(() => new Map(groups.map((g) => [g.key, g])), [groups])
  const mapLinks: MapLink[] = useMemo(() => links.map((l) => ({ from: l.from, to: l.to })), [links])

  // A selected component that has since been deleted falls back to nothing
  // selected, rather than a card for a box that is no longer there.
  //
  // Except one just created: its id comes back from the action a moment
  // before the refreshed map does, and without this the panel would close on
  // the thing somebody had just made.
  //
  // Derived during render rather than reset in an effect, so there is no
  // frame where the stale card shows and no extra render to remove it.
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [panelState, setPanel] = useState<Panel>({ mode: 'none' })
  const chosen = panelState.mode === 'card' || panelState.mode === 'edit' ? panelState.id : null
  const panel: Panel = chosen && !byId.has(chosen) && chosen !== createdId ? { mode: 'none' } : panelState
  const selectedId = panel.mode === 'card' || panel.mode === 'edit' ? panel.id : null

  const rankComponent = useMemo(() => {
    return (id: string) => {
      const c = byId.get(id)
      const g = c ? groupBy.get(c.groupKey) : undefined
      return `${String(g?.sortOrder ?? 999).padStart(4, '0')} ${c?.name ?? id}`
    }
  }, [byId, groupBy])

  const componentLayout = useMemo(
    () => layout(components.map((c) => c.id), mapLinks, rankComponent),
    [components, mapLinks, rankComponent],
  )
  const groupEdges = useMemo(() => groupLinks(components, mapLinks), [components, mapLinks])
  const groupLayout = useMemo(
    () =>
      layout(
        groups.map((g) => g.key),
        groupEdges,
        (k) => String(groupBy.get(k)?.sortOrder ?? 999).padStart(4, '0'),
      ),
    [groups, groupEdges, groupBy],
  )

  const reachSets = useMemo(() => {
    if (!reach || !selectedId) return null
    const d = downstream(selectedId, mapLinks)
    const further = d.all.filter((id) => !d.direct.includes(id))
    return { direct: new Set(d.direct), further: new Set(further) }
  }, [reach, selectedId, mapLinks])

  const query = find.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!query) return null
    return new Set(
      components
        .filter((c) => `${c.name} ${c.aliases ?? ''} ${c.description ?? ''} ${c.detail ?? ''}`.toLowerCase().includes(query))
        .map((c) => c.id),
    )
  }, [components, query])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of components) m.set(c.groupKey, (m.get(c.groupKey) ?? 0) + 1)
    return m
  }, [components])

  const openComponent = (id: string) => {
    setView('components')
    setPanel(editing ? { mode: 'edit', id } : { mode: 'card', id })
  }

  const toggleEditing = () => {
    const next = !editing
    setEditing(next)
    if (next && panel.mode === 'card') setPanel({ mode: 'edit', id: panel.id })
    if (!next && (panel.mode === 'edit' || panel.mode === 'new')) setPanel(panel.mode === 'edit' ? { mode: 'card', id: panel.id } : { mode: 'none' })
  }

  const empty = components.length === 0

  return (
    <div className="wa">
      <div className="wa-bar">
        <span className="seg" role="group" aria-label="Map resolution">
          <button type="button" className={view === 'groups' ? 'on' : ''} onClick={() => setView('groups')}>
            Groups
          </button>
          <button type="button" className={view === 'components' ? 'on' : ''} onClick={() => setView('components')}>
            Components
          </button>
        </span>
        <input
          className="wa-find"
          type="search"
          value={find}
          onChange={(e) => {
            setFind(e.target.value)
            if (e.target.value.trim()) setView('components')
          }}
          placeholder="Find a component, alias or word in a description"
          aria-label="Find a component"
        />
        {focusGroup ? (
          <button type="button" className="wa-chipbtn" onClick={() => setFocusGroup(null)}>
            {groupBy.get(focusGroup)?.name ?? focusGroup} ×
          </button>
        ) : null}
        <button type="button" className={editing ? 'btn btn-primary' : 'btn'} onClick={toggleEditing}>
          {editing ? 'Done editing' : 'Edit map'}
        </button>
      </div>

      {editing ? (
        <div className="wa-editbar">
          <span>Editing. Click a box to edit it, or</span>
          <button type="button" className="btn" onClick={() => setPanel({ mode: 'new', kind: 'software' })}>
            + Add component
          </button>
          <button type="button" className="btn" onClick={() => setPanel({ mode: 'new', kind: 'human' })}>
            + Add human workflow
          </button>
          <span className="wa-editbar-note">Each save is recorded in Activity with your name.</span>
        </div>
      ) : null}

      <div className="wa-grid">
        <div className="wa-mapbox">
          <div className="wa-maphead">
            <span>
              {view === 'groups'
                ? `${groups.length} groups, ${components.length} components. Click a group to open it.`
                : `${components.length} components, ${links.length} connections. Read left to right: each box feeds what is to its right.`}
            </span>
            <span className="wa-legend">
              <span className="wa-lg wa-lg-sw">Software</span>
              <span className="wa-lg wa-lg-hu">Human workflow</span>
              <span className="wa-lg wa-lg-rule">Rule set</span>
              {reachSets ? (
                <>
                  <span className="wa-lg wa-lg-direct">Fed directly</span>
                  <span className="wa-lg wa-lg-further">Further downstream</span>
                </>
              ) : null}
            </span>
          </div>
          {empty ? (
            <div className="wa-empty">
              Nothing on the map yet. Run <code>npm run seed:reference</code> to load the starting map, or press Edit map and add
              the first component.
            </div>
          ) : (
            <div className="scroll-x wa-scroll">
              {view === 'groups' ? (
                <GroupsSvg
                  groups={groups}
                  columns={groupLayout.columns}
                  edges={groupEdges}
                  counts={counts}
                  selectedGroup={selectedId ? byId.get(selectedId)?.groupKey ?? null : null}
                  onOpen={(key) => {
                    setFocusGroup(key)
                    setView('components')
                  }}
                />
              ) : (
                <ComponentsSvg
                  byId={byId}
                  columns={componentLayout.columns}
                  links={mapLinks}
                  backLinks={componentLayout.backLinks}
                  selectedId={selectedId}
                  reach={reachSets}
                  matches={matches}
                  focusGroup={focusGroup}
                  editing={editing}
                  onOpen={openComponent}
                />
              )}
            </div>
          )}
        </div>

        <aside className="wa-side" aria-live="polite">
          {panel.mode === 'none' ? (
            <Intro components={components} onOpen={openComponent} editing={editing} />
          ) : panel.mode === 'card' && byId.get(panel.id) ? (
            <Card
              component={byId.get(panel.id)!}
              groupName={groupBy.get(byId.get(panel.id)!.groupKey)?.name ?? ''}
              byId={byId}
              links={mapLinks}
              reach={reach}
              setReach={setReach}
              onOpen={openComponent}
              onClose={() => setPanel({ mode: 'none' })}
              onEdit={() => {
                setEditing(true)
                setPanel({ mode: 'edit', id: panel.id })
              }}
            />
          ) : panel.mode === 'edit' && byId.get(panel.id) ? (
            <Editor
              key={panel.id}
              component={byId.get(panel.id)!}
              defaultKind={byId.get(panel.id)!.kind}
              groups={groups}
              byId={byId}
              links={mapLinks}
              onSaved={(id) => setPanel({ mode: 'edit', id })}
              onClose={() => setPanel({ mode: 'card', id: panel.id })}
              onDeleted={() => setPanel({ mode: 'none' })}
            />
          ) : panel.mode === 'new' ? (
            <Editor
              key={`new-${panel.kind}`}
              component={null}
              defaultKind={panel.kind}
              groups={groups}
              byId={byId}
              links={mapLinks}
              onSaved={(id) => {
                setCreatedId(id)
                setPanel({ mode: 'edit', id })
                setView('components')
              }}
              onClose={() => setPanel({ mode: 'none' })}
              onDeleted={() => setPanel({ mode: 'none' })}
            />
          ) : null}
        </aside>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function curve(x1: number, y1: number, x2: number, y2: number): string {
  if (x2 > x1) {
    const mid = (x1 + x2) / 2
    return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
  }
  // A link set aside to break a cycle runs right to left. It loops under the
  // boxes so it does not cut back through them.
  const drop = Math.max(y1, y2) + 40
  return `M ${x1} ${y1} C ${x1 + 60} ${drop}, ${x2 - 60} ${drop}, ${x2} ${y2}`
}

function place(columns: string[][], w: number, h: number, colGap: number, rowGap: number) {
  const tallest = Math.max(1, ...columns.map((c) => c.length))
  const width = PAD * 2 + columns.length * w + Math.max(0, columns.length - 1) * colGap
  const height = PAD * 2 + tallest * h + (tallest - 1) * rowGap
  const pos = new Map<string, { x: number; y: number }>()
  columns.forEach((col, ci) => {
    const colH = col.length * h + Math.max(0, col.length - 1) * rowGap
    const offset = (height - PAD * 2 - colH) / 2
    col.forEach((id, ri) => pos.set(id, { x: PAD + ci * (w + colGap), y: PAD + offset + ri * (h + rowGap) }))
  })
  return { pos, width, height }
}

function Arrowheads() {
  return (
    <defs>
      <marker id="wa-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="var(--muted)" />
      </marker>
      <marker id="wa-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="var(--red)" />
      </marker>
    </defs>
  )
}

function GroupsSvg({
  groups,
  columns,
  edges,
  counts,
  selectedGroup,
  onOpen,
}: {
  groups: WorkflowGroupRow[]
  columns: string[][]
  edges: (MapLink & { count: number })[]
  counts: Map<string, number>
  selectedGroup: string | null
  onOpen: (key: string) => void
}) {
  const { w, h, colGap, rowGap } = SIZE.groups
  const { pos, width, height } = place(columns, w, h, colGap, rowGap)
  const byKey = new Map(groups.map((g) => [g.key, g]))
  return (
    <svg className="wa-svg" width={width} height={height + 30} viewBox={`0 0 ${width} ${height + 30}`} role="img" aria-label="Groups of components, read left to right">
      <Arrowheads />
      {edges.map((e) => {
        const a = pos.get(e.from)
        const b = pos.get(e.to)
        if (!a || !b) return null
        return (
          <path key={`${e.from}-${e.to}`} className="wa-edge" d={curve(a.x + w, a.y + h / 2, b.x, b.y + h / 2)} markerEnd="url(#wa-arrow)">
            <title>{`${byKey.get(e.from)?.name} → ${byKey.get(e.to)?.name}: ${e.count} connection${e.count === 1 ? '' : 's'}`}</title>
          </path>
        )
      })}
      {columns.flat().map((key) => {
        const g = byKey.get(key)
        const p = pos.get(key)
        if (!g || !p) return null
        const n = counts.get(key) ?? 0
        return (
          <g
            key={key}
            className={`wa-node${g.kind === 'human' ? ' wa-human' : ''}${selectedGroup === key ? ' wa-selected' : ''}`}
            transform={`translate(${p.x},${p.y})`}
            role="button"
            tabIndex={0}
            aria-label={`${g.name}, ${n} component${n === 1 ? "" : "s"}`}
            onClick={() => onOpen(key)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(key))}
          >
            <rect width={w} height={h} rx={g.kind === 'human' ? 16 : 8} />
            <text x={10} y={23} className="wa-t">
              {fit(g.name, 27)}
            </text>
            <text x={10} y={41} className="wa-count">
              {n} component{n === 1 ? '' : 's'}
              {g.kind === 'human' ? ' · people' : ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function ComponentsSvg({
  byId,
  columns,
  links,
  backLinks,
  selectedId,
  reach,
  matches,
  focusGroup,
  editing,
  onOpen,
}: {
  byId: Map<string, WorkflowComponentRow>
  columns: string[][]
  links: MapLink[]
  backLinks: MapLink[]
  selectedId: string | null
  reach: { direct: Set<string>; further: Set<string> } | null
  matches: Set<string> | null
  focusGroup: string | null
  editing: boolean
  onOpen: (id: string) => void
}) {
  const { w, h, colGap, rowGap } = SIZE.components
  const { pos, width, height } = place(columns, w, h, colGap, rowGap)
  const back = new Set(backLinks.map((l) => `${l.from}\u0000${l.to}`))

  // Something is "lit" when it is the point of the current view: reached by
  // the selection, matched by Find, or in the focused group. Everything else
  // dims, so the lit set reads at a glance.
  const lit = (id: string): boolean | null => {
    if (reach) return id === selectedId || reach.direct.has(id) || reach.further.has(id)
    if (matches) return matches.has(id)
    if (focusGroup) return byId.get(id)?.groupKey === focusGroup
    return null
  }

  return (
    <svg className="wa-svg" width={width} height={height + 50} viewBox={`0 0 ${width} ${height + 50}`} role="img" aria-label="Components, read left to right">
      <Arrowheads />
      {links.map((l) => {
        const a = pos.get(l.from)
        const b = pos.get(l.to)
        if (!a || !b) return null
        const hot = reach && l.from === selectedId
        const warm = reach && !hot && (reach.direct.has(l.from) || reach.further.has(l.from)) && (reach.direct.has(l.to) || reach.further.has(l.to))
        const touchesSelection = !reach && selectedId && (l.from === selectedId || l.to === selectedId)
        const cls = `wa-edge${hot ? ' wa-edge-hot' : warm ? ' wa-edge-warm' : touchesSelection ? ' wa-edge-sel' : ''}${back.has(`${l.from}\u0000${l.to}`) ? ' wa-edge-back' : ''}`
        return (
          <path
            key={`${l.from}-${l.to}`}
            className={cls}
            d={curve(a.x + w, a.y + h / 2, b.x, b.y + h / 2)}
            markerEnd={hot ? 'url(#wa-arrow-hot)' : 'url(#wa-arrow)'}
          >
            <title>{`${byId.get(l.from)?.name} feeds ${byId.get(l.to)?.name}`}</title>
          </path>
        )
      })}
      {columns.flat().map((id) => {
        const c = byId.get(id)
        const p = pos.get(id)
        if (!c || !p) return null
        const state = lit(id)
        const tier = reach ? (id === selectedId ? '' : reach.direct.has(id) ? ' wa-direct' : reach.further.has(id) ? ' wa-further' : '') : ''
        const cls =
          'wa-node' +
          (c.kind === 'human' ? ' wa-human' : c.kind === 'rule' ? ' wa-rule' : '') +
          (c.isData ? ' wa-data' : '') +
          tier +
          (id === selectedId ? ' wa-selected' : '') +
          (state === false ? ' wa-dim' : '')
        return (
          <g
            key={id}
            className={cls}
            transform={`translate(${p.x},${p.y})`}
            role="button"
            tabIndex={0}
            aria-label={c.name}
            onClick={() => onOpen(id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(id))}
          >
            <rect width={w} height={h} rx={c.kind === 'human' ? 14 : 7} />
            <text x={8} y={c.detail ? 17 : 25} className="wa-t">
              {fit(c.name, 23)}
            </text>
            {c.detail ? (
              <text x={8} y={31} className="wa-sub">
                {fit(c.detail, 30)}
              </text>
            ) : null}
            {!c.description ? <circle className="wa-gapdot" cx={w - 9} cy={9} r={3.2} /> : null}
            {editing ? (
              <text x={w - 18} y={h - 7} className="wa-pencil">
                ✎
              </text>
            ) : null}
            <title>{`${c.name}${c.description ? '' : ' (no description yet)'}`}</title>
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------

function Intro({
  components,
  onOpen,
  editing,
}: {
  components: WorkflowComponentRow[]
  onOpen: (id: string) => void
  editing: boolean
}) {
  const undescribed = components.filter((c) => !c.description)
  const unowned = components.filter((c) => !c.owner)
  const seeded = components.filter((c) => c.updatedBy === 'seed').length
  return (
    <div className="wa-panel">
      <h2 className="wa-panel-title">How to use this</h2>
      <p className="wa-p">
        Click any box to see what it handles, what feeds it and what it feeds. On a component&apos;s card, <b>Show what this
        reaches</b> lights up everything downstream of it.
      </p>
      <p className="wa-p wa-muted">
        The assessment chat, where you describe a change in plain words and get the likely reach back, is the next phase. It
        will match against each component&apos;s name, aliases and description, so filling those in now is what makes it
        accurate later.
      </p>
      {seeded ? (
        <p className="wa-p wa-muted">
          {seeded} of {components.length} components are still as seeded on 1 October. Owners on those are first guesses.
        </p>
      ) : null}
      {undescribed.length ? (
        <>
          <h3 className="wa-h3">No description yet ({undescribed.length})</h3>
          <ul className="wa-list">
            {undescribed.slice(0, 12).map((c) => (
              <li key={c.id}>
                <button type="button" className="wa-link" onClick={() => onOpen(c.id)}>
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {unowned.length ? (
        <>
          <h3 className="wa-h3">No owner yet ({unowned.length})</h3>
          <ul className="wa-list">
            {unowned.slice(0, 12).map((c) => (
              <li key={c.id}>
                <button type="button" className="wa-link" onClick={() => onOpen(c.id)}>
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {editing ? <p className="wa-p wa-muted">Editing is on. Click a box to change it, or add a new one from the bar above.</p> : null}
    </div>
  )
}

function Card({
  component: c,
  groupName,
  byId,
  links,
  reach,
  setReach,
  onOpen,
  onClose,
  onEdit,
}: {
  component: WorkflowComponentRow
  groupName: string
  byId: Map<string, WorkflowComponentRow>
  links: MapLink[]
  reach: boolean
  setReach: (v: boolean) => void
  onOpen: (id: string) => void
  onClose: () => void
  onEdit: () => void
}) {
  const ups = links.filter((l) => l.to === c.id).map((l) => l.from)
  const downs = links.filter((l) => l.from === c.id).map((l) => l.to)
  const reachAll = downstream(c.id, links).all
  const names = (ids: string[]) => ids.map((id) => byId.get(id)).filter(Boolean) as WorkflowComponentRow[]
  return (
    <div className="wa-panel">
      <div className="wa-panel-head">
        <span className={`pill ${c.kind === 'human' ? 'tone-violet' : c.kind === 'rule' ? 'tone-amber' : 'tone-blue'}`}>{KIND_LABEL[c.kind]}</span>
        <button type="button" className="wa-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <h2 className="wa-panel-title">{c.name}</h2>
      {c.detail ? <p className="wa-detail">{c.detail}</p> : null}
      {c.description ? <p className="wa-p">{c.description}</p> : <p className="wa-p wa-gap">No description yet. The chat cannot match a request to a component nobody has described.</p>}
      <dl className="wa-kv">
        <dt>Group</dt>
        <dd>{groupName}</dd>
        <dt>Owner</dt>
        <dd>{c.owner ?? <span className="wa-gap">Nobody named</span>}</dd>
        <dt>Aliases</dt>
        <dd className="wa-muted">{c.aliases ?? 'None'}</dd>
        <dt>Fed by</dt>
        <dd>
          <Links items={names(ups)} onOpen={onOpen} />
        </dd>
        <dt>Feeds</dt>
        <dd>
          <Links items={names(downs)} onOpen={onOpen} />
        </dd>
      </dl>
      <label className="wa-reach">
        <input type="checkbox" checked={reach} onChange={(e) => setReach(e.target.checked)} />
        <span>
          Show what this reaches: {downs.length} directly, {reachAll.length} in all
        </span>
      </label>
      <p className="wa-p wa-muted wa-small">
        Last changed by {c.updatedBy === 'seed' ? 'the starting seed' : (c.updatedBy ?? 'nobody recorded')} on{' '}
        {new Date(c.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.
      </p>
      <button type="button" className="btn" onClick={onEdit}>
        Edit this component
      </button>
    </div>
  )
}

function Links({ items, onOpen }: { items: WorkflowComponentRow[]; onOpen: (id: string) => void }) {
  if (!items.length) return <span className="wa-muted">Nothing</span>
  return (
    <span className="wa-chips">
      {items.map((x) => (
        <button key={x.id} type="button" className="wa-chipbtn" onClick={() => onOpen(x.id)}>
          {x.name}
        </button>
      ))}
    </span>
  )
}

const EMPTY: ComponentState = {}

function Editor({
  component,
  defaultKind,
  groups,
  byId,
  links,
  onSaved,
  onClose,
  onDeleted,
}: {
  component: WorkflowComponentRow | null
  defaultKind: ComponentKind
  groups: WorkflowGroupRow[]
  byId: Map<string, WorkflowComponentRow>
  links: MapLink[]
  onSaved: (id: string) => void
  onClose: () => void
  onDeleted: () => void
}) {
  const [state, save, saving] = useActionState(saveComponent, EMPTY)
  const [pending, startTransition] = useTransition()
  const [linkError, setLinkError] = useState<string | null>(null)
  const [other, setOther] = useState('')
  const [direction, setDirection] = useState<'feeds-this' | 'fed-by-this'>('feeds-this')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (state.ok && state.id && state.id !== component?.id) onSaved(state.id)
  }, [state.stamp, state.ok, state.id, component?.id, onSaved])

  const id = component?.id ?? null
  const ups = id ? links.filter((l) => l.to === id).map((l) => l.from) : []
  const downs = id ? links.filter((l) => l.from === id).map((l) => l.to) : []
  const others = [...byId.values()].filter((c) => c.id !== id).sort((a, b) => a.name.localeCompare(b.name))
  const defaultGroup = component?.groupKey ?? (defaultKind === 'human' ? groups.find((g) => g.kind === 'human')?.key : groups[0]?.key) ?? ''

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, after?: () => void) => {
    setLinkError(null)
    startTransition(async () => {
      const r = await fn()
      if (r.error) setLinkError(r.error)
      else after?.()
    })
  }

  const err = state.fieldErrors ?? {}

  return (
    <div className="wa-panel">
      <div className="wa-panel-head">
        <span className="pill tone-amber">{component ? 'Editing' : 'New'}</span>
        <button type="button" className="wa-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <h2 className="wa-panel-title">{component ? component.name : defaultKind === 'human' ? 'New human workflow' : 'New component'}</h2>

      <form action={save} className="wa-form">
        {id ? <input type="hidden" name="id" value={id} /> : null}
        <label className="wa-label" htmlFor="wa-name">
          Name
        </label>
        <input id="wa-name" name="name" defaultValue={component?.name ?? ''} placeholder="What people call it" required />
        {err.name ? <p className="wa-err">{err.name}</p> : null}

        <div className="wa-two">
          <span>
            <label className="wa-label" htmlFor="wa-kind">
              Kind
            </label>
            <select id="wa-kind" name="kind" defaultValue={component?.kind ?? defaultKind}>
              {COMPONENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </span>
          <span>
            <label className="wa-label" htmlFor="wa-group">
              Group
            </label>
            <select id="wa-group" name="groupKey" defaultValue={defaultGroup}>
              {groups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.name}
                </option>
              ))}
            </select>
          </span>
        </div>
        {err.groupKey ? <p className="wa-err">{err.groupKey}</p> : null}

        <label className="wa-label" htmlFor="wa-owner">
          Owner
        </label>
        <input id="wa-owner" name="owner" defaultValue={component?.owner ?? ''} placeholder="Team or person" />

        <label className="wa-label" htmlFor="wa-desc">
          What it handles
        </label>
        <textarea
          id="wa-desc"
          name="description"
          rows={5}
          defaultValue={component?.description ?? ''}
          placeholder="Two or three sentences: what it does, what it reads, what it produces. The assessment chat matches requests against this."
        />

        <label className="wa-label" htmlFor="wa-detail">
          Rules or tables, one line
        </label>
        <input id="wa-detail" name="detail" defaultValue={component?.detail ?? ''} placeholder="e.g. rules: Automotive, Pharma · or the tables it owns" />

        <label className="wa-label" htmlFor="wa-aliases">
          Aliases
        </label>
        <input id="wa-aliases" name="aliases" defaultValue={component?.aliases ?? ''} placeholder="Comma-separated words people use for it" />

        <div className="wa-row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : component ? 'Save' : 'Create'}
          </button>
          {state.ok && component ? <span className="wa-ok">Saved and recorded in Activity.</span> : null}
          {state.error ? <span className="wa-err">{state.error}</span> : null}
        </div>
      </form>

      {id ? (
        <div className="wa-links">
          <h3 className="wa-h3">Fed by: what changes reach this from</h3>
          <EditableLinks items={ups.map((x) => byId.get(x)).filter(Boolean) as WorkflowComponentRow[]} disabled={pending} onRemove={(other) => run(() => removeLink(other, id))} />
          <h3 className="wa-h3">Feeds: what a change here can reach</h3>
          <EditableLinks items={downs.map((x) => byId.get(x)).filter(Boolean) as WorkflowComponentRow[]} disabled={pending} onRemove={(other) => run(() => removeLink(id, other))} />

          <h3 className="wa-h3">Add a connection</h3>
          <div className="wa-addlink">
            <select aria-label="Other component" value={other} onChange={(e) => setOther(e.target.value)}>
              <option value="">Choose a component…</option>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select aria-label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              <option value="feeds-this">feeds this</option>
              <option value="fed-by-this">is fed by this</option>
            </select>
            <button
              type="button"
              className="btn"
              disabled={!other || pending}
              onClick={() =>
                run(
                  () => (direction === 'feeds-this' ? addLink(other, id) : addLink(id, other)),
                  () => setOther(''),
                )
              }
            >
              Add
            </button>
          </div>
          {linkError ? <p className="wa-err">{linkError}</p> : null}

          <div className="wa-danger">
            {confirmDelete ? (
              <>
                <span>
                  Remove {component!.name} and its {ups.length + downs.length} connection{ups.length + downs.length === 1 ? '' : 's'}?
                </span>
                <button type="button" className="btn wa-btn-danger" disabled={pending} onClick={() => run(() => deleteComponent(id), onDeleted)}>
                  Remove it
                </button>
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className="btn wa-btn-danger" onClick={() => setConfirmDelete(true)}>
                Remove this component
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="wa-p wa-muted wa-small">Connections can be added once it is created.</p>
      )}
    </div>
  )
}

function EditableLinks({
  items,
  disabled,
  onRemove,
}: {
  items: WorkflowComponentRow[]
  disabled: boolean
  onRemove: (id: string) => void
}) {
  if (!items.length) return <p className="wa-p wa-muted wa-small">None yet.</p>
  return (
    <span className="wa-chips">
      {items.map((x) => (
        <span key={x.id} className="wa-linkchip">
          {x.name}
          <button type="button" aria-label={`Remove the connection with ${x.name}`} disabled={disabled} onClick={() => onRemove(x.id)}>
            ×
          </button>
        </span>
      ))}
    </span>
  )
}
