'use client'

/**
 * The ranked list, with the capacity cut line drawn through it.
 *
 * Ranking, the running effort total and the position of the cut line are all
 * computed here from the scores currently on screen rather than being baked
 * server-side, so editing a cell in a prioritization meeting re-orders the list
 * and moves the line in front of the room instead of after a page reload.
 */
import { Fragment, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LABELS, TSHIRT_WEEKS, computeScore, type Tshirt } from '@/lib/domain'
import { Chip, Empty, Muted, Pill, SectionNote } from '@/components/ui'

export interface CriterionCell {
  id: string
  key: string
  label: string
  helpText: string | null
  weight: number
  direction: string
  scaleMin: number
  scaleMax: number
}

export interface RankRow {
  id: string
  ref: string
  title: string
  theme: string | null
  status: string
  tshirt: Tshirt | null
  /** criterionId → value, as stored. Local edits sit on top of this. */
  values: Record<string, number>
}

type Overlay = Record<string, Record<string, number | null>>

function options(c: CriterionCell): number[] {
  const min = Math.round(c.scaleMin)
  const max = Math.round(c.scaleMax)
  const out: number[] = []
  for (let n = min; n <= max; n++) out.push(n)
  return out
}

export function RankedTable({
  rows,
  criteria,
  capacityUnits,
  capacityLabel,
}: {
  rows: RankRow[]
  criteria: CriterionCell[]
  capacityUnits: number | null
  capacityLabel: string
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  // Local edits are kept as an overlay rather than replacing the server values,
  // so a refresh that brings in someone else's edit does not wipe the cell the
  // person in front of this screen just changed.
  const [overlay, setOverlay] = useState<Overlay>({})
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  async function setCell(requestId: string, criterion: CriterionCell, raw: string) {
    const value = raw === '' ? null : Number(raw)
    const cell = `${requestId}:${criterion.id}`

    setOverlay((o) => ({ ...o, [requestId]: { ...(o[requestId] ?? {}), [criterion.id]: value } }))
    setSaving((s) => new Set(s).add(cell))
    setError(null)

    try {
      const res = await fetch('/api/scores', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId, criterionId: criterion.id, value }),
      })
      const body: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        const message =
          body && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : `Save failed (${res.status})`
        throw new Error(message)
      }
      // Echo back what was actually stored — the server clamps to the
      // criterion's scale, and showing the unclamped value would be a lie.
      const stored =
        body && typeof body === 'object' && 'value' in body
          ? ((body as { value: number | null }).value ?? null)
          : value
      setOverlay((o) => ({ ...o, [requestId]: { ...(o[requestId] ?? {}), [criterion.id]: stored } }))
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      // Drop the optimistic value so the grid stops showing an unsaved number.
      setOverlay((o) => {
        const next = { ...(o[requestId] ?? {}) }
        delete next[criterion.id]
        return { ...o, [requestId]: next }
      })
    } finally {
      setSaving((s) => {
        const next = new Set(s)
        next.delete(cell)
        return next
      })
    }
  }

  const scored = rows.map((row) => {
    const values: Record<string, number | undefined> = { ...row.values }
    for (const [criterionId, v] of Object.entries(overlay[row.id] ?? {})) {
      if (v === null) delete values[criterionId]
      else values[criterionId] = v
    }
    return { row, values, result: computeScore(criteria, values) }
  })

  scored.sort((a, b) => {
    // Unscored requests go last rather than to the bottom on a score of zero:
    // "nobody has looked at it" is not the same claim as "it is worthless".
    const as = a.result.score
    const bs = b.result.score
    if (as === null && bs === null) return a.row.ref.localeCompare(b.row.ref)
    if (as === null) return 1
    if (bs === null) return -1
    if (as !== bs) return bs - as
    return a.row.ref.localeCompare(b.row.ref)
  })

  type Ranked = (typeof scored)[number] & {
    rank: number
    weeks: number | null
    cumulative: number
  }
  const ranked: Ranked[] = []
  let running = 0
  for (let i = 0; i < scored.length; i++) {
    const weeks = scored[i].row.tshirt ? TSHIRT_WEEKS[scored[i].row.tshirt as Tshirt] : null
    running += weeks ?? 0
    ranked.push({ ...scored[i], rank: i + 1, weeks, cumulative: running })
  }

  const cutIndex =
    capacityUnits === null ? -1 : ranked.findIndex((r) => r.cumulative > capacityUnits)
  const belowCount = cutIndex < 0 ? 0 : ranked.length - cutIndex
  const unsizedAbove = ranked
    .slice(0, cutIndex < 0 ? ranked.length : cutIndex)
    .filter((r) => r.weeks === null).length

  const cols = criteria.length + 7

  if (rows.length === 0) {
    return <Empty>Nothing is in scoring, ranked or approved, so there is no list to rank.</Empty>
  }

  return (
    <div className="grid gap-2">
      {error ? <SectionNote tone="red">{error}</SectionNote> : null}
      {unsizedAbove > 0 ? (
        <SectionNote tone="amber">
          {unsizedAbove} request{unsizedAbove === 1 ? '' : 's'} above the line {unsizedAbove === 1 ? 'has' : 'have'} no
          t-shirt size, so {unsizedAbove === 1 ? 'it adds' : 'they add'} nothing to the running
          total. The line is therefore optimistic — the real one sits higher.
        </SectionNote>
      ) : null}
      {capacityUnits === null ? (
        <SectionNote tone="amber">
          No capacity is set on the model, so there is no cut line. A ranked list with no line is a
          wish list.
        </SectionNote>
      ) : null}

      <div className="scroll-x">
        <table className="grid">
          <thead>
            <tr>
              <th className="whitespace-nowrap">#</th>
              <th className="whitespace-nowrap">Ref</th>
              <th>Request</th>
              <th className="whitespace-nowrap">Theme</th>
              {criteria.map((c) => (
                <th
                  key={c.id}
                  className="whitespace-nowrap text-center"
                  title={[
                    c.label,
                    c.helpText,
                    `Weight ${c.weight} · ${c.direction === 'cost' ? 'cost — higher pushes it down' : 'benefit — higher pulls it up'}`,
                  ]
                    .filter(Boolean)
                    .join('\n')}
                >
                  {c.label}
                  <span className="ml-1 font-normal" style={{ color: 'var(--muted)' }}>
                    ×{c.weight}
                    {c.direction === 'cost' ? ' ↓' : ''}
                  </span>
                </th>
              ))}
              <th className="whitespace-nowrap">Score</th>
              <th className="whitespace-nowrap">Size</th>
              <th className="whitespace-nowrap" title={`Running total of ${capacityLabel}`}>
                Cum. {capacityLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, ix) => {
              const below = cutIndex >= 0 && ix >= cutIndex
              const partial = r.result.scored > 0 && r.result.scored < r.result.total
              const row = (
                <tr>
                  <Cells
                    r={r}
                    below={below}
                    partial={partial}
                    criteria={criteria}
                    saving={saving}
                    onSet={setCell}
                    capacityLabel={capacityLabel}
                  />
                </tr>
              )

              if (ix !== cutIndex) return <Fragment key={r.row.id}>{row}</Fragment>

              return (
                <Fragment key={r.row.id}>
                  <tr>
                    <td
                      colSpan={cols}
                      style={{
                        padding: 0,
                        borderTop: '2px dashed var(--red)',
                        background: 'color-mix(in srgb, var(--red) 10%, transparent)',
                      }}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-2.5 py-2">
                        <span
                          className="text-[11px] font-bold uppercase tracking-[0.06em]"
                          style={{ color: 'var(--red)' }}
                        >
                          Cut line — {capacityUnits} {capacityLabel} of capacity
                        </span>
                        <Muted>
                          {belowCount} request{belowCount === 1 ? '' : 's'} below the line. Nothing
                          here gets done this cycle unless something above it comes out.
                        </Muted>
                      </div>
                    </td>
                  </tr>
                  {row}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Cells({
  r,
  below,
  partial,
  criteria,
  saving,
  onSet,
  capacityLabel,
}: {
  r: {
    row: RankRow
    values: Record<string, number | undefined>
    result: { score: number | null; scored: number; total: number }
    rank: number
    weeks: number | null
    cumulative: number
  }
  below: boolean
  partial: boolean
  criteria: CriterionCell[]
  saving: Set<string>
  onSet: (requestId: string, criterion: CriterionCell, raw: string) => void
  capacityLabel: string
}) {
  // Below-the-line rows stay legible but stop competing for attention: they are
  // the answer to "what are we not doing", not the plan.
  const dim = below ? { opacity: 0.5 } : undefined

  return (
    <>
      <td style={dim} className="tabular-nums font-semibold">
        {r.rank}
      </td>
      <td style={dim}>
        <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--brand-2)' }}>
          {r.row.ref}
        </span>
      </td>
      <td style={dim} className="min-w-[220px]">
        <span className="font-semibold">{r.row.title}</span>
        <span className="ml-2">
          <Chip tone="slate">{LABELS.intakeStatus[r.row.status as keyof typeof LABELS.intakeStatus] ?? r.row.status}</Chip>
        </span>
      </td>
      <td style={dim} className="whitespace-nowrap">
        {r.row.theme ?? <Muted>—</Muted>}
      </td>

      {criteria.map((c) => {
        const cell = `${r.row.id}:${c.id}`
        const value = r.values[c.id]
        return (
          <td key={c.id} style={dim} className="text-center">
            <select
              aria-label={`${c.label} for ${r.row.ref}`}
              className="!w-auto !px-1.5 !py-0.5 text-center text-[11.5px] tabular-nums"
              style={saving.has(cell) ? { opacity: 0.5 } : undefined}
              value={value === undefined ? '' : String(value)}
              onChange={(e) => onSet(r.row.id, c, e.target.value)}
              title={c.helpText ?? c.label}
            >
              <option value="">—</option>
              {options(c).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </td>
        )
      })}

      <td style={dim} className="whitespace-nowrap">
        {r.result.score === null ? (
          <Chip tone="slate">not scored</Chip>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Pill tone={partial ? 'amber' : 'accent'}>{r.result.score.toFixed(1)}</Pill>
            {partial ? (
              <Chip
                tone="amber"
                title="Computed from the criteria that have values. Not comparable with a fully scored request — treat it as a placeholder, not a verdict."
              >
                {r.result.scored}/{r.result.total}
              </Chip>
            ) : null}
          </span>
        )}
      </td>

      <td style={dim} className="whitespace-nowrap">
        {r.row.tshirt ? (
          <Chip tone="slate" title={`About ${r.weeks} ${capacityLabel}`}>
            {LABELS.tshirt[r.row.tshirt]}
          </Chip>
        ) : (
          <Chip tone="violet" title="Unsized, so it adds nothing to the running total.">
            not sized
          </Chip>
        )}
      </td>

      <td style={dim} className="whitespace-nowrap tabular-nums">
        {r.cumulative}
      </td>
    </>
  )
}
