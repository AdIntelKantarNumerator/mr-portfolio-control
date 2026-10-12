'use client'

/** The session summary, with the way to earlier sessions and to editing it. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MarkdownView } from '@/components/markdown-view'
import { Modal } from '@/components/items/parts'
import { saveSummaryEdit } from '../actions'

interface Summary {
  id: string
  label: string
  markdown: string
  raw: string
  edited: boolean
  editedBy: string | null
  notesChanged: boolean
  documentUrl: string | null
}

export function SessionView({ seriesId, sessions, summary }: { seriesId: string; sessions: Array<{ id: string; label: string }>; summary: Summary | null }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const at = summary ? sessions.findIndex((s) => s.id === summary.id) : -1
  const go = (id: string) => router.push(`/series/${seriesId}?s=${encodeURIComponent(id)}`)
  // Newest first: "earlier" is the next one down the list.
  const earlier = at >= 0 && at < sessions.length - 1 ? sessions[at + 1] : null
  const later = at > 0 ? sessions[at - 1] : null

  if (!summary) {
    return (
      <div className="blank">
        <h2>No session summary yet</h2>
      </div>
    )
  }

  return (
    <section className="tile ser-session">
      <div className="ser-sbar">
        <button type="button" className="btn" disabled={!earlier} onClick={() => earlier && go(earlier.id)} aria-label="Earlier session">
          ‹
        </button>
        <select className="ser-ssel" value={summary.id} onChange={(e) => go(e.target.value)} aria-label="Session">
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn" disabled={!later} onClick={() => later && go(later.id)} aria-label="Later session">
          ›
        </button>
        <span className="ser-smeta">
          {summary.edited ? <span title={summary.editedBy ? `Edited by ${summary.editedBy}` : undefined}>Edited</span> : <span>By Yaara</span>}
          {summary.notesChanged ? <span className="ser-alert"> · notes changed since the edit</span> : null}
          {summary.documentUrl ? (
            <>
              {' · '}
              <a href={summary.documentUrl} target="_blank" rel="noreferrer">
                Notes
              </a>
            </>
          ) : null}
        </span>
        <button type="button" className="btn ser-sedit" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
      <div className="ser-summary">
        <MarkdownView text={summary.markdown} />
      </div>
      {editing ? <EditSummary seriesId={seriesId} summary={summary} onClose={() => setEditing(false)} /> : null}
    </section>
  )
}

function EditSummary({ seriesId, summary, onClose }: { seriesId: string; summary: Summary; onClose: () => void }) {
  const router = useRouter()
  const [text, setText] = useState(summary.raw)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(markdown: string) {
    setBusy(true)
    const res = await saveSummaryEdit({ seriesId, summaryId: summary.id, markdown }).catch(() => ({ error: 'That could not be saved.' }) as const)
    setBusy(false)
    if ('error' in res && res.error) return setError(res.error)
    onClose()
    router.refresh()
  }
  return (
    <Modal title={`Edit summary · ${summary.label}`} onClose={onClose}>
      <div className="ser-form">
        <textarea id="summary-text" className="ser-stext" value={text} onChange={(e) => setText(e.target.value)} aria-label="Summary" />
        <div className="ser-actions">
          {error ? (
            <span className="mr-said mr-bad" role="alert">
              {error}
            </span>
          ) : summary.edited ? (
            <button type="button" className="linkish" onClick={() => save('')} disabled={busy}>
              Put Yaara&apos;s back
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={() => save(text)} disabled={busy || !text.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
