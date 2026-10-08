'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setSeriesClosed } from '../actions'
import { SeriesEditor, type KnownMeeting } from '../editor'

export function SeriesTools({
  series,
  known,
}: {
  series: { id: string; name: string; meetings: string[]; status: string }
  known: KnownMeeting[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const open = series.status === 'open'

  async function toggle() {
    setBusy(true)
    await setSeriesClosed({ id: series.id, closed: open }).catch(() => null)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="ser-tools">
      <button type="button" className="btn" onClick={() => setEditing(true)}>
        Edit
      </button>
      <button type="button" className="btn" onClick={toggle} disabled={busy}>
        {busy ? '…' : open ? 'Close' : 'Reopen'}
      </button>
      {editing ? <SeriesEditor series={series} known={known} onClose={() => setEditing(false)} /> : null}
    </div>
  )
}
