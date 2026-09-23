/**
 * Everything about one initiative, on one page.
 *
 * The rest of the app is organised by question — what is stuck, who is
 * overloaded, what blocks what. That is right for a review, and wrong for the
 * moment someone asks "so where is Ratings Modernisation actually at?" and has
 * to open six tabs and hold the answer in their head.
 *
 * So this page is organised by subject. Nothing here is newly computed: every
 * section is the same read model the dedicated screen uses, filtered to this
 * initiative and its projects. If a number here disagrees with the number
 * there, that is a bug, not a different opinion.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDistanceToNowStrict } from 'date-fns'
import { Brief } from '@/components/brief'
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
import { getBriefs, getSources, getTranscripts } from '@/lib/briefs'
import { getPortfolio, personLoads, type ProjectView } from '@/lib/portfolio'
import { getReadiness, scoreItems } from '@/lib/readiness'
import { getScoringContext, scoreForRequest } from '@/lib/scoring'
import { db } from '@/db/client'
import { intakeRequests } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { InitiativeSources } from './sources-panel'

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

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const p = await getPortfolio()
  const i = p.initiatives.find((x) => x.id === id)
  return { title: i ? `${i.name} · MR Portfolio Control` : 'Initiative' }
}

export default async function InitiativePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [p, readiness, scoring, sources, transcripts, briefs] = await Promise.all([
    getPortfolio(),
    getReadiness(),
    getScoringContext(),
    getSources(),
    getTranscripts(),
    getBriefs(),
  ])

  const i = p.initiatives.find((x) => x.id === id)
  if (!i) notFound()

  const projectIds = new Set(i.projects.map((pr) => pr.id))

  // An endpoint belongs to this initiative if it IS the initiative, one of its
  // projects, or a milestone of one of those projects. Anything else is
  // somebody else's problem and does not belong on this page.
  const milestoneIds = new Set(
    p.milestones.filter((m) => projectIds.has(m.project.id)).map((m) => m.id),
  )
  const mine = (type: string, entityId: string) =>
    (type === 'initiative' && entityId === i.id) ||
    (type === 'project' && projectIds.has(entityId)) ||
    (type === 'milestone' && milestoneIds.has(entityId))

  const deps = p.dependencies.filter(
    (d) => mine(d.fromType, d.fromId) || mine(d.toType, d.toId),
  )
  const openDeps = deps.filter((d) => d.status !== 'resolved' && d.status !== 'dropped')

  const decisions = p.decisions.filter((d) => d.entityType && d.entityId && mine(d.entityType, d.entityId))
  const openDecisions = decisions.filter((d) => d.status === 'open' || d.status === 'watch')

  // Readiness across the initiative: the union of its projects' required items.
  const perProject = i.projects.map((pr) => ({
    project: pr,
    score: scoreItems(readiness, pr.id, readiness.items),
  }))
  const readinessDone = perProject.reduce((n, r) => n + r.score.done, 0)
  const readinessTotal = perProject.reduce((n, r) => n + r.score.total, 0)
  const readinessPct = readinessTotal === 0 ? null : Math.round((readinessDone / readinessTotal) * 100)

  // People who lead work under this initiative, with the load they carry
  // everywhere else — which is the number that actually predicts slippage.
  const loads = personLoads(p).filter((l) => l.projects.some((pr) => projectIds.has(pr.id)))
  const stretched = loads.filter((l) => l.hot || l.collisions.length > 1)

  // Intake requests proposed against this initiative, scored. This is the only
  // honest "priority" an initiative has: the tool scores requests, not
  // initiatives, and inventing an initiative-level score would be a number
  // nobody set.
  const requests = await db
    .select()
    .from(intakeRequests)
    .where(eq(intakeRequests.proposedInitiativeId, i.id))
  const scored = requests
    .map((r) => ({ request: r, score: scoreForRequest(scoring, r.id) }))
    .sort((a, b) => (b.score.score ?? 0) - (a.score.score ?? 0))

  const k = `initiative:${i.id}`
  const myTranscripts = transcripts.get(k) ?? []
  const mySources = sources.get(k) ?? []
  const brief = briefs.get(k) ?? null

  // Conversations attached to the projects underneath, so the page does not
  // claim there is nothing when the material is one level down.
  const projectConversations = i.projects.flatMap((pr) => transcripts.get(`project:${pr.id}`) ?? [])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/initiatives" className="text-[12px] underline decoration-dotted underline-offset-2">
          ← All initiatives
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Kicker>{i.theme?.name ?? 'No theme'}</Kicker>
          <Pill tone="slate">{i.status}</Pill>
          {i.sources.map((s) => (
            <SourceBadge key={s.system} system={s.system} url={s.url} />
          ))}
        </div>
        <h2 className="m-0 mt-0.5 text-[20px] font-bold tracking-[-0.01em]">{i.name}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
          <HealthBadge health={i.health} />
          <span>
            <Muted>Owner</Muted>{' '}
            {i.owner ? (
              <span className="font-semibold">{i.owner.name}</span>
            ) : (
              <GapFlag title="Nobody owns this initiative.">unowned</GapFlag>
            )}
          </span>
          {i.sponsor ? (
            <span>
              <Muted>Sponsor</Muted> <span className="font-semibold">{i.sponsor.name}</span>
            </span>
          ) : null}
          <span>
            <Muted>Window</Muted>{' '}
            <span className="font-semibold">
              {fmt(i.startDate ?? i.derivedStart)} → {fmt(i.targetDate ?? i.derivedTarget)}
            </span>
            {!i.targetDate && i.derivedTarget ? <Muted> (rolled up from projects)</Muted> : null}
          </span>
        </div>
        {i.overridden.length > 0 ? (
          <div className="mt-2">
            <OverrideBadge fields={i.overridden} />
          </div>
        ) : null}
        {i.notes ? (
          <p className="m-0 mt-2 max-w-[760px] text-[12.5px] leading-relaxed">{i.notes}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat value={i.projects.length} label="Projects" />
        <Stat
          value={readinessPct === null ? '—' : `${readinessPct}%`}
          label="Readiness"
          tone={readinessPct === null ? 'slate' : readinessPct >= 80 ? 'green' : 'amber'}
        />
        <Stat value={openDeps.length} label="Open dependencies" tone={openDeps.length ? 'amber' : 'green'} />
        <Stat value={openDecisions.length} label="Open decisions" tone={openDecisions.length ? 'red' : 'green'} />
        <Stat value={stretched.length} label="People stretched" tone={stretched.length ? 'amber' : 'green'} />
        <Stat value={myTranscripts.length + projectConversations.length} label="Conversations" />
      </div>

      {i.projects.length === 0 ? (
        <SectionNote tone="violet">
          Nothing is in delivery against this initiative. That is a statement about the plan, not
          a missing row.
        </SectionNote>
      ) : null}

      {/* Conversations first: it is the newest information on the page, and
          the one thing here that is not already visible somewhere else. */}
      <Card>
        <CardHeading
          title="Conversations"
          sub="What was said about this, summarised — every point traceable to the transcript it came from."
        />
        <Brief
          brief={brief}
          transcripts={myTranscripts}
          transcriptCount={myTranscripts.length}
        />
        {projectConversations.length > 0 ? (
          <div className="mt-2">
            <Muted>
              {projectConversations.length} further conversation
              {projectConversations.length === 1 ? '' : 's'} attached to individual projects —
              see <Link href="/sources" className="underline decoration-dotted underline-offset-2">Conversations</Link>.
            </Muted>
          </div>
        ) : null}
        <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
          <InitiativeSources
            entityValue={k}
            initiativeName={i.name}
            sources={mySources}
            transcriptCount={myTranscripts.length}
          />
        </div>
      </Card>

      {i.projects.length > 0 ? (
        <Card>
          <CardHeading title="Projects" sub="Health as assessed, and how much of the kick-off checklist each one has actually done." />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left" style={{ color: 'var(--muted)' }}>
                  <th className="py-1.5 pr-3 font-semibold">Project</th>
                  <th className="py-1.5 pr-3 font-semibold">Health</th>
                  <th className="py-1.5 pr-3 font-semibold">Lead</th>
                  <th className="py-1.5 pr-3 font-semibold">Target</th>
                  <th className="py-1.5 pr-3 font-semibold">Readiness</th>
                </tr>
              </thead>
              <tbody>
                {perProject.map(({ project, score }) => (
                  <tr key={project.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                    <td className="py-2 pr-3 font-semibold">
                      <Link
                        href={`/projects/${project.id}`}
                        className="underline decoration-dotted underline-offset-2"
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      <HealthBadge health={project.health} showOrigin={false} />
                    </td>
                    <td className="py-2 pr-3">
                      {project.lead?.name ?? <GapFlag title="No lead named.">none</GapFlag>}
                    </td>
                    <td className="py-2 pr-3">{fmt(project.targetDate)}</td>
                    <td className="py-2 pr-3">
                      {score.total === 0 ? (
                        <Muted>nothing required</Muted>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="w-[90px]">
                            <ProgressBar
                              value={score.pct}
                              tone={score.pct >= 80 ? 'green' : score.pct >= 40 ? 'amber' : 'red'}
                            />
                          </span>
                          <Muted>
                            {score.done}/{score.total}
                          </Muted>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeading
          title="Dependencies"
          sub="Anything that has to be true first, or that is waiting on this."
        />
        {deps.length === 0 ? (
          <Empty>Nothing recorded. That usually means nobody has mapped them yet, not that there are none.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {deps.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-[12.5px]"
                style={{ borderColor: 'var(--line)' }}
              >
                <Pill tone={d.status === 'resolved' ? 'green' : d.status === 'at_risk' ? 'red' : 'amber'}>
                  {d.status}
                </Pill>
                <Chip tone="slate">{d.kind}</Chip>
                <span>
                  <span className="font-semibold">{d.fromLabel ?? d.fromId}</span>
                  <Muted> blocks </Muted>
                  <span className="font-semibold">{d.toLabel ?? d.toId}</span>
                </span>
                {d.dueDate ? <Muted>due {fmt(d.dueDate)}</Muted> : null}
                {d.description ? <Muted>{d.description}</Muted> : null}
              </div>
            ))}
          </div>
        )}
        <div className="mt-2">
          <Link href="/dependencies" className="text-[12px] underline decoration-dotted underline-offset-2">
            Map another dependency →
          </Link>
        </div>
      </Card>

      <Card>
        <CardHeading title="Decisions" sub="What is stuck on this and who owes the answer." />
        {decisions.length === 0 ? (
          <Empty>Nothing in the register is linked to this initiative.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {decisions.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-[12.5px]"
                style={{ borderColor: 'var(--line)' }}
              >
                <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--brand-2)' }}>
                  {d.ref}
                </span>
                <Pill tone={DECISION_TONE[d.status] ?? 'slate'}>{label('decisionStatus', d.status)}</Pill>
                {d.contested ? <GapFlag title="Two named parties disagree.">contested</GapFlag> : null}
                <span className="font-semibold">{d.title}</span>
                {d.dueBy ? <Muted>due {d.dueBy}</Muted> : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeading
          title="People"
          sub="Who is leading work here, and what else they are carrying elsewhere."
        />
        {loads.length === 0 ? (
          <Empty>No leads are named on any project under this initiative.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {loads.map((l) => {
              const here = l.projects.filter((pr: ProjectView) => projectIds.has(pr.id))
              const elsewhere = l.projects.length - here.length
              return (
                <div
                  key={l.person.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-[12.5px]"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <span className="font-semibold">{l.person.name}</span>
                  {l.team ? <Chip tone="slate">{l.team.name}</Chip> : null}
                  <Muted>
                    {here.length} here
                    {elsewhere > 0 ? `, ${elsewhere} elsewhere` : ''}
                    {l.initiativeCount > 1 ? ` · across ${l.initiativeCount} initiatives` : ''}
                  </Muted>
                  {l.collisions.length > 1 ? (
                    <GapFlag
                      title={`${l.collisions.length} projects with target dates inside the same 45-day window.`}
                    >
                      {l.collisions.length} dates collide
                    </GapFlag>
                  ) : null}
                  {l.hot ? <Pill tone="red">bottleneck</Pill> : null}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {scored.length > 0 ? (
        <Card>
          <CardHeading
            title="Prioritization"
            sub="Intake requests proposed against this initiative, with their weighted scores."
          />
          <div className="flex flex-col gap-2">
            {scored.map(({ request, score }) => (
              <div
                key={request.id}
                className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-[12.5px]"
                style={{ borderColor: 'var(--line)' }}
              >
                <Pill tone="slate">{request.status}</Pill>
                <span className="font-semibold">{request.title}</span>
                {score.score === null ? (
                  <GapFlag title="Nobody has scored this request yet.">unscored</GapFlag>
                ) : (
                  <Muted>
                    score {score.score.toFixed(1)}
                    {score.scored < score.total
                      ? ` · ${score.total - score.scored} of ${score.total} criteria unscored`
                      : ''}
                  </Muted>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2">
            <Link href="/prioritization" className="text-[12px] underline decoration-dotted underline-offset-2">
              Full scoring table →
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
            Health, decisions, dependencies and conversations are entered in this app and are
            never overwritten by a sync.
          </Muted>
          <Link href="/changes" className="underline decoration-dotted underline-offset-2">
            Everything that changed →
          </Link>
        </div>
      </Card>
    </div>
  )
}
