/**
 * The decisions register.
 *
 * This is the screen a program review actually runs on: not what is being
 * built, but what is stuck and who owes the answer. No upstream tool holds it,
 * so everything here is typed in this app.
 */
import { Suspense } from 'react'
import {
  Card,
  CardHeading,
  Chip,
  Empty,
  GapFlag,
  Kicker,
  Muted,
  Pill,
  SectionNote,
  Stat,
  type Tone,
} from '@/components/ui'
import { DECISION_CATEGORY, DECISION_STATUS, label, type DecisionStatus } from '@/lib/domain'
import { getPortfolio, labelForEndpoint, type DecisionRow, type Portfolio } from '@/lib/portfolio'
import { DecisionFilters, type FilterOption } from './filters'

// This page reads the live portfolio; prerendering it would serve stale data.
export const dynamic = 'force-dynamic'

const STATUS_COLOR: Record<DecisionStatus, string> = {
  open: 'var(--red)',
  watch: 'var(--amber)',
  decided: 'var(--green)',
  dropped: 'var(--slate)',
}

const STATUS_TONE: Record<DecisionStatus, Tone> = {
  open: 'red',
  watch: 'amber',
  decided: 'green',
  dropped: 'slate',
}

const CATEGORY_TONE: Record<string, Tone> = {
  strategic: 'violet',
  delivery: 'blue',
  risk: 'amber',
}

/** Open first, then watch, then decided, then dropped; contested first inside. */
const STATUS_RANK: Record<string, number> = { open: 0, watch: 1, decided: 2, dropped: 3 }

function rank(d: DecisionRow) {
  return STATUS_RANK[d.status] ?? 99
}

function isStatus(v: string): v is DecisionStatus {
  return (DECISION_STATUS as readonly string[]).includes(v)
}

function ownerOf(d: DecisionRow, people: Portfolio['people']): string | null {
  // `ownerId` is a real Person; `ownerText` carries the owners who will never be
  // one — execs, vendors, "Rick / SLT". Both are legitimate answers to "who".
  const person = d.ownerId ? people.find((p) => p.id === d.ownerId) : null
  return person?.name ?? d.ownerText ?? null
}

function DecisionCard({ d, p }: { d: DecisionRow; p: Portfolio }) {
  const status = isStatus(d.status) ? d.status : 'open'
  const owner = ownerOf(d, p.people)
  const linked =
    d.entityType && d.entityId ? labelForEndpoint(p, d.entityType, d.entityId) : null

  // "Overdue" is the one free-text due value that means something the UI can
  // act on, so it is the one special case. Everything else renders as typed.
  const overdue = (d.dueBy ?? '').trim().toLowerCase() === 'overdue'

  return (
    <Card
      className={`border-l-4 ${d.leadVisible ? '' : 'full-only'}`}
      style={{ borderLeftColor: STATUS_COLOR[status] }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--brand-2)' }}>
          {d.ref}
        </span>
        <Pill tone={STATUS_TONE[status]}>{label('decisionStatus', d.status)}</Pill>
        <Chip tone={CATEGORY_TONE[d.category] ?? 'slate'}>{d.category}</Chip>
        {linked ? (
          <Chip tone="accent" title={`Linked ${d.entityType}`}>
            {d.entityType} · {linked}
          </Chip>
        ) : null}
        {d.contested ? (
          <GapFlag title="Two named parties actively disagree. This does not resolve itself.">
            contested
          </GapFlag>
        ) : null}
      </div>

      <h3 className="m-0 text-[14.5px] font-semibold leading-snug tracking-[-0.01em]">{d.title}</h3>

      {d.contested ? (
        <div
          className="tone-red mt-2 rounded-md border px-3 py-1.5 text-[11.5px] font-semibold"
          style={{ borderColor: 'currentColor' }}
        >
          Contested — two named parties actively disagree. Someone has to choose.
        </div>
      ) : null}

      <p className="m-0 mt-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink)' }}>
        {d.body}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span>
          <Muted>Owner</Muted>{' '}
          {owner ? (
            <span className="font-semibold">{owner}</span>
          ) : (
            <GapFlag title="Nobody is named on this decision.">no owner</GapFlag>
          )}
        </span>
        {d.dueBy ? (
          <span>
            <Muted>Due</Muted>{' '}
            {overdue ? (
              <Pill tone="red">{d.dueBy}</Pill>
            ) : (
              <span className="font-semibold">{d.dueBy}</span>
            )}
          </span>
        ) : null}
      </div>

      {d.nextAction ? (
        <div
          className="mt-2.5 rounded-md border-l-[3px] px-3 py-2 text-[12.5px]"
          style={{
            background: 'var(--raised)',
            borderColor: 'var(--line)',
            borderLeftColor: 'var(--brand-2)',
          }}
        >
          <div
            className="text-[10px] font-bold uppercase tracking-[0.06em]"
            style={{ color: 'var(--brand-2)' }}
          >
            Next action
          </div>
          <div className="mt-0.5">{d.nextAction}</div>
        </div>
      ) : null}

      {d.evidence ? (
        <div className="full-only mt-2">
          <Muted>Source: {d.evidence}</Muted>
        </div>
      ) : null}
    </Card>
  )
}

export default async function DecisionsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const [p, sp] = await Promise.all([getPortfolio(), searchParams])

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const status = one(sp.status) ?? 'all'
  const category = one(sp.category) ?? 'all'

  const all = p.decisions
  const visible = all
    .filter((d) => (status === 'all' ? true : d.status === status))
    .filter((d) => (category === 'all' ? true : d.category === category))
    .sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      if (a.contested !== b.contested) return a.contested ? -1 : 1
      return a.ref.localeCompare(b.ref)
    })

  // Counts are computed against the other axis so the numbers on the buttons
  // describe what a click would actually show, not the unfiltered totals.
  const statusOptions: FilterOption[] = [
    {
      value: 'all',
      label: 'All',
      count: all.filter((d) => category === 'all' || d.category === category).length,
    },
    ...DECISION_STATUS.map((s) => ({
      value: s,
      label: label('decisionStatus', s),
      count: all.filter((d) => d.status === s && (category === 'all' || d.category === category))
        .length,
    })),
  ]
  const categoryOptions: FilterOption[] = [
    {
      value: 'all',
      label: 'All',
      count: all.filter((d) => status === 'all' || d.status === status).length,
    },
    ...DECISION_CATEGORY.map((c) => ({
      value: c,
      label: c,
      count: all.filter((d) => d.category === c && (status === 'all' || d.status === status)).length,
    })),
  ]

  const open = all.filter((d) => d.status === 'open')
  const contested = all.filter((d) => d.contested && d.status !== 'decided' && d.status !== 'dropped')
  const unowned = all.filter(
    (d) => !d.ownerId && !d.ownerText && d.status !== 'decided' && d.status !== 'dropped',
  )

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Kicker>Decisions register</Kicker>
        <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">
          What is stuck, who owes the answer, and by when
        </h2>
        <p className="m-0 mt-1 max-w-[760px] text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Open items sort first, and a contested item sorts above the rest of its group —
          contested means two named parties actively disagree, which is the one state that never
          resolves by waiting.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={open.length} label={label('decisionStatus', 'open')} tone="red" />
        <Stat value={contested.length} label="Contested and unresolved" tone="amber" />
        <Stat value={unowned.length} label="No owner named" tone={unowned.length ? 'amber' : 'green'} />
        <Stat value={all.length} label="In the register" />
      </div>

      <Card>
        <Suspense fallback={<Muted>Loading filters…</Muted>}>
          <DecisionFilters statuses={statusOptions} categories={categoryOptions} />
        </Suspense>
      </Card>

      {contested.length > 0 && status === 'all' && category === 'all' ? (
        <SectionNote tone="red">
          {contested.length} contested {contested.length === 1 ? 'item is' : 'items are'} still
          open. Each one has two named parties on opposite sides; none of them close without
          somebody deciding.
        </SectionNote>
      ) : null}

      {visible.length === 0 ? (
        <Empty>Nothing in the register matches this filter.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visible.map((d) => (
            <DecisionCard key={d.id} d={d} p={p} />
          ))}
        </div>
      )}

      <Card>
        <CardHeading
          title="How to read this register"
          sub="Left border colour is the status; the next-action block is the only part anyone is expected to do something about."
        />
        <div className="flex flex-wrap gap-2">
          {DECISION_STATUS.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-1 rounded-sm"
                style={{ background: STATUS_COLOR[s] }}
              />
              <Muted>{label('decisionStatus', s)}</Muted>
            </span>
          ))}
        </div>
      </Card>
    </div>
  )
}
