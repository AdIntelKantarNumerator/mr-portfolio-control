'use client'

import { useActionState, useState } from 'react'
import { SOURCE_KIND, label } from '@/lib/domain'
import type { SourceRow } from '@/lib/briefs'
import {
  addSource,
  addTranscript,
  regenerateBrief,
  removeSource,
  setIngestEnabled,
  type ActionState,
} from '@/app/sources/actions'

const field =
  'w-full rounded-md border px-2.5 py-1.5 text-[12.5px] bg-[var(--surface)] border-[var(--line)]'
const labelCls = 'text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]'

/**
 * Attach, switch on and remove the channels and meeting series feeding one
 * initiative, without leaving the initiative.
 *
 * The full Conversations screen still exists and does more. This exists because
 * "which channel is this coming from, and should it be?" is a question people
 * ask while looking at the initiative, and making them navigate away to answer
 * it is how the links stop getting maintained.
 */
export function InitiativeSources({
  entityValue,
  initiativeName,
  sources,
  transcriptCount,
}: {
  entityValue: string
  initiativeName: string
  sources: SourceRow[]
  transcriptCount: number
}) {
  const [open, setOpen] = useState<'none' | 'source' | 'transcript'>('none')
  const [entityType, entityId] = [
    entityValue.slice(0, entityValue.indexOf(':')),
    entityValue.slice(entityValue.indexOf(':') + 1),
  ]

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="text-[10px] font-bold uppercase tracking-[0.06em]"
          style={{ color: 'var(--muted)' }}
        >
          Connected sources
        </span>
        <button type="button" className="btn" onClick={() => setOpen(open === 'source' ? 'none' : 'source')}>
          {open === 'source' ? 'Cancel' : 'Connect a channel or meeting'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setOpen(open === 'transcript' ? 'none' : 'transcript')}
        >
          {open === 'transcript' ? 'Cancel' : 'Paste a transcript'}
        </button>
        <GenerateButton entityType={entityType} entityId={entityId} disabled={transcriptCount === 0} />
      </div>

      {sources.length === 0 ? (
        <p className="m-0 mt-2 text-[12px]" style={{ color: 'var(--muted)' }}>
          Nothing connected. A Slack channel or a recurring meeting attached here is what the
          brief above gets built from.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {sources.map((s) => (
            <SourceLine key={s.id} source={s} />
          ))}
        </div>
      )}

      {open === 'source' ? (
        <SourceForm entityValue={entityValue} onDone={() => setOpen('none')} />
      ) : null}
      {open === 'transcript' ? (
        <TranscriptForm
          entityValue={entityValue}
          initiativeName={initiativeName}
          sources={sources}
          onDone={() => setOpen('none')}
        />
      ) : null}
    </div>
  )
}

function SourceLine({ source }: { source: SourceRow }) {
  const [on, setOn] = useState(source.ingestEnabled)
  const [busy, setBusy] = useState(false)
  const [gone, setGone] = useState(false)

  if (gone) return null

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12.5px]"
      style={{ borderColor: 'var(--line)' }}
    >
      <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
        {label('sourceKind', source.kind)}
      </span>
      {source.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="font-semibold underline decoration-dotted underline-offset-2"
        >
          {source.label}
        </a>
      ) : (
        <span className="font-semibold">{source.label}</span>
      )}
      {source.externalId ? (
        <span className="font-mono text-[10.5px]" style={{ color: 'var(--muted)' }}>
          {source.externalId}
        </span>
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        {source.addedBy ? (
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {source.addedBy}
          </span>
        ) : null}
        <button
          type="button"
          className={`btn ${on ? '' : 'btn-primary'}`}
          disabled={busy}
          title={on ? 'Stop reading this source' : 'Allow this source to be read and summarised'}
          onClick={async () => {
            setBusy(true)
            const next = !on
            const r = await setIngestEnabled(source.id, next)
            if (!r.error) setOn(next)
            setBusy(false)
          }}
        >
          {busy ? '…' : on ? 'reading' : 'not reading'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await removeSource(source.id)
            setGone(true)
          }}
        >
          Remove
        </button>
      </span>
    </div>
  )
}

function SourceForm({ entityValue, onDone }: { entityValue: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addSource, {})
  const [kind, setKind] = useState('slack_channel')

  if (state.ok) setTimeout(onDone, 400)

  const hint =
    kind === 'slack_channel'
      ? 'Channel ID (starts with C) — Slack → channel → About, at the bottom.'
      : kind === 'meeting_series'
        ? 'Google Calendar event ID of the recurring meeting. Not the meet.google.com link: that identifies a room and grants no access to anything.'
        : 'Anything that identifies the document.'

  return (
    <form
      action={action}
      className="mt-3 grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2"
      style={{ borderColor: 'var(--line)', background: 'var(--raised)' }}
    >
      <input type="hidden" name="entity" value={entityValue} />

      <div>
        <label className={labelCls} htmlFor="ip-kind">Kind</label>
        <select id="ip-kind" name="kind" className={field} value={kind} onChange={(e) => setKind(e.target.value)}>
          {SOURCE_KIND.map((sk) => (
            <option key={sk} value={sk}>
              {label('sourceKind', sk)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls} htmlFor="ip-label">Label</label>
        <input id="ip-label" name="label" className={field} placeholder="#ratings-modernisation" required />
      </div>

      <div>
        <label className={labelCls} htmlFor="ip-ext">External ID</label>
        <input id="ip-ext" name="externalId" className={field} />
        <p className="m-0 mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>{hint}</p>
      </div>

      <div>
        <label className={labelCls} htmlFor="ip-url">Link</label>
        <input id="ip-url" name="url" className={field} placeholder="https://…" />
      </div>

      <div className="sm:col-span-2">
        <label className="flex items-start gap-2 text-[12px]">
          <input type="checkbox" name="ingestEnabled" className="mt-0.5" />
          <span>
            Allow this source to be read and summarised.
            <span className="mt-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>
              Off by default. Everyone with a company account can read this app, so anything
              summarised here is readable company-wide.
            </span>
          </span>
        </label>
      </div>

      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Connecting…' : 'Connect'}
        </button>
        {state.error ? (
          <span className="ml-2 text-[12px]" style={{ color: 'var(--red)' }}>
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  )
}

function TranscriptForm({
  entityValue,
  initiativeName,
  sources,
  onDone,
}: {
  entityValue: string
  initiativeName: string
  sources: SourceRow[]
  onDone: () => void
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addTranscript, {})

  if (state.ok) setTimeout(onDone, 600)

  return (
    <form
      action={action}
      className="mt-3 grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2"
      style={{ borderColor: 'var(--line)', background: 'var(--raised)' }}
    >
      <input type="hidden" name="entity" value={entityValue} />

      <div>
        <label className={labelCls} htmlFor="it-title">Title</label>
        <input
          id="it-title"
          name="title"
          className={field}
          defaultValue={`${initiativeName} — `}
          required
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="it-when">When</label>
        <input id="it-when" name="occurredAt" type="date" className={field} />
      </div>

      <div>
        <label className={labelCls} htmlFor="it-kind">Kind</label>
        <select id="it-kind" name="kind" className={field} defaultValue="meeting">
          <option value="meeting">meeting</option>
          <option value="slack">slack</option>
          <option value="document">document</option>
        </select>
      </div>

      <div>
        <label className={labelCls} htmlFor="it-src">From source</label>
        <select id="it-src" name="sourceId" className={field} disabled={sources.length === 0}>
          <option value="">{sources.length ? 'None' : 'No sources connected'}</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className={labelCls} htmlFor="it-body">Transcript</label>
        <textarea
          id="it-body"
          name="body"
          className={`${field} min-h-[150px] font-mono text-[11.5px]`}
          required
        />
      </div>

      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add'}
        </button>
        {state.error ? (
          <span className="ml-2 text-[12px]" style={{ color: 'var(--red)' }}>
            {state.error}
          </span>
        ) : null}
        {state.note ? (
          <span className="ml-2 text-[12px]" style={{ color: 'var(--muted)' }}>
            {state.note}
          </span>
        ) : null}
      </div>
    </form>
  )
}

function GenerateButton({
  entityType,
  entityId,
  disabled,
}: {
  entityType: string
  entityId: string
  disabled: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={busy || disabled}
        title={disabled ? 'Nothing has been attached to summarise yet.' : undefined}
        onClick={async () => {
          setBusy(true)
          setMessage(null)
          const r = await regenerateBrief(entityType, entityId)
          setFailed(Boolean(r.error))
          setMessage(r.error ?? r.note ?? 'Done.')
          setBusy(false)
        }}
      >
        {busy ? 'Summarising…' : 'Refresh brief'}
      </button>
      {message ? (
        <span
          className="text-[11.5px]"
          style={{ color: failed ? 'var(--red)' : 'var(--muted)' }}
          role="status"
        >
          {message}
        </span>
      ) : null}
    </>
  )
}
