'use client'

import { useActionState, useState } from 'react'
import { SOURCE_KIND, TRANSCRIPT_KIND, label } from '@/lib/domain'
import {
  addSource,
  addTranscript,
  regenerateBrief,
  removeSource,
  removeTranscript,
  setIngestEnabled,
  type ActionState,
} from './actions'

export interface EntityOption {
  value: string
  label: string
}

export interface SourceOption {
  id: string
  label: string
  entity: string
}

const field =
  'w-full rounded-md border px-2.5 py-1.5 text-[12.5px] bg-[var(--surface)] border-[var(--line)]'
const labelCls = 'text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]'

function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className="tone-red m-0 mt-2 rounded-md px-2.5 py-1.5 text-[12px]" role="alert">
        {state.error}
      </p>
    )
  }
  if (state.note) {
    return (
      <p className="tone-blue m-0 mt-2 rounded-md px-2.5 py-1.5 text-[12px]" role="status">
        {state.note}
      </p>
    )
  }
  if (state.ok) {
    return (
      <p className="tone-green m-0 mt-2 rounded-md px-2.5 py-1.5 text-[12px]" role="status">
        Saved.
      </p>
    )
  }
  return null
}

export function AddSourceForm({ entities }: { entities: EntityOption[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addSource, {})
  const [kind, setKind] = useState<string>('slack_channel')

  const hint =
    kind === 'slack_channel'
      ? 'The channel ID (starts with C), from Slack → channel → About → bottom of the panel.'
      : kind === 'meeting_series'
        ? 'The Google Calendar event ID of the recurring meeting — not the meet.google.com link, which identifies a room and grants no access.'
        : kind === 'github_repo'
          ? 'owner/name, exactly as it appears in the GitHub URL — e.g. AdIntelKantarNumerator/clickhouse-serving.'
          : kind === 'azure_repo'
            ? 'organisation/project/repository, as in the Azure DevOps URL.'
            : kind === 'bitbucket_repo'
              ? 'workspace/repository, as in the Bitbucket URL.'
              : 'Optional. Anything that identifies the document to you.'

  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className={labelCls} htmlFor="src-entity">
          Belongs to
        </label>
        <select id="src-entity" name="entity" className={field} required>
          <option value="">Choose…</option>
          {entities.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls} htmlFor="src-kind">
          Kind
        </label>
        <select
          id="src-kind"
          name="kind"
          className={field}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {SOURCE_KIND.map((k) => (
            <option key={k} value={k}>
              {label('sourceKind', k)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls} htmlFor="src-label">
          Label
        </label>
        <input
          id="src-label"
          name="label"
          className={field}
          placeholder="#360-migration"
          required
        />
        {state.fieldErrors?.label ? (
          <p className="m-0 mt-1 text-[11px] text-[var(--red)]">{state.fieldErrors.label}</p>
        ) : null}
      </div>

      <div>
        <label className={labelCls} htmlFor="src-external">
          External ID
        </label>
        <input id="src-external" name="externalId" className={field} />
        <p className="m-0 mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
          {hint}
        </p>
      </div>

      <div className="sm:col-span-2">
        <label className={labelCls} htmlFor="src-url">
          Link
        </label>
        <input id="src-url" name="url" className={field} placeholder="https://…" />
      </div>

      <div className="sm:col-span-2">
        <label className={labelCls} htmlFor="src-notes">
          Why this is attached
        </label>
        <input
          id="src-notes"
          name="notes"
          className={field}
          placeholder="Where the delivery decisions for this actually get made"
        />
      </div>

      <div
        className="sm:col-span-2 rounded-md border p-3"
        style={{ borderColor: 'var(--line)', background: 'var(--raised)' }}
      >
        <label className="flex items-start gap-2 text-[12.5px]">
          <input type="checkbox" name="ingestEnabled" className="mt-0.5" />
          <span>
            <strong>Allow this source to be read and summarised.</strong>
            <span className="mt-0.5 block text-[11.5px]" style={{ color: 'var(--muted)' }}>
              Leave this off and the link is recorded but nothing is ingested. Anyone with a
              company account can read this app, so a summary of a private conversation becomes
              company-wide readable. Turn it on only for material you would be comfortable
              posting in a public channel.
            </span>
          </span>
        </label>
      </div>

      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Attaching…' : 'Attach source'}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  )
}

export function AddTranscriptForm({
  entities,
  sources,
}: {
  entities: EntityOption[]
  sources: SourceOption[]
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addTranscript, {})
  const [entity, setEntity] = useState('')

  const matching = sources.filter((s) => s.entity === entity)

  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className={labelCls} htmlFor="t-entity">
          About
        </label>
        <select
          id="t-entity"
          name="entity"
          className={field}
          required
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
        >
          <option value="">Choose…</option>
          {entities.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls} htmlFor="t-kind">
          Kind
        </label>
        <select id="t-kind" name="kind" className={field} defaultValue="meeting">
          {TRANSCRIPT_KIND.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls} htmlFor="t-title">
          Title
        </label>
        <input
          id="t-title"
          name="title"
          className={field}
          placeholder="Weekly delivery review — 22 Sep"
          required
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="t-when">
          When it happened
        </label>
        <input id="t-when" name="occurredAt" type="date" className={field} />
      </div>

      <div>
        <label className={labelCls} htmlFor="t-url">
          Link to the original
        </label>
        <input id="t-url" name="url" className={field} placeholder="https://docs.google.com/…" />
      </div>

      <div>
        <label className={labelCls} htmlFor="t-source">
          Attach to a source
        </label>
        <select id="t-source" name="sourceId" className={field} disabled={matching.length === 0}>
          <option value="">{matching.length ? 'None' : 'No sources for this yet'}</option>
          {matching.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className={labelCls} htmlFor="t-body">
          Transcript or notes
        </label>
        <textarea
          id="t-body"
          name="body"
          className={`${field} min-h-[180px] font-mono text-[11.5px]`}
          placeholder="Paste the transcript here."
          required
        />
        {state.fieldErrors?.body ? (
          <p className="m-0 mt-1 text-[11px] text-[var(--red)]">{state.fieldErrors.body}</p>
        ) : null}
        <p className="m-0 mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
          Stored in full, so every bullet can be traced back to what was actually said. Do not
          paste material you would not want everyone with a company account to be able to read.
        </p>
      </div>

      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add conversation'}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  )
}

export function IngestToggle({
  sourceId,
  enabled,
  labelText,
}: {
  sourceId: string
  enabled: boolean
  labelText: string
}) {
  const [busy, setBusy] = useState(false)
  const [on, setOn] = useState(enabled)

  return (
    <button
      type="button"
      className={`btn ${on ? '' : 'btn-primary'}`}
      disabled={busy}
      title={
        on
          ? `Stop reading ${labelText}`
          : `Allow ${labelText} to be read and summarised`
      }
      onClick={async () => {
        setBusy(true)
        const next = !on
        const result = await setIngestEnabled(sourceId, next)
        if (!result.error) setOn(next)
        setBusy(false)
      }}
    >
      {busy ? '…' : on ? 'Ingestion on' : 'Ingestion off'}
    </button>
  )
}

export function DetachButton({ sourceId }: { sourceId: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await removeSource(sourceId)
        setBusy(false)
      }}
    >
      Detach
    </button>
  )
}

export function RemoveTranscriptButton({ transcriptId }: { transcriptId: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className="btn"
      disabled={busy}
      title="Delete this conversation and its text"
      onClick={async () => {
        setBusy(true)
        await removeTranscript(transcriptId)
        setBusy(false)
      }}
    >
      {busy ? '…' : 'Remove'}
    </button>
  )
}

export function GenerateBriefButton({
  entityType,
  entityId,
  disabled,
}: {
  entityType: string
  entityId: string
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true)
          setMessage(null)
          const result = await regenerateBrief(entityType, entityId)
          setFailed(Boolean(result.error))
          setMessage(result.error ?? result.note ?? 'Done.')
          setBusy(false)
        }}
      >
        {busy ? 'Summarising…' : 'Generate brief'}
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
    </span>
  )
}
