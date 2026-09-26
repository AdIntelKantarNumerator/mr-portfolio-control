/**
 * Everything about one workstream, on one page.
 *
 * The sibling of the project page, one level down, and with one difference
 * that matters: readiness is shown item by item rather than as a percentage.
 * At project level "72% ready" is a useful shape; at workstream level it is a
 * number that hides the two required things nobody has done, which are the
 * only part anyone can act on.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDistanceToNowStrict } from 'date-fns'
import { Brief } from '@/components/brief'
import { Observations } from '@/components/observations'
import { Themes } from '@/components/themes'
import { Milestones } from './milestones'
import { Updates } from '@/components/updates'
import {
  Card,
  CardHeading,
  Chip,
  Empty,
  GapFlag,
  HealthBadge,
  Kicker,
  Muted,
  OverrideBadge,
  Pill,
  ProgressBar,
  SectionNote,
  SourceBadge,
  Stat,
  type Tone,
} from '@/components/ui'
import { label } from '@/lib/domain'
import { LifecycleControl } from '../../lifecycle/control'
import { overdueMilestones } from '@/lib/util'
import { getBriefs, getSources, getTranscripts } from '@/lib/briefs'
import { getAgentAssessments, getObservations } from '@/lib/observations'
import { getPortfolio, personLoads, themesFor, workstreamsFor } from '@/lib/portfolio'
import { getUpdateHistory } from '@/lib/observations'
import {
  getReadiness,
  readinessStatusLabel,
  scoreItems,
  statusFor,
  type ReadinessStatus,
} from '@/lib/readiness'
import { InitiativeSources } from '../../projects/[id]/sources-panel'

export const dynamic = 'force-dynamic'

function fmt(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : '—'
}

const DECISION_TONE: Record<string, Tone> = {
  open: 'red',
  watch: 'amber',
  decided: 'green',
  dropped: 'slate',
}

const READINESS_TONE: Record<ReadinessStatus, Tone> = {
  done: 'green',
  in_progress: 'amber',
  na: 'slate',
  not_started: 'red',
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const p = await getPortfolio()
  const pr = p.workstreams.find((x) => x.id === id)
  return { title: pr ? `${pr.name} · MR Portfolio Control` : 'Workstream' }
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [
    p,
    readiness,
    sources,
    transcripts,
    briefs,
    observations,
    agentAssessments,
    themes,
    plan,
    updates,
  ] = await Promise.all([
    getPortfolio(),
    getReadiness(),
    getSources(),
    getTranscripts(),
    getBriefs(),
    getObservations(),
    getAgentAssessments(),
    themesFor('workstream', id),
    workstreamsFor(id),
    getUpdateHistory('workstream', id),
  ])

  const workstream = p.workstreams.find((x) => x.id === id)
  if (!workstream) notFound()

  const project = workstream.projectId
    ? (p.projects.find((i) => i.id === workstream.projectId) ?? null)
    : null

  const milestoneIds = new Set(workstream.milestones.map((m) => m.id))
  const mine = (type: string, entityId: string) =>
    (type === 'workstream' && entityId === workstream.id) ||
    (type === 'milestone' && milestoneIds.has(entityId))

  const deps = p.dependencies.filter((d) => mine(d.fromType, d.fromId) || mine(d.toType, d.toId))
  const blocking = deps.filter((d) => mine(d.toType, d.toId))
  const blockedBy = deps.filter((d) => mine(d.fromType, d.fromId))
  const openDeps = deps.filter((d) => d.status !== 'resolved' && d.status !== 'dropped')

  const decisions = p.decisions.filter(
    (d) => d.entityType && d.entityId && mine(d.entityType, d.entityId),
  )
  const openDecisions = decisions.filter((d) => d.status === 'open' || d.status === 'watch')

  const score = scoreItems(readiness, workstream.id, readiness.items)

  // The lead's load everywhere else. One person on four dated commitments is
  // the most common reason a workstream that looks fine on paper slips.
  const leadLoad = workstream.lead
    ? (personLoads(p).find((l) => l.person.id === workstream.lead!.id) ?? null)
    : null

  const k = `workstream:${workstream.id}`
  const myTranscripts = transcripts.get(k) ?? []
  const mySources = sources.get(k) ?? []
  const brief = briefs.get(k) ?? null

  const overdueIds = overdueMilestones(workstream.milestones)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="flex flex-wrap items-center gap-2 text-[12px]">
          <Link href="/roadmap" className="underline decoration-dotted underline-offset-2">
            ← Timeline
          </Link>
          {project ? (
            <>
              <Muted>·</Muted>
              <Link
                href={`/projects/${project.id}`}
                className="underline decoration-dotted underline-offset-2"
              >
                {project.name}
              </Link>
            </>
          ) : (
            <GapFlag title="This workstream does not roll up to any project.">
              no project
            </GapFlag>
          )}
        </span>

        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Kicker>{workstream.appArea?.name ?? 'No application area'}</Kicker>
          <Pill tone="slate">{workstream.status}</Pill>
          {workstream.priority ? <Chip tone="slate">{workstream.priority}</Chip> : null}
          {workstream.sources.map((s) => (
            <SourceBadge key={s.system} system={s.system} url={s.url} />
          ))}
        </div>

        <h2 className="m-0 mt-0.5 text-[20px] font-bold tracking-[-0.01em]">{workstream.name}</h2>

        {/* Closing, withdrawing and reopening. Directly under the name because
            on an ended workstream this is the first thing anyone wants. */}
        <div className="mt-2">
          <LifecycleControl kind="workstream" id={workstream.id} status={workstream.status} />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
          <HealthBadge health={workstream.health} />
          <span>
            <Muted>Lead</Muted>{' '}
            {workstream.lead ? (
              <span className="font-semibold">{workstream.lead.name}</span>
            ) : (
              <GapFlag title="Nobody is named as lead.">none</GapFlag>
            )}
          </span>
          {workstream.team ? (
            <span>
              <Muted>Team</Muted> <span className="font-semibold">{workstream.team.name}</span>
            </span>
          ) : null}
          <span>
            <Muted>Window</Muted>{' '}
            <span className="font-semibold">
              {fmt(workstream.startDate)} → {fmt(workstream.targetDate)}
            </span>
          </span>
        </div>

        {workstream.overridden.length > 0 ? (
          <div className="mt-2">
            <OverrideBadge fields={workstream.overridden} />
          </div>
        ) : null}

        {workstream.description ? (
          <p className="m-0 mt-2 max-w-[760px] text-[12.5px] leading-relaxed">
            {workstream.description}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          value={score.total === 0 ? '—' : `${score.pct}%`}
          label="Readiness"
          tone={score.total === 0 ? 'slate' : score.pct >= 80 ? 'green' : 'amber'}
        />
        <Stat
          value={workstream.milestones.length}
          label="Milestones"
          tone={overdueIds.size ? 'red' : 'slate'}
        />
        <Stat
          value={openDeps.length}
          label="Open dependencies"
          tone={openDeps.length ? 'amber' : 'green'}
        />
        <Stat
          value={openDecisions.length}
          label="Open decisions"
          tone={openDecisions.length ? 'red' : 'green'}
        />
        <Stat value={myTranscripts.length} label="Conversations" />
      </div>

      {overdueIds.size > 0 ? (
        <SectionNote tone="red">
          {overdueIds.size} milestone{overdueIds.size === 1 ? '' : 's'} past the
          target date and not marked complete. Either the date moved and nobody said so, or the
          work did not happen.
        </SectionNote>
      ) : null}

      {/* Yaara first: she reads continuously, so this is the newest thing on
          the page — and the one place where a machine's reading is on record. */}
      <Observations
        observation={observations.get(`workstream:${workstream.id}`) ?? null}
        assessment={agentAssessments.get(`workstream:${workstream.id}`) ?? null}
        canReview
      />

      {/* The same voice as the card above, over time. Directly beneath it
          because it is the archive OF it, and a reader who wants last month
          should not have to learn that it lives somewhere else. */}
      <Updates entries={updates} kind="workstream" />

      {/* After the assessments, before the conversations: it sits between what
          a machine concluded and what people said, which is what it is. */}
      <Themes themes={themes} />

      {/* The plan, as the team states it to a room. Everything else on this
          page is what a system observed; this is what somebody intends, and it
          lived in a slide deck until now. */}
      <Card>
        <CardHeading
          title="Program review"
          sub="Objectives, where each has got to, and when it lands — the rows behind this workstream's slide."
        />
        <Milestones
          workstreamId={workstream.id}
          milestones={plan}
          devLead={workstream.devLead}
          programLead={workstream.programLead}
        />
      </Card>

      <Card>
        <CardHeading
          title="Conversations"
          sub="What was said about this workstream, summarised — every point traceable to what it came from."
        />
        <Brief brief={brief} transcripts={myTranscripts} transcriptCount={myTranscripts.length} />
        <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
          <InitiativeSources
            entityValue={k}
            initiativeName={workstream.name}
            sources={mySources}
            transcriptCount={myTranscripts.length}
          />
        </div>
      </Card>

      <Card>
        <CardHeading
          title="Readiness"
          sub="The kick-off checklist, item by item. Required items that are not done are the only part anyone can act on."
        />
        {readiness.gates.length === 0 ? (
          <Empty>No lifecycle gates are loaded. Run `npm run seed:process`.</Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {readiness.gates.map((gate) => {
              const gateScore = scoreItems(readiness, workstream.id, gate.items)
              return (
                <div key={gate.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-semibold">{gate.name}</span>
                    {gate.items.length > 0 ? (
                      <>
                        <span className="w-[80px]">
                          <ProgressBar
                            value={gateScore.pct}
                            tone={gateScore.pct >= 80 ? 'green' : gateScore.pct >= 40 ? 'amber' : 'red'}
                          />
                        </span>
                        <Muted>
                          {gateScore.done}/{gateScore.total} required
                        </Muted>
                      </>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {gate.items.map((item) => {
                      const status = statusFor(readiness, workstream.id, item.id)
                      return (
                        <Chip
                          key={item.id}
                          tone={READINESS_TONE[status] ?? 'slate'}
                          title={`${item.label} — ${readinessStatusLabel(status)}${
                            item.required ? ' (required)' : ' (optional)'
                          }`}
                        >
                          {item.label}
                        </Chip>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="mt-2">
          <Link
            href={`/readiness/${workstream.id}`}
            className="text-[12px] underline decoration-dotted underline-offset-2"
          >
            Update the checklist →
          </Link>
        </div>
      </Card>

      <Card>
        <CardHeading title="Milestones" sub="Dated commitments under this workstream." />
        {workstream.milestones.length === 0 ? (
          <Empty>No milestones. For anything with an external commitment, that is itself a gap.</Empty>
        ) : (
          <div className="flex flex-col gap-1.5">
            {[...workstream.milestones]
              .sort(
                (a, b) => (a.targetDate?.getTime() ?? Infinity) - (b.targetDate?.getTime() ?? Infinity),
              )
              .map((m) => {
                const overdue = overdueIds.has(m.id)
                return (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12.5px]"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    <Pill tone={m.status === 'completed' ? 'green' : overdue ? 'red' : 'slate'}>
                      {m.status}
                    </Pill>
                    <span className="font-semibold">{m.name}</span>
                    <Muted>{fmt(m.targetDate)}</Muted>
                    {overdue ? <GapFlag title="Past its target date.">overdue</GapFlag> : null}
                  </div>
                )
              })}
          </div>
        )}
      </Card>

      <Card>
        <CardHeading
          title="Dependencies"
          sub="Split by direction, because waiting on someone and holding someone up are different problems."
        />
        {deps.length === 0 ? (
          <Empty>
            Nothing recorded. That usually means nobody has mapped them, not that there are none.
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {[
              { title: 'This is waiting on', rows: blocking },
              { title: 'This is holding up', rows: blockedBy },
            ]
              .filter((g) => g.rows.length > 0)
              .map((g) => (
                <div key={g.title}>
                  <div
                    className="text-[10px] font-bold uppercase tracking-[0.06em]"
                    style={{ color: 'var(--muted)' }}
                  >
                    {g.title}
                  </div>
                  <div className="mt-1 flex flex-col gap-1.5">
                    {g.rows.map((d) => (
                      <div
                        key={d.id}
                        className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12.5px]"
                        style={{ borderColor: 'var(--line)' }}
                      >
                        <Pill
                          tone={
                            d.status === 'resolved'
                              ? 'green'
                              : d.status === 'at_risk'
                                ? 'red'
                                : 'amber'
                          }
                        >
                          {d.status}
                        </Pill>
                        <span className="font-semibold">
                          {mine(d.fromType, d.fromId)
                            ? (d.toLabel ?? d.toId)
                            : (d.fromLabel ?? d.fromId)}
                        </span>
                        {d.dueDate ? <Muted>due {fmt(d.dueDate)}</Muted> : null}
                        {d.description ? <Muted>{d.description}</Muted> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
        <div className="mt-2">
          <Link
            href="/dependencies"
            className="text-[12px] underline decoration-dotted underline-offset-2"
          >
            Map another dependency →
          </Link>
        </div>
      </Card>

      <Card>
        <CardHeading title="Decisions" sub="What is stuck on this workstream." />
        {decisions.length === 0 ? (
          <Empty>Nothing in the register is linked to this workstream.</Empty>
        ) : (
          <div className="flex flex-col gap-1.5">
            {decisions.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12.5px]"
                style={{ borderColor: 'var(--line)' }}
              >
                <span
                  className="font-mono text-[11px] font-bold"
                  style={{ color: 'var(--brand-2)' }}
                >
                  {d.ref}
                </span>
                <Pill tone={DECISION_TONE[d.status] ?? 'slate'}>
                  {label('decisionStatus', d.status)}
                </Pill>
                {d.contested ? <GapFlag title="Two named parties disagree.">contested</GapFlag> : null}
                <span className="font-semibold">{d.title}</span>
                {d.dueBy ? <Muted>due {d.dueBy}</Muted> : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      {leadLoad ? (
        <Card>
          <CardHeading
            title="The lead's load"
            sub="What else this person is carrying. A workstream is only as safe as the attention available to it."
          />
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="font-semibold">{leadLoad.person.name}</span>
            {leadLoad.team ? <Chip tone="slate">{leadLoad.team.name}</Chip> : null}
            <Muted>
              leads {leadLoad.workstreams.length} in-flight workstream
              {leadLoad.workstreams.length === 1 ? '' : 's'}
              {leadLoad.initiativeCount > 1
                ? ` across ${leadLoad.initiativeCount} projects`
                : ''}
            </Muted>
            {leadLoad.collisions.length > 1 ? (
              <GapFlag
                title={`${leadLoad.collisions.length} workstreams with target dates inside the same 45-day window.`}
              >
                {leadLoad.collisions.length} dates collide
              </GapFlag>
            ) : null}
            {leadLoad.hot ? <Pill tone="red">bottleneck</Pill> : null}
          </div>
          {leadLoad.workstreams.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {leadLoad.workstreams
                .filter((other) => other.id !== workstream.id)
                .map((other) => (
                  <Link key={other.id} href={`/workstreams/${other.id}`}>
                    <Chip tone="slate">{other.name}</Chip>
                  </Link>
                ))}
            </div>
          ) : null}
          <div className="mt-2">
            <Link
              href="/contention"
              className="text-[12px] underline decoration-dotted underline-offset-2"
            >
              Everyone&apos;s load →
            </Link>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeading title="Provenance" sub="Where what you are reading came from." />
        <div className="flex flex-col gap-1 text-[12.5px]">
          <Muted>
            Delivery data last synced{' '}
            {p.lastSync?.startedAt
              ? formatDistanceToNowStrict(p.lastSync.startedAt, { addSuffix: true })
              : 'never'}
            {p.lastSync?.status ? ` (${p.lastSync.status})` : ''}.
          </Muted>
          <Muted>
            Health, readiness, decisions, dependencies and conversations are entered in this app
            and are never overwritten by a sync.
          </Muted>
          <Link href="/changes" className="underline decoration-dotted underline-offset-2">
            Everything that changed →
          </Link>
        </div>
      </Card>
    </div>
  )
}
