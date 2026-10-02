'use client'

/**
 * Renaming the map's groups, in edit mode.
 *
 * Added 2 October 2026, when "Vivvix Central Operations" needed to become
 * "Data Operations" and the map had no way to do it: groups came from the
 * seed and only components were editable. Only the name changes. The group's
 * key stays the same, so every component in it, every saved assessment and
 * the layout are untouched, and the rename shows everywhere at once.
 */
import { useState, useTransition } from 'react'
import type { WorkflowGroupRow } from '@/lib/workflow'
import { renameGroup } from './actions'

export function GroupsEditor({
  groups,
  counts,
  onClose,
}: {
  groups: WorkflowGroupRow[]
  counts: Map<string, number>
  onClose: () => void
}) {
  return (
    <div className="wa-panel">
      <div className="wa-panel-head">
        <span className="pill tone-blue">Groups</span>
        <button type="button" className="wa-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <h2 className="wa-panel-title">Rename groups</h2>
      <p className="wa-p wa-muted wa-small">
        A new name shows everywhere at once. The components in a group stay in it, and each rename is recorded in Activity with your name.
      </p>
      <div className="wa-groups-edit">
        {groups.map((g) => (
          <GroupRow key={g.key} group={g} count={counts.get(g.key) ?? 0} />
        ))}
      </div>
    </div>
  )
}

function GroupRow({ group, count }: { group: WorkflowGroupRow; count: number }) {
  const [name, setName] = useState(group.name)
  const [saved, setSaved] = useState(group.name)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const changed = name.trim() !== saved

  const save = () =>
    start(async () => {
      setError(null)
      const r = await renameGroup(group.key, name)
      if (r.error) setError(r.error)
      else setSaved(name.trim())
    })

  return (
    <form
      className="wa-group-row"
      onSubmit={(e) => {
        e.preventDefault()
        if (changed && !pending) save()
      }}
    >
      <label className="wa-group-label">
        <span className="wa-muted wa-small">
          {count} component{count === 1 ? '' : 's'}
        </span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label={`Name of the group now called ${saved}`} />
      </label>
      <button type="submit" className="btn" disabled={!changed || pending}>
        {pending ? 'Saving…' : 'Save'}
      </button>
      {error ? <p className="wa-p wa-error wa-small">{error}</p> : null}
    </form>
  )
}
