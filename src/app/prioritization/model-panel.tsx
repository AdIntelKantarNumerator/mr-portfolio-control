'use client'

/**
 * The model, laid out so the room can argue with it.
 *
 * A ranked list is only as defensible as the weights behind it, and the usual
 * failure mode is that the weights live in a spreadsheet nobody opens while the
 * meeting argues about the output. Every weight is editable here, next to the
 * help text that says what the criterion is supposed to mean, so a disagreement
 * lands on the model rather than on the ordering it produced.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeading, Chip, Muted, SectionNote } from '@/components/ui'
import type { CriterionCell } from './ranked-table'

export function ModelPanel({
  modelId,
  modelName,
  description,
  criteria,
  capacityUnits,
  capacityLabel,
}: {
  modelId: string
  modelName: string
  description: string | null
  criteria: CriterionCell[]
  capacityUnits: number | null
  capacityLabel: string
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const totalWeight = criteria.reduce((sum, c) => sum + (Number(draft[c.id] ?? c.weight) || 0), 0)

  async function patch(key: string, body: unknown) {
    setBusy(key)
    setError(null)
    try {
      const res = await fetch('/api/scoring-model', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        const message =
          payload && typeof payload === 'object' && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : `Save failed (${res.status})`
        throw new Error(message)
      }
      // Clear the draft so the field goes back to reading from the server and a
      // change made elsewhere is not masked by a stale local edit.
      setDraft((d) => {
        const next = { ...d }
        delete next[key]
        return next
      })
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      // Drop the draft so the field falls back to what is actually stored.
      setDraft((d) => {
        const next = { ...d }
        delete next[key]
        return next
      })
    } finally {
      setBusy(null)
    }
  }

  function commitWeight(c: CriterionCell) {
    const raw = draft[c.id]
    if (raw === undefined) return
    const weight = Number(raw)
    if (!Number.isFinite(weight) || weight < 0) {
      setError(`"${c.label}" needs a weight of zero or more.`)
      setDraft((d) => {
        const next = { ...d }
        delete next[c.id]
        return next
      })
      return
    }
    if (weight === c.weight) return
    void patch(c.id, { target: 'criterion', criterionId: c.id, weight })
  }

  function commitCapacity() {
    const raw = draft.capacity
    if (raw === undefined) return
    const value = raw.trim() === '' ? null : Number(raw)
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setError('Capacity needs a number of zero or more, or nothing at all.')
      setDraft((d) => {
        const next = { ...d }
        delete next.capacity
        return next
      })
      return
    }
    if (value === capacityUnits) return
    void patch('capacity', { target: 'capacity', modelId, capacityUnits: value })
  }

  return (
    <Card>
      <CardHeading
        title={modelName}
        sub={description}
        right={
          <Chip tone="slate" title="Weights are relative; the score is normalised to 0–100.">
            total weight {Math.round(totalWeight * 10) / 10}
          </Chip>
        }
      />

      {error ? <SectionNote tone="red">{error}</SectionNote> : null}

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="capacity">Capacity this cycle</label>
          <div className="mt-0.5 flex items-center gap-2">
            <input
              id="capacity"
              type="number"
              min={0}
              step={1}
              className="!w-28 tabular-nums"
              value={draft.capacity ?? (capacityUnits === null ? '' : String(capacityUnits))}
              onChange={(e) => setDraft((d) => ({ ...d, capacity: e.target.value }))}
              onBlur={commitCapacity}
              disabled={busy === 'capacity'}
            />
            <Muted>{capacityLabel} — this is what draws the cut line</Muted>
          </div>
        </div>
      </div>

      <div className="scroll-x">
        <table className="grid">
          <thead>
            <tr>
              <th>Criterion</th>
              <th className="whitespace-nowrap">Weight</th>
              <th className="whitespace-nowrap">Direction</th>
              <th>What it means</th>
            </tr>
          </thead>
          <tbody>
            {criteria.map((c) => (
              <tr key={c.id}>
                <td className="whitespace-nowrap font-semibold">{c.label}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    aria-label={`Weight for ${c.label}`}
                    className="!w-20 !px-1.5 !py-0.5 text-[11.5px] tabular-nums"
                    style={busy === c.id ? { opacity: 0.5 } : undefined}
                    value={draft[c.id] ?? String(c.weight)}
                    onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                    onBlur={() => commitWeight(c)}
                    disabled={busy === c.id}
                  />
                </td>
                <td className="whitespace-nowrap">
                  {c.direction === 'cost' ? (
                    <Chip tone="red" title="Higher scores push a request down the list.">
                      cost ↓
                    </Chip>
                  ) : (
                    <Chip tone="green" title="Higher scores pull a request up the list.">
                      benefit ↑
                    </Chip>
                  )}
                </td>
                <td style={{ color: 'var(--muted)' }}>
                  {c.helpText ?? <span>No definition written down — so it means whatever the loudest person says it means.</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="m-0 mt-2 text-[11.5px]" style={{ color: 'var(--muted)' }}>
        Scores are normalised per criterion, so changing a weight re-ranks the list but never
        rescales an individual judgement. Cost criteria contribute their inverse rather than
        dividing, which keeps the arithmetic arguable in a room.
      </p>
    </Card>
  )
}
