/**
 * The intake queue.
 *
 * One screen, grouped by where a request sits in the process, because the only
 * useful question about intake is "what is waiting on us, and what is it
 * waiting for". Absence is rendered as loudly as content: an unsized request, a
 * request with no sponsor, and a hard date with no reason behind it are all
 * flagged rather than quietly displayed as if they were complete.
 */
import Link from 'next/link'
import { asc, desc } from 'drizzle-orm'
import { db } from '@/db/client'
import { appAreas, intakeRequests, themes } from '@/db/schema'
import { INTAKE_STATUS, LABELS, TSHIRT_WEEKS, type IntakeStatus, type Tshirt } from '@/lib/domain'
import { getScoringContext, scoreForRequest, type ScoringContext } from '@/lib/scoring'
import { fmtDate, relativeDays } from '@/lib/util'
import type { IntakeRow } from '@/lib/portfolio'
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
  SourceBadge,
  Stat,
  type Tone,
} from '@/components/ui'
import { approveAndConvert, moveRequest, recordDecisionNote } from './actions'

export const metadata = { title: 'Intake · Portfolio Control Room' }

// The queue is edited from this screen and from Slack-sourced imports; a cached
// render would show a triage meeting a queue that has already moved.
export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<IntakeStatus, Tone> = {
  new: 'blue',
  triage: 'slate',
  scoring: 'violet',
  ranked: 'accent',
  approved: 'green',
  rejected: 'red',
  deferred: 'amber',
  converted: 'green',
}

const STATUS_NOTE: Record<IntakeStatus, string> = {
  new: 'Arrived, nobody has looked yet.',
  triage: 'Being read and routed. Duplicates and non-requests die here.',
  scoring: 'In the model, waiting for criteria to be filled in.',
  ranked: 'Scored and placed on the ranked list. Above or below the cut line is decided there.',
  approved: 'Leadership said yes. Not real until it is a project.',
  rejected: 'Said no, with a reason on the record.',
  deferred: 'Not now. Revisit at the next planning cycle.',
  converted: 'Became a project. The delivery layer owns it from here.',
}

/** Statuses a request can be pushed to by hand; 'converted' is earned, not set. */
const MOVE_TARGETS = INTAKE_STATUS.filter((s) => s !== 'converted')

function ScoreReadout({ ctx, requestId }: { ctx: ScoringContext; requestId: string }) {
  if (!ctx.model) return null
  const { score, scored, total } = scoreForRequest(ctx, requestId)
  if (score === null) {
    return (
      <Chip tone="slate" title="No criterion has been scored yet.">
        not scored
      </Chip>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Pill tone={scored < total ? 'amber' : 'accent'} title={`${ctx.model.name}`}>
        {score.toFixed(1)}
      </Pill>
      {scored < total ? (
        <Chip
          tone="amber"
          title="Partially scored. The number is computed from the criteria that have values, so it is not comparable with a fully scored request."
        >
          {scored}/{total} scored
        </Chip>
      ) : null}
    </span>
  )
}

function RequestCard({
  r,
  ctx,
  themeName,
  areaName,
}: {
  r: IntakeRow
  ctx: ScoringContext
  themeName: string | null
  areaName: string | null
}) {
  const costumedDate = r.hardDate && !r.hardDateReason?.trim()
  const weeks = r.tshirt ? TSHIRT_WEEKS[r.tshirt as Tshirt] : null

  return (
    <Card tone={costumedDate ? 'alert' : 'default'} className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11.5px] font-bold" style={{ color: 'var(--brand-2)' }}>
          {r.ref}
        </span>
        <Pill tone={STATUS_TONE[r.status as IntakeStatus] ?? 'slate'}>
          {LABELS.intakeStatus[r.status as IntakeStatus] ?? r.status}
        </Pill>
        <SourceBadge system={r.source} />
        <span className="ml-auto">
          <ScoreReadout ctx={ctx} requestId={r.id} />
        </span>
      </div>

      <div>
        <h3 className="m-0 text-[13.5px] font-semibold leading-snug">{r.title}</h3>
        <p className="m-0 mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          {r.problem}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone="slate" title="Who raised it">
          {r.requesterName}
        </Chip>
        {r.sponsor ? (
          <Chip tone="blue" title="Sponsor — who defends this when it displaces something else">
            sponsor · {r.sponsor}
          </Chip>
        ) : (
          <GapFlag title="No sponsor named. Unsponsored requests lose every contention argument.">
            no sponsor
          </GapFlag>
        )}
        {themeName ? <Chip tone="violet">{themeName}</Chip> : <GapFlag>no theme</GapFlag>}
        {areaName ? <Chip tone="accent">{areaName}</Chip> : <GapFlag>no app area</GapFlag>}
        {r.tshirt ? (
          <Chip tone="slate" title={`About ${weeks} engineer-weeks`}>
            {LABELS.tshirt[r.tshirt as Tshirt]} · ~{weeks}w
          </Chip>
        ) : (
          <GapFlag title="Unsized requests cannot be placed against the capacity cut line.">
            not sized
          </GapFlag>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {r.desiredDate ? (
          <Chip tone={r.hardDate ? 'red' : 'slate'} title={fmtDate(r.desiredDate, { year: true })}>
            {r.hardDate ? 'hard date' : 'wants'} · {fmtDate(r.desiredDate, { year: true })} (
            {relativeDays(r.desiredDate)})
          </Chip>
        ) : (
          <Muted>No date asked for</Muted>
        )}
        {r.hardDate && r.hardDateReason ? (
          <Chip tone="slate" title={r.hardDateReason}>
            because · {r.hardDateReason}
          </Chip>
        ) : null}
        {costumedDate ? (
          <GapFlag title="A hard date with no reason behind it is a preference wearing a costume. Ask what actually breaks.">
            hard date, no reason given
          </GapFlag>
        ) : null}
      </div>

      {r.decisionNote ? (
        <p
          className="m-0 rounded-md border px-2.5 py-1.5 text-[11.5px]"
          style={{ borderColor: 'var(--line)', background: 'var(--raised)' }}
        >
          <span className="font-semibold">Decision: </span>
          {r.decisionNote}
        </p>
      ) : null}

      {/* Everything below is the operator's console, not the leadership read. */}
      <div className="full-only no-print mt-auto grid gap-2 border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <form action={moveRequest} className="flex items-center gap-2">
            <input type="hidden" name="requestId" value={r.id} />
            <select
              name="status"
              defaultValue={r.status}
              aria-label={`Move ${r.ref}`}
              className="!w-auto !py-1 text-[11.5px]"
            >
              {MOVE_TARGETS.map((s) => (
                <option key={s} value={s}>
                  {LABELS.intakeStatus[s]}
                </option>
              ))}
            </select>
            <button type="submit" className="btn !py-1">
              Move
            </button>
          </form>

          {r.status === 'approved' ? (
            <form action={approveAndConvert} className="ml-auto">
              <input type="hidden" name="requestId" value={r.id} />
              <button
                type="submit"
                className="btn btn-primary !py-1"
                title="Creates a backlog project carrying the title, problem, app area and proposed initiative, then marks this request converted."
              >
                Create project
              </button>
            </form>
          ) : null}

          {r.convertedProjectId ? (
            <span className="ml-auto">
              <Chip tone="green" title="A project exists for this request.">
                project created
              </Chip>
            </span>
          ) : null}
        </div>

        <form action={recordDecisionNote} className="grid gap-1.5">
          <input type="hidden" name="requestId" value={r.id} />
          <textarea
            name="note"
            rows={2}
            defaultValue={r.decisionNote ?? ''}
            placeholder="Decision note — why this was moved, and who said so."
            className="text-[11.5px]"
            aria-label={`Decision note for ${r.ref}`}
          />
          <div>
            <button type="submit" className="btn !py-1">
              Record note
            </button>
          </div>
        </form>
      </div>
    </Card>
  )
}

export default async function IntakePage() {
  const [requests, themeRows, areaRows, ctx] = await Promise.all([
    db.select().from(intakeRequests).orderBy(desc(intakeRequests.createdAt), asc(intakeRequests.ref)),
    db.select({ id: themes.id, name: themes.name }).from(themes).orderBy(asc(themes.sortOrder)),
    db.select({ id: appAreas.id, name: appAreas.name }).from(appAreas).orderBy(asc(appAreas.sortOrder)),
    getScoringContext(),
  ])

  const themeName = new Map(themeRows.map((t) => [t.id, t.name]))
  const areaName = new Map(areaRows.map((a) => [a.id, a.name]))

  const byStatus = new Map<IntakeStatus, IntakeRow[]>()
  for (const s of INTAKE_STATUS) byStatus.set(s, [])
  for (const r of requests) byStatus.get(r.status as IntakeStatus)?.push(r)

  const live = requests.filter((r) => !['rejected', 'converted'].includes(r.status))
  const costumedDates = live.filter((r) => r.hardDate && !r.hardDateReason?.trim())
  const unsized = live.filter((r) => !r.tshirt)
  const awaitingConversion = requests.filter((r) => r.status === 'approved')

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Kicker>Intake</Kicker>
          <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">Triage queue</h2>
          <p className="m-0 mt-1 max-w-[760px] text-[12.5px]" style={{ color: 'var(--muted)' }}>
            One door for every new ask, whether it arrived in this form, a Slack thread or a
            spreadsheet. A request is only real once it has a sponsor, a rough size, and a date
            somebody can defend.
          </p>
        </div>
        <Link href="/intake/new" className="btn btn-primary no-print">
          New request
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat value={live.length} label="Open requests" sub="Not rejected, not yet converted" />
        <Stat
          value={awaitingConversion.length}
          label="Approved, no project"
          tone={awaitingConversion.length ? 'amber' : undefined}
          sub="Approval that has not been turned into work"
        />
        <Stat
          value={costumedDates.length}
          label="Hard dates with no reason"
          tone={costumedDates.length ? 'red' : 'green'}
          sub="A preference wearing a costume"
        />
        <Stat
          value={unsized.length}
          label="Unsized"
          tone={unsized.length ? 'amber' : 'green'}
          sub="Cannot be placed against the cut line"
        />
      </div>

      {costumedDates.length ? (
        <SectionNote tone="red">
          {costumedDates.length} open request{costumedDates.length === 1 ? ' claims' : 's claim'} a
          hard date with nothing written down about what breaks if it slips —{' '}
          {costumedDates.map((r) => r.ref).join(', ')}. Ask before the date gets quoted upward.
        </SectionNote>
      ) : null}

      {!ctx.model ? (
        <SectionNote tone="amber">
          No scoring model is active, so nothing in this queue can be ranked. Set one up on the{' '}
          <Link href="/prioritization" className="underline">
            prioritization
          </Link>{' '}
          screen.
        </SectionNote>
      ) : null}

      {INTAKE_STATUS.map((status) => {
        const rows = byStatus.get(status) ?? []
        return (
          <section key={status}>
            <CardHeading
              title={
                <span className="inline-flex items-center gap-2">
                  <Pill tone={STATUS_TONE[status]}>{LABELS.intakeStatus[status]}</Pill>
                  <Muted>
                    {rows.length} request{rows.length === 1 ? '' : 's'}
                  </Muted>
                </span>
              }
              sub={STATUS_NOTE[status]}
            />
            {rows.length === 0 ? (
              <Empty>Nothing in {LABELS.intakeStatus[status].toLowerCase()}.</Empty>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((r) => (
                  <RequestCard
                    key={r.id}
                    r={r}
                    ctx={ctx}
                    themeName={r.themeId ? (themeName.get(r.themeId) ?? null) : null}
                    areaName={r.appAreaId ? (areaName.get(r.appAreaId) ?? null) : null}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
