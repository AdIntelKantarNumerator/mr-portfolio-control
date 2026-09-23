'use client'

import { useActionState, useState } from 'react'
import { createDependency, type ActionState } from './actions'

export interface EndpointOption {
  value: string
  label: string
  group: string
}

/**
 * Manual dependency entry.
 *
 * The external option exists because the dependencies that actually break a
 * plan are usually the ones with no record in any tracker — a vendor's data
 * feed, another org's deliverable, one person's capacity. Forcing every
 * endpoint to be a known project would quietly drop exactly those.
 */
export function DependencyForm({ options }: { options: EndpointOption[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createDependency, {})
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const groups = [...new Set(options.map((o) => o.group))]

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="dep-from">Blocker — what has to be true first</label>
        <select id="dep-from" name="from" value={from} onChange={(e) => setFrom(e.target.value)} required>
          <option value="">Select…</option>
          <option value="__external__">Something outside the portfolio…</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {options
                .filter((o) => o.group === g)
                .map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {from === '__external__' ? (
          <input
            name="fromExternal"
            placeholder="e.g. a vendor data feed"
            className="mt-1.5"
            required
          />
        ) : null}
        {state.fieldErrors?.from ? <FieldError>{state.fieldErrors.from}</FieldError> : null}
      </div>

      <div>
        <label htmlFor="dep-to">Blocked — what waits on it</label>
        <select id="dep-to" name="to" value={to} onChange={(e) => setTo(e.target.value)} required>
          <option value="">Select…</option>
          <option value="__external__">Something outside the portfolio…</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {options
                .filter((o) => o.group === g)
                .map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {to === '__external__' ? (
          <input name="toExternal" placeholder="e.g. a partner launch" className="mt-1.5" required />
        ) : null}
        {state.fieldErrors?.to ? <FieldError>{state.fieldErrors.to}</FieldError> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 sm:col-span-2">
        <div>
          <label htmlFor="dep-kind">Kind</label>
          <select id="dep-kind" name="kind" defaultValue="blocks">
            <option value="blocks">Blocks</option>
            <option value="informs">Informs</option>
            <option value="shares_resource">Shares people</option>
            <option value="related">Related</option>
          </select>
        </div>
        <div>
          <label htmlFor="dep-status">Status</label>
          <select id="dep-status" name="status" defaultValue="open">
            <option value="open">Open</option>
            <option value="at_risk">At risk</option>
            <option value="resolved">Resolved</option>
            <option value="accepted_risk">Accepted risk</option>
          </select>
        </div>
        <div>
          <label htmlFor="dep-crit">Criticality</label>
          <select id="dep-crit" name="criticality" defaultValue="normal">
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="dep-due">Needed by</label>
        <input id="dep-due" type="date" name="dueDate" />
      </div>

      <div>
        <label htmlFor="dep-desc">What exactly is needed</label>
        <input id="dep-desc" name="description" placeholder="Sample data landing in the ingestion pipeline" />
      </div>

      <div className="sm:col-span-2 flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add dependency'}
        </button>
        {state.ok ? (
          <span className="text-[12px]" style={{ color: 'var(--green)' }}>
            Added.
          </span>
        ) : null}
        {state.error ? <FieldError>{state.error}</FieldError> : null}
      </div>
    </form>
  )
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 mt-1 text-[11.5px]" style={{ color: 'var(--red)' }}>
      {children}
    </p>
  )
}
