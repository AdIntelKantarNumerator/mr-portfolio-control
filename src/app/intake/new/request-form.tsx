'use client'

/**
 * The intake form.
 *
 * Client-side because it needs `useActionState` for field-level errors and a
 * pending state; the validation itself is the `intakeInput` zod schema running
 * on the server, so a request typed here and a request posted from Slack are
 * held to exactly the same standard.
 */
import { useActionState, useState } from 'react'
import Link from 'next/link'
import { LABELS, TSHIRT, TSHIRT_WEEKS } from '@/lib/domain'
import { Card, CardHeading, Chip, Muted, SectionNote } from '@/components/ui'
import { createRequest, type IntakeFormState } from '../actions'

export interface Option {
  id: string
  name: string
}

const INITIAL: IntakeFormState = { status: 'idle', errors: {}, message: null, values: {} }

const SOURCES = [
  { value: 'web', label: 'Web — typed into this form' },
  { value: 'slack', label: 'Slack — raised in a channel or DM' },
  { value: 'sheets', label: 'Sheets — came off a spreadsheet' },
  { value: 'email', label: 'Email — someone asked in a thread' },
] as const

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null
  return (
    <p className="m-0 mt-1 text-[11.5px] font-semibold" style={{ color: 'var(--red)' }}>
      {messages.join(' ')}
    </p>
  )
}

function Field({
  name,
  label,
  hint,
  errors,
  children,
}: {
  name: string
  label: string
  hint?: string
  errors: Record<string, string[]>
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={name}>{label}</label>
      {hint ? (
        <p className="m-0 mb-1 mt-0.5 text-[11.5px]" style={{ color: 'var(--muted)' }}>
          {hint}
        </p>
      ) : (
        <div className="h-1" />
      )}
      {children}
      <FieldError messages={errors[name]} />
    </div>
  )
}

export function RequestForm({
  themes,
  appAreas,
  initiatives,
}: {
  themes: Option[]
  appAreas: Option[]
  initiatives: Option[]
}) {
  const [state, formAction, pending] = useActionState(createRequest, INITIAL)

  // Every field is controlled off one object. React resets an uncontrolled
  // form once its action resolves, which on a rejected submit would throw away
  // everything the requester typed — the fastest way to teach people to stop
  // filing requests here.
  const [form, setForm] = useState<Record<string, string>>({})
  const [seenState, setSeenState] = useState(state)
  if (seenState !== state) {
    setSeenState(state)
    setForm(state.values)
  }

  const text = (name: string) => ({
    id: name,
    name,
    value: form[name] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [name]: e.target.value })),
  })

  const hardDate = form.hardDate === 'on'
  const costumedDate = hardDate && (form.hardDateReason ?? '').trim() === ''

  return (
    <form action={formAction} className="grid gap-4">
      {state.status === 'error' && state.message ? (
        <SectionNote tone="red">{state.message}</SectionNote>
      ) : null}
      <FieldError messages={state.errors._form} />

      <Card>
        <CardHeading
          title="What is the problem"
          sub="The problem, not the solution. A request that only describes a feature cannot be scored against anything."
        />
        <div className="grid gap-3">
          <Field name="title" label="Title" errors={state.errors}>
            <input {...text('title')} required />
          </Field>
          <Field
            name="problem"
            label="Problem"
            hint="Who is hurt by this today, and how do you know?"
            errors={state.errors}
          >
            <textarea {...text('problem')} rows={3} required />
          </Field>
          <Field
            name="outcome"
            label="Outcome if we do it"
            hint="Optional. What is true afterwards that is not true now?"
            errors={state.errors}
          >
            <textarea {...text('outcome')} rows={2} />
          </Field>
          <Field
            name="businessCase"
            label="Business case"
            hint="Optional. Revenue, retention, compliance, or the cost of leaving it alone."
            errors={state.errors}
          >
            <textarea {...text('businessCase')} rows={2} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeading
          title="Who is asking"
          sub="A request with no named sponsor evaporates the moment it competes with one that has a sponsor."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="requesterName" label="Requester" errors={state.errors}>
            <input {...text('requesterName')} required />
          </Field>
          <Field name="requesterEmail" label="Requester email" errors={state.errors}>
            <input {...text('requesterEmail')} type="email" />
          </Field>
          <Field
            name="sponsor"
            label="Sponsor"
            hint="Who defends this when it displaces something else?"
            errors={state.errors}
          >
            <input {...text('sponsor')} />
          </Field>
          <Field name="stakeholders" label="Stakeholders" errors={state.errors}>
            <input {...text('stakeholders')} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeading
          title="Where it lands"
          sub="Both taxonomies are optional — the program team re-routes in triage."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="themeId" label="Theme" errors={state.errors}>
            <select {...text('themeId')}>
              <option value="">Not sure</option>
              {themes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field name="appAreaId" label="Application area" errors={state.errors}>
            <select {...text('appAreaId')}>
              <option value="">Not sure</option>
              {appAreas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field name="proposedInitiativeId" label="Proposed initiative" errors={state.errors}>
            <select {...text('proposedInitiativeId')}>
              <option value="">None proposed</option>
              {initiatives.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeading
          title="Size and timing"
          sub="A rough size beats no size: unsized requests cannot be placed against the capacity cut line."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            name="tshirt"
            label="T-shirt size"
            hint="Rough engineer-weeks, not a commitment."
            errors={state.errors}
          >
            <select {...text('tshirt')}>
              <option value="">Not sized</option>
              {TSHIRT.map((t) => (
                <option key={t} value={t}>
                  {LABELS.tshirt[t]} — about {TSHIRT_WEEKS[t]} engineer-weeks
                </option>
              ))}
            </select>
          </Field>

          <Field name="desiredDate" label="Desired date" errors={state.errors}>
            <input {...text('desiredDate')} type="date" />
          </Field>

          <div className="min-w-0 sm:col-span-2">
            <label className="flex items-center gap-2" htmlFor="hardDate">
              <input
                id="hardDate"
                name="hardDate"
                type="checkbox"
                className="!w-auto"
                checked={hardDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, hardDate: e.target.checked ? 'on' : '' }))
                }
              />
              <span>This date is hard — something outside our control breaks if we miss it</span>
            </label>
          </div>

          <Field
            name="hardDateReason"
            label="Why is it hard"
            hint="Contract, regulator, board date, external launch. Name it."
            errors={state.errors}
          >
            <input
              {...text('hardDateReason')}
              disabled={!hardDate}
              placeholder={hardDate ? 'e.g. Named in the FY27 board deck' : '—'}
            />
          </Field>

          <div className="flex items-end pb-1">
            {costumedDate ? (
              <Chip
                tone="violet"
                title="A hard date with no reason is a preference wearing a costume. It is recorded either way, and flagged in the queue."
              >
                hard date, no reason given
              </Chip>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeading title="Provenance" sub="Where this request actually came from." />
        <Field name="source" label="Source" errors={state.errors}>
          <select {...text('source')} value={form.source ?? 'web'}>
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Saving…' : 'Raise request'}
        </button>
        <Link href="/intake" className="btn">
          Cancel
        </Link>
        <Muted>
          Lands in the queue as New. The reference is assigned on save, so two people filing at the
          same time cannot collide.
        </Muted>
      </div>
    </form>
  )
}
