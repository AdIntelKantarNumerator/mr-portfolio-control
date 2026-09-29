'use client'

/**
 * An assignment you can change in the cell it is shown in.
 *
 * Reads as text until you click it, then becomes a select. Same idea as the
 * click-to-edit on the list pages, and the same reason: the place you notice
 * a commitment is filed under the wrong initiative is the row you are reading,
 * and a correction that needs another screen does not get made.
 *
 * "Unknown" is a real value, shown in italics rather than as an empty cell. A
 * commitment nobody tied to an initiative is a fact about the commitment, and an
 * empty cell reads as a rendering bug.
 */
import { useState } from 'react'

export function AssignCell({
  value,
  name,
  options,
  onPick,
}: {
  /** The id currently set, or '' for unknown. */
  value: string
  /** What to show when not editing. */
  name: string | null
  options: Array<{ id: string; name: string }>
  onPick: (entityId: string) => Promise<{ error?: string } | void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState(name)
  const [error, setError] = useState<string | null>(null)

  async function pick(id: string) {
    setOpen(false)
    if (id === value) return
    setBusy(true)
    // Shown immediately, because the row is a list of facts and one of them
    // flickering back for a second reads as the save having failed.
    setShown(id ? (options.find((o) => o.id === id)?.name ?? null) : null)
    const res = await onPick(id).catch(() => ({ error: 'That could not be saved.' }))
    setBusy(false)
    if (res && 'error' in res && res.error) {
      setError(res.error)
      setShown(name)
    } else {
      setError(null)
    }
  }

  if (open) {
    return (
      <select
        autoFocus
        defaultValue={value}
        disabled={busy}
        onBlur={() => setOpen(false)}
        onChange={(e) => void pick(e.target.value)}
      >
        <option value="">Unknown</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    )
  }

  return (
    <button
      type="button"
      className={`rt-assign${shown ? '' : ' rt-unknown'}`}
      onClick={() => setOpen(true)}
      title={error ?? 'Click to change'}
      disabled={busy}
    >
      {shown ?? 'Unknown'}
      {error ? ' ⚠' : ''}
    </button>
  )
}
