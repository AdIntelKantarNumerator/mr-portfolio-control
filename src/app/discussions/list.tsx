'use client'

/**
 * Active recurring topics, each correctable.
 *
 * WHY THE EDIT IS OFFERED HERE
 *
 * A topic is attached to a piece of work by guessing from the text of a
 * meeting note, and some of those guesses land on the wrong thing. The reader
 * who can tell is the one looking at the row — and before this, the next pass
 * would rewrite the summary and re-attach it to the same wrong work, so there
 * was nothing to do but learn to distrust the tags.
 *
 * WHY AN EDITED ROW SAYS SO
 *
 * A line read off a document and a line a person corrected have different
 * authority, and a reader deciding whether to act on one needs to know which
 * it is. It also stops the next sync overwriting the correction — see
 * discussions/actions.ts.
 */
import { useState } from 'react'
import Link from 'next/link'
import { editTopic, type TopicState } from './actions'

export interface TopicRow {
  id: string
  theme: string
  summary: string
  mentions: number
  lastMeeting: string | null
  at: string
  where: string | null
  href: string | null
  editedBy: string | null
  editedAt: string | null
}

export interface Named {
  id: string
  name: string
}

export function DiscussionsList({
  topics,
  initiatives,
  projects,
  workstreams,
}: {
  topics: TopicRow[]
  initiatives: Named[]
  projects: Named[]
  workstreams: Named[]
}) {
  const [editing, setEditing] = useState<TopicRow | null>(null)

  if (topics.length === 0) {
    return (
      <p className="tile-empty">
        Nothing recurring yet. These are read out of shared documents — if meetings are happening and nothing is
        here, check whether Yaara has the notes.
      </p>
    )
  }

  return (
    <>
      <ul className="disc">
        {topics.map((t) => (
          <li key={t.id}>
            <div className="disc-head">
              <b>{t.theme}</b>
              {t.where ? (
                t.href ? (
                  <Link className="disc-at" href={t.href}>
                    {t.where}
                  </Link>
                ) : (
                  <span className="disc-at">{t.where}</span>
                )
              ) : (
                <span className="disc-at disc-none">not tagged</span>
              )}
              <button
                type="button"
                className="disc-edit"
                onClick={() => setEditing(t)}
                title="Correct the work this is about, or the text"
                aria-label={`Edit ${t.theme}`}
              >
                ✎
              </button>
              <em>
                {t.mentions === 1 ? 'mentioned once' : `${t.mentions} mentions`}
                {t.lastMeeting ? ` · last in ${t.lastMeeting}` : ''}
              </em>
            </div>
            {t.summary ? <p>{t.summary}</p> : null}
            {t.editedBy ? (
              <p className="disc-edited">
                Edited by {t.editedBy}
                {t.editedAt ? ` on ${t.editedAt}` : ''}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {editing && (
        <EditDialog
          topic={editing}
          initiatives={initiatives}
          projects={projects}
          workstreams={workstreams}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function EditDialog({
  topic,
  initiatives,
  projects,
  workstreams,
  onClose,
}: {
  topic: TopicRow
  initiatives: Named[]
  projects: Named[]
  workstreams: Named[]
  onClose: () => void
}) {
  const [state, setState] = useState<TopicState>({})
  const [busy, setBusy] = useState(false)

  async function submit(form: FormData) {
    setBusy(true)
    const res = await editTopic({
      id: topic.id,
      at: String(form.get('at') ?? ''),
      theme: String(form.get('theme') ?? ''),
      summary: String(form.get('summary') ?? ''),
    }).catch((): TopicState => ({ error: 'That could not be saved.' }))
    setBusy(false)
    setState(res)
    if (res.ok) onClose()
  }

  const current =
    topic.href?.startsWith('/initiatives/')
      ? `initiative:${topic.href.split('/').pop()}`
      : topic.href?.startsWith('/projects/')
        ? `project:${topic.href.split('/').pop()}`
        : topic.href?.startsWith('/workstreams/')
          ? `workstream:${topic.href.split('/').pop()}`
          : ''

  return (
    <div className="modal-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Edit topic">
        <div className="modal-head">
          <h3>Edit topic</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form action={submit}>
          <label className="mr-label" htmlFor="dt-at">
            This is about
          </label>
          <select id="dt-at" name="at" defaultValue={current}>
            <option value="">— nothing in particular —</option>
            <optgroup label="Initiatives">
              {initiatives.map((o) => (
                <option key={o.id} value={`initiative:${o.id}`}>
                  {o.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Projects">
              {projects.map((o) => (
                <option key={o.id} value={`project:${o.id}`}>
                  {o.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Workstreams">
              {workstreams.map((o) => (
                <option key={o.id} value={`workstream:${o.id}`}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          </select>

          <label className="mr-label" htmlFor="dt-theme">
            Topic
          </label>
          <input id="dt-theme" name="theme" defaultValue={topic.theme} required />

          <label className="mr-label" htmlFor="dt-summary">
            What keeps being said
          </label>
          <textarea id="dt-summary" name="summary" rows={4} defaultValue={topic.summary} />

          <div className="mr-row">
            <button type="submit" className="mr-go" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {state.error ? <span className="mr-said mr-bad">{state.error}</span> : null}
            <span className="mr-hint">
              A corrected topic says so on the page, and the next sync leaves what you changed alone.
            </span>
          </div>
        </form>
      </div>
    </div>
  )
}
