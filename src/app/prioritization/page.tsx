/**
 * Prioritization.
 *
 * The ranked list and the model that produced it, on one screen. Showing the
 * output without the weights is how a scoring exercise turns into a ritual: the
 * room argues with the ordering, loses, and stops believing the tool. Showing
 * both means the argument lands where it can actually be settled.
 */
import Link from 'next/link'
import { asc, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { intakeRequests, themes } from '@/db/schema'
import { TSHIRT_WEEKS, computeScore, type Tshirt } from '@/lib/domain'
import { criterionInputs, getScoringContext } from '@/lib/scoring'
import { Card, CardHeading, Empty, Kicker, Muted, SectionNote, Stat } from '@/components/ui'
import { ModelPanel } from './model-panel'
import { RankedTable, type CriterionCell, type RankRow } from './ranked-table'

export const metadata = { title: 'Prioritization · Portfolio Control Room' }

// Scores and weights are edited live during a prioritization meeting, so this
// page is never served from a cache.
export const dynamic = 'force-dynamic'

/** The statuses that belong on a ranked list: proposed, scored, or decided. */
const RANKABLE = ['scoring', 'ranked', 'approved'] as const

export default async function PrioritizationPage() {
  const [ctx, requests, themeRows] = await Promise.all([
    getScoringContext(),
    db
      .select()
      .from(intakeRequests)
      .where(inArray(intakeRequests.status, [...RANKABLE]))
      .orderBy(asc(intakeRequests.ref)),
    db.select({ id: themes.id, name: themes.name }).from(themes).orderBy(asc(themes.sortOrder)),
  ])

  if (!ctx.model) {
    return (
      <div className="grid gap-4">
        <CardHeading
          title="Prioritization"
          sub="Nothing can be ranked until a scoring model is active."
        />
        <Empty>
          No active scoring model. Seed one, or mark an existing model active, before running a
          prioritization session.
        </Empty>
      </div>
    )
  }

  const themeName = new Map(themeRows.map((t) => [t.id, t.name]))
  const criteria: CriterionCell[] = ctx.criteria.map((c) => ({
    id: c.id,
    key: c.key,
    label: c.label,
    helpText: c.helpText,
    weight: c.weight,
    direction: c.direction,
    scaleMin: c.scaleMin,
    scaleMax: c.scaleMax,
  }))

  const rows: RankRow[] = requests.map((r) => ({
    id: r.id,
    ref: r.ref,
    title: r.title,
    theme: r.themeId ? (themeName.get(r.themeId) ?? null) : null,
    status: r.status,
    tshirt: (r.tshirt as Tshirt | null) ?? null,
    values: ctx.valuesByRequest.get(r.id) ?? {},
  }))

  // Summary counts come off the stored scores. The table recomputes the same
  // arithmetic client-side so live edits re-rank in front of the room; these
  // numbers catch up on the refresh that follows every save.
  const inputs = criterionInputs(ctx.criteria)
  const results = rows.map((r) => computeScore(inputs, r.values))
  const unscored = results.filter((r) => r.score === null).length
  const partial = results.filter((r) => r.score !== null && r.scored < r.total).length
  const totalWeeks = rows.reduce((sum, r) => sum + (r.tshirt ? TSHIRT_WEEKS[r.tshirt] : 0), 0)
  const capacity = ctx.model.capacityUnits
  const capacityLabel = ctx.model.capacityLabel ?? 'units'
  const overBy = capacity === null ? null : Math.max(0, totalWeeks - capacity)

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Kicker>Prioritization</Kicker>
          <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">
            Ranked list and cut line
          </h2>
          <p className="m-0 mt-1 max-w-[760px] text-[12.5px]" style={{ color: 'var(--muted)' }}>
            Everything in scoring, ranked or approved, ordered by weighted score and stacked against
            the capacity that actually exists. Edit a cell and the order moves with it.
          </p>
        </div>
        <Link href="/intake" className="btn no-print">
          Back to intake
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          value={rows.length}
          label="On the list"
          sub={`Scoring, ranked and approved requests`}
        />
        <Stat
          value={capacity === null ? '—' : capacity}
          label={`Capacity (${capacityLabel})`}
          sub="What the cut line is drawn at"
        />
        <Stat
          value={totalWeeks}
          label={`Asked for (${capacityLabel})`}
          tone={overBy ? 'red' : 'green'}
          sub={
            overBy
              ? `${overBy} ${capacityLabel} more than exists`
              : 'Everything asked for fits'
          }
        />
        <Stat
          value={unscored + partial}
          label="Not fully scored"
          tone={unscored + partial ? 'amber' : 'green'}
          sub={`${unscored} untouched · ${partial} partial`}
        />
      </div>

      {unscored === results.length && results.length > 0 ? (
        <SectionNote tone="blue">
          Nothing has been scored yet. The criteria and weights below are a starting model to
          argue with; the 1&ndash;5 values are a judgement the room makes together. Score a row
          and the ranking, the running total and the cut line all recompute live.
        </SectionNote>
      ) : partial > 0 ? (
        <SectionNote tone="amber">
          {partial} request{partial === 1 ? '' : 's'} on this list {partial === 1 ? 'is' : 'are'}{' '}
          partially scored. Their numbers are computed from the criteria that have values only, so
          they are badged rather than presented as final — a half-scored request sitting above the
          line is a decision nobody has actually made.
        </SectionNote>
      ) : null}

      <Card>
        <CardHeading
          title="Ranked"
          sub="Scores are 1–5 per criterion. Blank means nobody has scored it, which is not the same as scoring it low."
        />
        <RankedTable
          rows={rows}
          criteria={criteria}
          capacityUnits={capacity}
          capacityLabel={capacityLabel}
        />
      </Card>

      {/* The model is operational detail for a leadership read of the ranking. */}
      <div className="full-only">
        <ModelPanel
          modelId={ctx.model.id}
          modelName={ctx.model.name}
          description={ctx.model.description}
          criteria={criteria}
          capacityUnits={capacity}
          capacityLabel={capacityLabel}
        />
      </div>

      <Muted>
        Requests in new, triage, rejected, deferred or converted are deliberately absent — a ranked
        list that includes things nobody has triaged, or things already delivered, is a list people
        learn to ignore.
      </Muted>
    </div>
  )
}
