'use client'

/**
 * Managing the map's groups, in edit mode: add, rename, remove, and which
 * components are in each.
 *
 * Renaming came first (2 October 2026, "Vivvix Central Operations" to "Data
 * Operations"); adding, removing and moving components between groups were
 * asked for the same day. Groups had come from the seed and only components
 * were editable.
 *
 * A group's key never changes after it is made, so a rename moves nothing,
 * and components point at the key. Removing a group that still has
 * components means saying where they go; they move in the same step (see
 * removeGroup in ./actions.ts). The map lays groups out from their
 * connections, so a new group appears in the right column as soon as
 * something in it is connected.
 */
import { useState, useTransition } from 'react'
import { GROUP_KINDS, type GroupKind } from '@/lib/workflow-map'
import type { WorkflowComponentRow, WorkflowGroupRow } from '@/lib/workflow'
import { addGroup, moveComponent, removeGroup, renameGroup } from './actions'

const KIND_WORD: Record<GroupKind, string> = { software: 'Systems', human: 'Human workflow' }

export function GroupsEditor({
  groups,
  components,
  onOpen,
  onClose,
}: {
  groups: WorkflowGroupRow[]
  components: WorkflowComponentRow[]
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const members = (key: string) => components.filter((c) => c.groupKey === key).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="wa-panel">
      <div className="wa-panel-head">
        <span className="pill tone-blue">Groups</span>
        <button type="button" className="wa-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <h2 className="wa-panel-title">Manage groups</h2>
      <p className="wa-p wa-muted wa-small">
        Rename a group, move components between groups, add a group or remove one. Every change is recorded in Activity with your name.
      </p>
      <AddGroup />
      <div className="wa-groups-edit">
        {groups.map((g) => (
          <GroupRow key={g.key} group={g} groups={groups} members={members(g.key)} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}

function AddGroup() {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<GroupKind>('software')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <form
      className="wa-group-add"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim() || pending) return
        start(async () => {
          setError(null)
          setDone(null)
          const r = await addGroup(name, kind)
          if (r.error) setError(r.error)
          else {
            setDone(`Added "${name.trim()}". Move components into it below, or pick it when adding one.`)
            setName('')
          }
        })
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name" maxLength={80} aria-label="New group name" />
      <select value={kind} onChange={(e) => setKind(e.target.value as GroupKind)} aria-label="Kind of group">
        {GROUP_KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_WORD[k]}
          </option>
        ))}
      </select>
      <button type="submit" className="btn" disabled={!name.trim() || pending}>
        {pending ? 'Adding…' : '+ Add group'}
      </button>
      {error ? <p className="wa-p wa-error wa-small">{error}</p> : null}
      {done ? <p className="wa-p wa-muted wa-small wa-full">{done}</p> : null}
    </form>
  )
}

function GroupRow({
  group,
  groups,
  members,
  onOpen,
}: {
  group: WorkflowGroupRow
  groups: WorkflowGroupRow[]
  members: WorkflowComponentRow[]
  onOpen: (id: string) => void
}) {
  const [name, setName] = useState(group.name)
  const [saved, setSaved] = useState(group.name)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [moveTo, setMoveTo] = useState('')
  const [pending, start] = useTransition()
  const changed = name.trim() !== saved
  const others = groups.filter((g) => g.key !== group.key)

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null)
      const r = await fn()
      if (r.error) setError(r.error)
      else after?.()
    })

  return (
    <div className="wa-group-card">
      <form
        className="wa-group-row"
        onSubmit={(e) => {
          e.preventDefault()
          if (changed && !pending) run(() => renameGroup(group.key, name), () => setSaved(name.trim()))
        }}
      >
        <label className="wa-group-label">
          <span className="wa-muted wa-small">
            {KIND_WORD[group.kind as GroupKind] ?? group.kind} · {members.length} component{members.length === 1 ? '' : 's'}
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label={`Name of the group now called ${saved}`} />
        </label>
        <button type="submit" className="btn" disabled={!changed || pending}>
          {pending && changed ? 'Saving…' : 'Save'}
        </button>
      </form>

      <div className="wa-group-tools">
        <button type="button" className="wa-linkbtn" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide components' : `Components (${members.length})`}
        </button>
        <button type="button" className="wa-linkbtn wa-danger" onClick={() => setRemoving(!removing)} aria-expanded={removing}>
          Remove group
        </button>
      </div>

      {removing ? (
        <div className="wa-group-remove">
          {members.length ? (
            <label className="wa-small">
              Move its {members.length} component{members.length === 1 ? '' : 's'} to{' '}
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Group to move them to">
                <option value="">choose a group…</option>
                {others.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="wa-small wa-muted">It is empty, so nothing moves.</span>
          )}
          <button
            type="button"
            className="btn wa-btn-danger"
            disabled={pending || (members.length > 0 && !moveTo)}
            onClick={() => {
              const target = others.find((g) => g.key === moveTo)?.name
              const sure = window.confirm(
                members.length
                  ? `Remove "${saved}" and move its ${members.length} component${members.length === 1 ? '' : 's'} to "${target}"?`
                  : `Remove the empty group "${saved}"?`,
              )
              if (sure) run(() => removeGroup(group.key, moveTo || null))
            }}
          >
            {pending ? 'Removing…' : 'Remove'}
          </button>
        </div>
      ) : null}

      {open ? (
        <ul className="wa-group-members">
          {members.length === 0 ? <li className="wa-muted wa-small">Nothing in this group yet.</li> : null}
          {members.map((c) => (
            <li key={c.id}>
              <button type="button" className="wa-linkbtn" onClick={() => onOpen(c.id)} title="Open this component">
                {c.name}
              </button>
              <select
                value={group.key}
                disabled={pending}
                onChange={(e) => {
                  const to = e.target.value
                  if (to !== group.key) run(() => moveComponent(c.id, to))
                }}
                aria-label={`Group for ${c.name}`}
              >
                {groups.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.key === group.key ? `${g.name} (here)` : `Move to ${g.name}`}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="wa-p wa-error wa-small">{error}</p> : null}
    </div>
  )
}
