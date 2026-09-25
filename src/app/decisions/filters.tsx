'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

export interface FilterOption {
  value: string
  label: string
  count: number
}

function Group({
  legend,
  param,
  options,
  active,
  onPick,
}: {
  legend: string
  param: string
  options: FilterOption[]
  active: string
  onPick: (param: string, value: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className="mr-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em]"
        style={{ color: 'var(--muted)' }}
      >
        {legend}
      </span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={legend}>
        {options.map((o) => {
          const on = o.value === active
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onPick(param, o.value)}
              aria-pressed={on}
              disabled={o.count === 0 && !on}
              className="rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors disabled:opacity-40"
              style={{
                background: on ? 'var(--brand)' : 'var(--surface)',
                color: on ? 'var(--surface)' : 'var(--muted)',
                borderColor: on ? 'var(--brand)' : 'var(--line)',
              }}
            >
              {o.label}
              <span className="ml-1.5 tabular-nums opacity-70">{o.count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Filter state lives in the URL rather than in component state so a filtered
 * register — "every contested delivery decision that is still open" — can be
 * pasted into a review agenda and open the same way for the next person.
 */
export interface EntityOption {
  value: string
  label: string
  count: number
}

/**
 * A select rather than chips, because this list is as long as the portfolio.
 * Twenty projects as buttons would push the filters that people use on every
 * visit — type and status — below the fold.
 */
function EntityPicker({
  options,
  active,
  onPick,
}: {
  options: EntityOption[]
  active: string
  onPick: (param: string, value: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className="mr-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em]"
        style={{ color: 'var(--muted)' }}
      >
        Work
      </span>
      <select
        value={active}
        onChange={(e) => onPick('entity', e.target.value)}
        aria-label="Filter by initiative or project"
        className="rounded-lg border px-2 py-1 text-[11.5px] font-semibold"
        style={{
          background: active === 'all' ? 'var(--surface)' : 'var(--brand)',
          color: active === 'all' ? 'var(--muted)' : 'var(--surface)',
          borderColor: active === 'all' ? 'var(--line)' : 'var(--brand)',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ color: 'var(--ink)', background: 'var(--surface)' }}>
            {o.label} ({o.count})
          </option>
        ))}
      </select>
    </div>
  )
}

export function DecisionFilters({
  kinds,
  statuses,
  categories,
  entities,
}: {
  kinds: FilterOption[]
  statuses: FilterOption[]
  categories: FilterOption[]
  entities: EntityOption[]
}) {
  const router = useRouter()
  const params = useSearchParams()

  const pick = useCallback(
    (param: string, value: string) => {
      const next = new URLSearchParams(params.toString())
      if (value === 'all') next.delete(param)
      else next.set(param, value)
      const qs = next.toString()
      // scroll:false — the cards below are the context for the click; jumping to
      // the top of the page on every filter change loses the reader's place.
      router.push(qs ? `/decisions?${qs}` : '/decisions', { scroll: false })
    },
    [params, router],
  )

  const kind = params.get('kind') ?? 'all'
  const status = params.get('status') ?? 'all'
  const category = params.get('category') ?? 'all'
  const entity = params.get('entity') ?? 'all'

  return (
    <div className="no-print flex flex-col gap-2">
      {/* First, because it is the coarsest cut: "what is stopping us" and "what
          do we have to choose" are two different meetings. */}
      <Group legend="Type" param="kind" options={kinds} active={kind} onPick={pick} />
      {/* Second, because "everything on my project" is the other way people
          arrive here — usually just before a review of exactly that project. */}
      <EntityPicker options={entities} active={entity} onPick={pick} />
      <Group legend="Status" param="status" options={statuses} active={status} onPick={pick} />
      <Group
        legend="Category"
        param="category"
        options={categories}
        active={category}
        onPick={pick}
      />
    </div>
  )
}
