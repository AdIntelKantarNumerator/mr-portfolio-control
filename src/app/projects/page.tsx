/**
 * Every project, findable by name.
 *
 * The detail page has always existed; there was no way to reach it. Projects
 * were visible only nested under the initiative that owns them, which works
 * right up until the thing you are looking for has no initiative — which is
 * exactly what a project converted from intake looks like on the day it is
 * created. Someone who had just created a project could not find it again.
 *
 * Search is here rather than clever filtering because the question this page
 * answers is almost always "where did my project go".
 */
import Link from 'next/link'
import { Suspense } from 'react'
import {
  Card,
  Empty,
  GapFlag,
  HealthBadge,
  Kicker,
  Muted,
  Pill,
  ProgressBar,
  Stat,
  type Tone,
} from '@/components/ui'
import { isEnded, label } from '@/lib/domain'
import { getPortfolio, type Portfolio, type ProjectView } from '@/lib/portfolio'
import { fmtDate } from '@/lib/util'
import { ProjectSearch } from './search'
import { ShowEnded } from '@/components/show-ended'

// This page reads the live portfolio; prerendering it would serve stale data.
export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<string, Tone> = {
  backlog: 'slate',
  planned: 'slate',
  in_progress: 'blue',
  paused: 'amber',
  completed: 'green',
  canceled: 'slate',
}

/** Live work first, then the not-yet-started, then everything finished. */
const STATUS_RANK: Record<string, number> = {
  in_progress: 0,
  paused: 1,
  planned: 2,
  backlog: 3,
  completed: 4,
  canceled: 5,
}

function initiativeOf(p: Portfolio, project: ProjectView): string | null {
  if (!project.initiativeId) return null
  return p.initiatives.find((i) => i.id === project.initiativeId)?.name ?? null
}

function Row({ project, p }: { project: ProjectView; p: Portfolio }) {
  const initiative = initiativeOf(p, project)

  return (
    <Link
      href={`/projects/${project.id}`}
      className="flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 no-underline transition-colors hover:bg-[var(--raised)]"
      style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-semibold tracking-[-0.01em]">{project.name}</span>
        <Pill tone={STATUS_TONE[project.status] ?? 'slate'}>
          {label('projectStatus', project.status)}
        </Pill>
        <HealthBadge health={project.health} showOrigin={false} />
        {/* A project with no initiative is not an error, but it is the state a
            freshly converted intake request is in - and the reason somebody
            could not find it by browsing initiatives. */}
        {initiative ? (
          <Muted>{initiative}</Muted>
        ) : (
          <GapFlag title="Not under any initiative. Newly converted intake requests start this way.">
            no initiative
          </GapFlag>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span>
          <Muted>Lead</Muted>{' '}
          {project.lead ? (
            <span className="font-semibold">{project.lead.name}</span>
          ) : (
            <GapFlag title="Nobody is named as lead.">unassigned</GapFlag>
          )}
        </span>
        {project.team ? (
          <span>
            <Muted>Team</Muted> <span className="font-semibold">{project.team.name}</span>
          </span>
        ) : null}
        {project.targetDate ? (
          <span>
            <Muted>Target</Muted>{' '}
            <span className="font-semibold">{fmtDate(project.targetDate)}</span>
          </span>
        ) : null}
        <span className="min-w-[90px] flex-1">
          <ProgressBar value={project.progress ?? 0} />
        </span>
      </div>
    </Link>
  )
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const [p, sp] = await Promise.all([getPortfolio(), searchParams])

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const q = (one(sp.q) ?? '').trim().toLowerCase()
  const showEnded = one(sp.ended) === '1'

  const all = p.projects
  // Closed and withdrawn work is hidden by default. A list that only grows
  // stops being read, and the things people come here for are all live.
  const inScope = showEnded ? all : all.filter((x) => !isEnded(x.status))
  // Name, key and description: someone searching for a converted intake
  // request may remember the problem they described rather than the title
  // they gave it.
  const visible = inScope
    .filter((x) =>
      !q
        ? true
        : [x.name, x.key, x.description].some((f) => (f ?? '').toLowerCase().includes(q)),
    )
    .sort((a, b) => {
      const ra = STATUS_RANK[a.status] ?? 99
      const rb = STATUS_RANK[b.status] ?? 99
      if (ra !== rb) return ra - rb
      return a.name.localeCompare(b.name)
    })

  const live = all.filter((x) => x.status === 'in_progress' || x.status === 'paused')
  const orphans = inScope.filter((x) => !x.initiativeId)
  const endedCount = all.filter((x) => isEnded(x.status)).length

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Kicker>Projects</Kicker>
        <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">
          Every project, including the ones no initiative owns yet
        </h2>
        <p className="m-0 mt-1 max-w-[760px] text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Initiatives show the projects beneath them. This shows all of them — which is the only
          way to find one that has just been converted from intake and has no initiative yet.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={inScope.length} label={showEnded ? 'Projects (all)' : 'Live projects'} />
        <Stat value={live.length} label="In progress or paused" tone="blue" />
        <Stat
          value={orphans.length}
          label="Not under an initiative"
          tone={orphans.length ? 'amber' : 'green'}
        />
        <Stat value={endedCount} label="Closed or withdrawn" />
      </div>

      <Card>
        <Suspense fallback={<Muted>Loading search…</Muted>}>
          <div className="flex flex-col gap-2">
            <ProjectSearch total={inScope.length} />
            <ShowEnded hidden={endedCount} path="/projects" noun="projects" />
          </div>
        </Suspense>
      </Card>

      {visible.length === 0 ? (
        <Empty>
          {q ? `No project matches "${q}".` : 'No projects yet.'}
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((project) => (
            <Row key={project.id} project={project} p={p} />
          ))}
        </div>
      )}
    </div>
  )
}
