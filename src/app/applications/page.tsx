/**
 * The "by application" view.
 *
 * Initiatives are how the board reads the portfolio; application areas are how
 * the people who own the code read it. Same projects, second axis — and this is
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
import { getPortfolio, type AppAreaRow, type ProjectView } from '@/lib/portfolio'
import { fmtRange } from '@/lib/util'
import { ShowEnded } from '@/components/show-ended'
import { Suspense } from 'react'

// This page reads the live portfolio; prerendering it would serve stale data.
export const dynamic = 'force-dynamic'

/** Finished work does not owe anybody an update, so it never counts as a gap. */
function awaitingInput(projects: ProjectView[]) {
  // isEnded rather than a list declared here. This file had its own copy, and
  // a second definition of "finished" is how a project ends up hidden on one
  // page and counted on another.
  return projects.filter((p) => p.health.origin === 'none' && !isEnded(p.status))
}

function ProjectTable({ projects }: { projects: ProjectView[] }) {
  return (
    <div className="scroll-x">
      <table className="grid">
        <thead>
          <tr>
            <th style={{ minWidth: 150 }}>Health</th>
            <th style={{ minWidth: 220 }}>Project</th>
            <th>Status</th>
            <th>Lead</th>
            <th style={{ minWidth: 130 }}>Dates</th>
            <th className="full-only">Source</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
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
                    <GapFlag title="No delivery lead on this project.">no lead</GapFlag>
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

function AreaCard({ area, projects }: { area: AppAreaRow | null; projects: ProjectView[] }) {
  const pending = awaitingInput(projects)
  const meta = area
    ? [area.owner ? `Owner: ${area.owner}` : null, area.devs ? `Devs: ${area.devs}` : null]
        .filter(Boolean)
        .join(' · ')
    : 'These projects have no application area set, so no owner sees them on this axis.'

  return (
    <Card>
      <CardHeading
        title={area ? area.name : 'Unassigned'}
        sub={meta || 'No owner or devs recorded for this area.'}
        right={
          pending.length > 0 ? (
            <Pill tone="slate" title="Projects with no health on record.">
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
          fix and it is the difference between a project being chased and being forgotten.
        </SectionNote>
      ) : null}

      {projects.length === 0 ? (
        <Empty>No projects in this area.</Empty>
      ) : (
        <ProjectTable projects={projects} />
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
  const endedCount = p.projects.filter((x) => isEnded(x.status)).length
  const inScope = showEnded ? p.projects : p.projects.filter((x) => !isEnded(x.status))

  const byArea = new Map<string, ProjectView[]>()
  const unassigned: ProjectView[] = []
  for (const project of inScope) {
    if (!project.appAreaId) {
      unassigned.push(project)
      continue
    }
    if (!byArea.has(project.appAreaId)) byArea.set(project.appAreaId, [])
    byArea.get(project.appAreaId)!.push(project)
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
          A grey row is a project with no health on record — no assessment, and nothing usable from
          the source either. That grey list is literally the &ldquo;who owes me an update&rdquo;
          list: each one has a named area owner and a named lead, and neither has said anything
          about it. Nothing here is guessed green.
        </p>
      </div>

      <Suspense fallback={null}>
        <ShowEnded hidden={endedCount} path="/applications" noun="projects" />
      </Suspense>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          value={pending.length}
          label="Awaiting owner input"
          tone={pending.length > 0 ? 'amber' : 'green'}
          sub={`across ${areasWithGaps.length} ${areasWithGaps.length === 1 ? 'area' : 'areas'}`}
        />
        <Stat value={inScope.length} label={showEnded ? 'Projects (all)' : 'Live projects'} />
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
              {pending.length} {pending.length === 1 ? 'project has' : 'projects have'} no health on
              record. Chase the area owner, not the tool.
            </span>
          </span>
        </SectionNote>
      ) : null}

      {p.appAreas.length === 0 && unassigned.length === 0 ? (
        <Empty>No application areas and no projects yet.</Empty>
      ) : null}

      <div className="flex flex-col gap-4">
        {p.appAreas.map((area) => (
          <AreaCard key={area.id} area={area} projects={byArea.get(area.id) ?? []} />
        ))}
        {unassigned.length > 0 ? <AreaCard area={null} projects={unassigned} /> : null}
      </div>

      <Muted>
        Health here is the resolved health: an assessment beats the source field, and the absence
        of both reads as {label('rag', 'unknown')} rather than green.
      </Muted>
    </div>
  )
}
