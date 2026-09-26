/**
 * The "by application" view.
 *
 * Projects are how the board reads the portfolio; application areas are how
 * the people who own the code read it. Same workstreams, second axis — and this is
 * the axis on which "who owes me an update" is actually actionable, because an
 * area has a named owner and named devs.
 */
import {
  Card,
  CardHeading,
  Empty,
  GapFlag,
  HealthBadge,
  Kicker,
  Muted,
  Pill,
  RagDot,
  SectionNote,
  SourceBadge,
  Stat,
} from '@/components/ui'
import { isEnded, label } from '@/lib/domain'
import { getPortfolio, type AppAreaRow, type WorkstreamView } from '@/lib/portfolio'
import { fmtRange } from '@/lib/util'
import { ShowEnded } from '@/components/show-ended'
import { Suspense } from 'react'

// This page reads the live portfolio; prerendering it would serve stale data.
export const dynamic = 'force-dynamic'

/** Finished work does not owe anybody an update, so it never counts as a gap. */
function awaitingInput(workstreams: WorkstreamView[]) {
  // isEnded rather than a list declared here. This file had its own copy, and
  // a second definition of "finished" is how a workstream ends up hidden on one
  // page and counted on another.
  return workstreams.filter((p) => p.health.origin === 'none' && !isEnded(p.status))
}

function ProjectTable({ workstreams }: { workstreams: WorkstreamView[] }) {
  return (
    <div className="scroll-x">
      <table className="grid">
        <thead>
          <tr>
            <th style={{ minWidth: 150 }}>Health</th>
            <th style={{ minWidth: 220 }}>Workstream</th>
            <th>Status</th>
            <th>Lead</th>
            <th style={{ minWidth: 130 }}>Dates</th>
            <th className="full-only">Source</th>
          </tr>
        </thead>
        <tbody>
          {workstreams.map((p) => {
            const needsInput = p.health.origin === 'none' && !isEnded(p.status)
            return (
              <tr key={p.id}>
                <td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <HealthBadge health={p.health} showOrigin={false} />
                    {needsInput ? (
                      <GapFlag title="No assessment and the source has no health either. Someone has to look at this and say.">
                        needs owner input
                      </GapFlag>
                    ) : null}
                  </div>
                  {p.health.origin === 'assessed' && p.health.rationale ? (
                    <div className="full-only mt-1">
                      <Muted>{p.health.rationale}</Muted>
                    </div>
                  ) : null}
                </td>
                <td>
                  <span className="font-semibold">{p.name}</span>
                </td>
                <td>
                  <Pill tone={p.status === 'in_progress' ? 'blue' : 'slate'}>
                    {label('projectStatus', p.status)}
                  </Pill>
                </td>
                <td>
                  {p.lead ? (
                    p.lead.name
                  ) : (
                    <GapFlag title="No delivery lead on this workstream.">no lead</GapFlag>
                  )}
                </td>
                <td className="tabular-nums">{fmtRange(p.startDate, p.targetDate)}</td>
                <td className="full-only">
                  <div className="flex flex-wrap gap-1">
                    {p.sources.length === 0 ? (
                      <Muted>typed here</Muted>
                    ) : (
                      p.sources.map((s, i) => (
                        <SourceBadge key={`${s.system}-${i}`} system={s.system} url={s.url} />
                      ))
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AreaCard({ area, workstreams }: { area: AppAreaRow | null; workstreams: WorkstreamView[] }) {
  const pending = awaitingInput(workstreams)
  const meta = area
    ? [area.owner ? `Owner: ${area.owner}` : null, area.devs ? `Devs: ${area.devs}` : null]
        .filter(Boolean)
        .join(' · ')
    : 'These workstreams have no application area set, so no owner sees them on this axis.'

  return (
    <Card>
      <CardHeading
        title={area ? area.name : 'Unassigned'}
        sub={meta || 'No owner or devs recorded for this area.'}
        right={
          pending.length > 0 ? (
            <Pill tone="slate" title="Workstreams with no health on record.">
              <RagDot rag="unknown" />
              {pending.length} awaiting input
            </Pill>
          ) : (
            <Pill tone="green">all assessed</Pill>
          )
        }
      />

      {area?.note ? <SectionNote tone="amber">{area.note}</SectionNote> : null}
      {!area ? (
        <SectionNote tone="violet">
          No application area means no owner on this axis. Assigning one is usually a five-second
          fix and it is the difference between a workstream being chased and being forgotten.
        </SectionNote>
      ) : null}

      {workstreams.length === 0 ? (
        <Empty>No workstreams in this area.</Empty>
      ) : (
        <ProjectTable workstreams={workstreams} />
      )}
    </Card>
  )
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const [p, sp] = await Promise.all([getPortfolio(), searchParams])

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const showEnded = one(sp.ended) === '1'
  const endedCount = p.workstreams.filter((x) => isEnded(x.status)).length
  const inScope = showEnded ? p.workstreams : p.workstreams.filter((x) => !isEnded(x.status))

  const byArea = new Map<string, WorkstreamView[]>()
  const unassigned: WorkstreamView[] = []
  for (const workstream of inScope) {
    if (!workstream.appAreaId) {
      unassigned.push(workstream)
      continue
    }
    if (!byArea.has(workstream.appAreaId)) byArea.set(workstream.appAreaId, [])
    byArea.get(workstream.appAreaId)!.push(workstream)
  }

  const pending = awaitingInput(inScope)
  const areasWithGaps = p.appAreas.filter((a) => awaitingInput(byArea.get(a.id) ?? []).length > 0)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Kicker>By application</Kicker>
        <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">
          The same portfolio, seen by the people who own the code
        </h2>
        <p className="m-0 mt-1 max-w-[820px] text-[12.5px]" style={{ color: 'var(--muted)' }}>
          A grey row is a workstream with no health on record — no assessment, and nothing usable from
          the source either. That grey list is literally the &ldquo;who owes me an update&rdquo;
          list: each one has a named area owner and a named lead, and neither has said anything
          about it. Nothing here is guessed green.
        </p>
      </div>

      <Suspense fallback={null}>
        <ShowEnded hidden={endedCount} path="/applications" noun="workstreams" />
      </Suspense>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          value={pending.length}
          label="Awaiting owner input"
          tone={pending.length > 0 ? 'amber' : 'green'}
          sub={`across ${areasWithGaps.length} ${areasWithGaps.length === 1 ? 'area' : 'areas'}`}
        />
        <Stat value={inScope.length} label={showEnded ? 'Workstreams (all)' : 'Live workstreams'} />
        <Stat value={p.appAreas.length} label="Application areas" />
        <Stat
          value={unassigned.length}
          label="No area assigned"
          tone={unassigned.length > 0 ? 'amber' : 'green'}
        />
      </div>

      {pending.length > 0 ? (
        <SectionNote tone="slate">
          <span className="inline-flex items-center gap-1.5">
            <RagDot rag="unknown" />
            <span>
              {pending.length} {pending.length === 1 ? 'workstream has' : 'workstreams have'} no health on
              record. Chase the area owner, not the tool.
            </span>
          </span>
        </SectionNote>
      ) : null}

      {p.appAreas.length === 0 && unassigned.length === 0 ? (
        <Empty>No application areas and no workstreams yet.</Empty>
      ) : null}

      <div className="flex flex-col gap-4">
        {p.appAreas.map((area) => (
          <AreaCard key={area.id} area={area} workstreams={byArea.get(area.id) ?? []} />
        ))}
        {unassigned.length > 0 ? <AreaCard area={null} workstreams={unassigned} /> : null}
      </div>

      <Muted>
        Health here is the resolved health: an assessment beats the source field, and the absence
        of both reads as {label('rag', 'unknown')} rather than green.
      </Muted>
    </div>
  )
}
