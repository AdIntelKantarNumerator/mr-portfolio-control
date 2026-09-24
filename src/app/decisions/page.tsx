/**
 * The decisions and blockers register.
 *
 * This is the screen a program review actually runs on: not what is being
 * built, but what is stuck and who owes the answer.
 *
 * Decisions and blockers share it because they are the same object seen from
 * two ends — both open, both owned, both close — and because "what is stopping
 * us" and "what do we have to choose" are asked in the same breath. What a
 * blocker carries that a decision does not is WHO RAISED IT: the person who hit
 * the wall is usually not the person who can clear it, and a register that
 * conflates them assigns the problem to whoever happened to mention it.
 *
 * Rows typed by a person and rows an agent read out of a meeting both live
 * here, and the card says which is which. An agent's reading of a transcript is
 * a useful lead and not a fact somebody is accountable for, and a register
 * where the two are indistinguishable is one nobody should act on.
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
import {
  DECISION_CATEGORY,
  DECISION_KIND,
  DECISION_STATUS,
  label,
  type DecisionStatus,
} from '@/lib/domain'
import {
  getPortfolio,
  asOf,
  daysOpen,
  labelForEndpoint,
  recentThemes,
  type DecisionRow,
  type Portfolio,
} from '@/lib/portfolio'
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

function raiserOf(d: DecisionRow, people: Portfolio['people']): string | null {
  // Same two-column pattern as the owner, for the same reason: a name written
  // in a transcript that matches nobody on the roster is still the true answer
  // to "who raised this", and forcing it onto the nearest Person would be a
  // fabrication the reader has no way to catch.
  const person = d.raisedById ? people.find((p) => p.id === d.raisedById) : null
  return person?.name ?? d.raisedByText ?? null
}

/** A date somebody can say out loud: "12 Sep". */
function day(d: Date | string | null): string | null {
  if (!d) return null
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/**
 * Where and when it was raised, and where and when it closed.
 *
 * The meeting matters as much as the date. "Raised 12 Sep" invites the question
 * this line exists to pre-empt, and someone who wants to check has to go and
 * find which conversation it was.
 */
function Provenance({ d, now }: { d: DecisionRow; now: Date }) {
  const raised = day(d.raisedAt)
  const resolved = day(d.resolvedAt)
  if (!raised && !resolved) return null

  const openDays = daysOpen(d.raisedAt, d.resolvedAt, now)

  return (
    <div className="mt-2 flex flex-col gap-0.5 text-[11.5px]" style={{ color: 'var(--muted)' }}>
      {raised ? (
        <div>
          <span className="font-semibold" style={{ color: 'var(--ink)' }}>
            Raised
          </span>{' '}
          {raised}
          {d.raisedAtMeeting ? <> · {d.raisedAtMeeting}</> : null}
        </div>
      ) : null}
      {resolved ? (
        <div>
          <span className="font-semibold" style={{ color: 'var(--ink)' }}>
            Resolved
          </span>{' '}
          {resolved}
          {d.resolvedAtMeeting ? <> · {d.resolvedAtMeeting}</> : null}
        </div>
      ) : null}
      {openDays !== null && openDays > 0 ? (
        <div>
          {d.resolvedAt ? `${openDays} days from raised to resolved` : `open ${openDays} days`}
        </div>
      ) : null}
    </div>
  )
}

function DecisionCard({ d, p, now }: { d: DecisionRow; p: Portfolio; now: Date }) {
  const status = isStatus(d.status) ? d.status : 'open'
  const owner = ownerOf(d, p.people)
  const raiser = raiserOf(d, p.people)
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
        <Chip tone={d.kind === 'blocker' ? 'red' : 'slate'}>{label('decisionKind', d.kind)}</Chip>
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
        {/* Raised-by comes first on a blocker. The person who hit the wall is
            who you ask what actually happened, and on a blocker that is more
            often the useful call than the owner. */}
        {d.kind === 'blocker' ? (
          <span>
            <Muted>Raised by</Muted>{' '}
            {raiser ? (
              <span className="font-semibold">{raiser}</span>
            ) : (
              <GapFlag title="Nobody is recorded as having raised this, so there is no one to ask what it actually blocks.">
                not recorded
              </GapFlag>
            )}
          </span>
        ) : raiser ? (
          <span>
            <Muted>Raised by</Muted> <span className="font-semibold">{raiser}</span>
          </span>
        ) : null}
        <span>
          <Muted>{d.kind === 'blocker' ? 'Resolution owned by' : 'Owner'}</Muted>{' '}
          {owner ? (
            <span className="font-semibold">{owner}</span>
          ) : (
            <GapFlag
              title={
                d.kind === 'blocker'
                  ? 'Nobody owns clearing this. It is the most actionable row on the page.'
                  : 'Nobody is named on this decision.'
              }
            >
              no owner
            </GapFlag>
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

      <Provenance d={d} now={now} />

      {/* The same blocker comes up in three weekly meetings, and the useful
          record is one live item rather than three near-identical rows. This is
          where the three meetings go, in prose someone will actually read. */}
      {d.history ? (
        <div
          className="mt-2.5 rounded-md border-l-[3px] px-3 py-2 text-[12px] leading-relaxed"
          style={{ background: 'var(--raised)', borderColor: 'var(--line)' }}
        >
          <div
            className="text-[10px] font-bold uppercase tracking-[0.06em]"
            style={{ color: 'var(--muted)' }}
          >
            How it has gone
          </div>
          <div className="mt-0.5">{d.history}</div>
        </div>
      ) : null}

      {d.evidence ? (
        <div className="full-only mt-2">
          <Muted>Source: {d.evidence}</Muted>
        </div>
      ) : null}

      {/* Read out of a meeting by a machine, and nobody has checked it. Said on
          the card rather than in a footnote, because the whole value of this
          register is that people act on it. */}
      {d.authoredBy && !d.reviewedBy ? (
        <div className="mt-2">
          <GapFlag
            title={`Read out of a document by ${d.authoredBy}. No one has confirmed it.`}
          >
            {d.authoredBy} read this from a document — not reviewed
          </GapFlag>
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
  const [p, sp, themes, now] = await Promise.all([
    getPortfolio(),
    searchParams,
    recentThemes(),
    asOf(),
  ])

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const kind = one(sp.kind) ?? 'all'
  const status = one(sp.status) ?? 'all'
  const category = one(sp.category) ?? 'all'

  const all = p.decisions
  const visible = all
    .filter((d) => (kind === 'all' ? true : d.kind === kind))
    .filter((d) => (status === 'all' ? true : d.status === status))
    .filter((d) => (category === 'all' ? true : d.category === category))
    .sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      if (a.contested !== b.contested) return a.contested ? -1 : 1
      // Longest-standing first inside a group. A blocker raised in March
      // outranks one raised on Tuesday, and sorting by ref hid that entirely.
      const at = a.raisedAt ? new Date(a.raisedAt).getTime() : Infinity
      const bt = b.raisedAt ? new Date(b.raisedAt).getTime() : Infinity
      if (at !== bt) return at - bt
      return a.ref.localeCompare(b.ref)
    })

  // Counts are computed against the other axes so the numbers on the buttons
  // describe what a click would actually show, not the unfiltered totals.
  const matchesOthers = (d: DecisionRow, ignore: 'kind' | 'status' | 'category') =>
    (ignore === 'kind' || kind === 'all' || d.kind === kind) &&
    (ignore === 'status' || status === 'all' || d.status === status) &&
    (ignore === 'category' || category === 'all' || d.category === category)

  const kindOptions: FilterOption[] = [
    { value: 'all', label: 'All', count: all.filter((d) => matchesOthers(d, 'kind')).length },
    ...DECISION_KIND.map((k) => ({
      value: k,
      label: `${label('decisionKind', k)}s`,
      count: all.filter((d) => d.kind === k && matchesOthers(d, 'kind')).length,
    })),
  ]
  const statusOptions: FilterOption[] = [
    { value: 'all', label: 'All', count: all.filter((d) => matchesOthers(d, 'status')).length },
    ...DECISION_STATUS.map((s) => ({
      value: s,
      label: label('decisionStatus', s),
      count: all.filter((d) => d.status === s && matchesOthers(d, 'status')).length,
    })),
  ]
  const categoryOptions: FilterOption[] = [
    { value: 'all', label: 'All', count: all.filter((d) => matchesOthers(d, 'category')).length },
    ...DECISION_CATEGORY.map((c) => ({
      value: c,
      label: c,
      count: all.filter((d) => d.category === c && matchesOthers(d, 'category')).length,
    })),
  ]

  const live = (d: DecisionRow) => d.status !== 'decided' && d.status !== 'dropped'
  const openBlockers = all.filter((d) => d.kind === 'blocker' && live(d))
  const openDecisions = all.filter((d) => d.kind === 'decision' && d.status === 'open')
  const contested = all.filter((d) => d.contested && live(d))
  const unowned = all.filter((d) => !d.ownerId && !d.ownerText && live(d))

  // How long the oldest live blocker has been live. One number, and the one
  // that tends to start the conversation this page exists for.
  const oldest = openBlockers
    .map((d) => daysOpen(d.raisedAt, null, now) ?? 0)
    .reduce((max, days) => Math.max(max, days), 0)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Kicker>Decisions / Blockers</Kicker>
        <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">
          What is stuck, who raised it, who owes the answer, and by when
        </h2>
        <p className="m-0 mt-1 max-w-[760px] text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Open items sort first and a contested item sorts above the rest of its group — contested
          means two named parties actively disagree, which is the one state that never resolves by
          waiting. Within a group the longest-standing comes first, because that is usually the one
          worth asking about.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={openBlockers.length} label="Blockers still live" tone="red" />
        <Stat
          value={oldest}
          label={oldest ? 'Days, oldest live blocker' : 'Nothing blocked'}
          tone={oldest > 30 ? 'red' : oldest > 14 ? 'amber' : 'green'}
        />
        <Stat value={openDecisions.length} label="Decisions still open" tone="amber" />
        <Stat
          value={unowned.length}
          label="No owner named"
          tone={unowned.length ? 'amber' : 'green'}
        />
      </div>

      <Card>
        <Suspense fallback={<Muted>Loading filters…</Muted>}>
          <DecisionFilters
            kinds={kindOptions}
            statuses={statusOptions}
            categories={categoryOptions}
          />
        </Suspense>
      </Card>

      {contested.length > 0 && kind === 'all' && status === 'all' && category === 'all' ? (
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
            <DecisionCard key={d.id} d={d} p={p} now={now} />
          ))}
        </div>
      )}

      {/* Neither a decision nor a blocker, and therefore nothing anyone has to
          do — but it is what was actually being talked about, and without this
          it disappears the moment the document scrolls out of the window Yaara
          reads. Last, and visibly softer than the register above it. */}
      {themes.length > 0 ? (
        <Card>
          <CardHeading
            title="Also being discussed"
            sub="Themes read out of shared documents. Nobody owns these — they are here so a recurring topic is visible before it becomes a blocker."
          />
          <div className="flex flex-col gap-2.5">
            {themes.map((t) => {
              const where = labelForEndpoint(p, t.entityType, t.entityId)
              return (
                <div key={t.id} className="text-[12.5px]">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold">{t.theme}</span>
                    {where ? <Chip tone="accent">{where}</Chip> : null}
                    <Muted>
                      {t.mentions === 1 ? 'mentioned once' : `${t.mentions} mentions`}
                      {t.lastMeeting ? ` · last in ${t.lastMeeting}` : ''}
                    </Muted>
                  </div>
                  <p className="m-0 mt-0.5 leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {t.summary}
                  </p>
                </div>
              )
            })}
          </div>
        </Card>
      ) : null}

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
