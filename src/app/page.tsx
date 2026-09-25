import Link from 'next/link'
import { getPortfolio, gaps, personLoads, risks, upcomingMilestones } from '@/lib/portfolio'
import { Card, CardHeading, Chip, Empty, Muted, Pill, RagDot, SectionNote, Stat } from '@/components/ui'
import { isEnded, label as vocab } from '@/lib/domain'
import { getObservations, mostActive } from '@/lib/observations'
import { ActiveWorkCard } from '@/components/active-work'
import { fmtDate, relativeDays } from '@/lib/util'

export const dynamic = 'force-dynamic'

export default async function ControlRoom() {
  const [p, observations] = await Promise.all([getPortfolio(), getObservations()])
  const now = new Date()

  // Closed and withdrawn work is not "active" by any reading, and Yaara stopped
  // assessing it — so it would sit here on a stale score forever.
  const activeInitiatives = mostActive(
    observations,
    p.initiatives
      .filter((i) => !isEnded(i.status))
      .map((i) => ({ type: 'initiative' as const, id: i.id, name: i.name, status: i.status })),
  )
  const activeProjects = mostActive(
    observations,
    p.projects
      .filter((x) => !isEnded(x.status))
      .map((x) => ({ type: 'project' as const, id: x.id, name: x.name, status: x.status })),
  )

  const openProjects = p.projects.filter((x) => !isEnded(x.status))
  const allRisks = risks(p, now)
  const red = allRisks.filter((r) => r.rag === 'red')
  const allGaps = gaps(p, now)
  const loads = personLoads(p)
  const hot = loads.filter((l) => l.hot)
  const next = upcomingMilestones(p, 8, now)
  const contested = p.decisions.filter((d) => d.contested && d.status !== 'decided')
  const openDecisions = p.decisions.filter((d) => d.status === 'open')
  const liveDeps = p.dependencies.filter((d) => d.status !== 'resolved')
  const externalRisk = liveDeps.filter((d) => d.fromType === 'external' && d.status === 'at_risk')
  const noOwner = allGaps.filter((g) => g.kind === 'no_owner')
  const noAssessment = allGaps.filter((g) => g.kind === 'no_assessment')

  const nextDated = next.find((m) => m.status !== 'done')

  // A brand-new install has nothing to show, and should say so plainly rather
  // than rendering a wall of confident zeros.
  const isEmpty = p.initiatives.length === 0 && p.projects.length === 0

  // Group initiatives under the board narrative spine.
  const byTheme = p.themes.map((t) => ({
    theme: t,
    initiatives: p.initiatives.filter((i) => i.themeId === t.id),
  }))
  const untheme = p.initiatives.filter((i) => !i.themeId)

  // Until a sync has run, every number on this page comes from a hand-entered
  // snapshot. Saying so at the top costs one line and prevents the single worst
  // failure mode of an internal dashboard: someone quoting a stale figure in a
  // meeting because the screen looked authoritative.
  return (
    <div className="flex flex-col gap-4">
      {isEmpty ? (
        <SectionNote tone="blue">
          <strong>Nothing in the portfolio yet.</strong> That is the intended starting state.
          Connect your tracker with <code>npm run sync:linear</code> to bring in initiatives,
          projects and dates, then enter the things no tracker holds — health assessments,
          decisions, dependencies and contention. To explore the screens with example content
          first, run <code>npm run seed:demo</code>.
        </SectionNote>
      ) : !p.lastSync ? (
        <SectionNote tone="blue">
          <strong>No sync has run yet.</strong> Everything below was entered by hand or loaded
          from a seed, so dates and statuses are only as current as whoever last typed them.
          Run <code>npm run sync:linear</code> to let your tracker own the delivery layer.
        </SectionNote>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          value={nextDated ? fmtDate(nextDated.targetDate) : '—'}
          label={nextDated ? nextDated.name : 'No dated commitments ahead'}
          tone={nextDated?.contested ? 'red' : undefined}
          sub={nextDated ? `${nextDated.project.name} · ${relativeDays(nextDated.targetDate)}` : undefined}
        />
        <Stat
          value={red.length}
          label="Assessed red right now"
          tone={red.length ? 'red' : 'green'}
          sub={red.length ? red[0].name : 'Nothing in trouble'}
        />
        <Stat
          value={hot.length}
          label="People carrying colliding commitments"
          tone={hot.length ? 'amber' : undefined}
          sub={hot.length ? hot.map((h) => h.person.name).slice(0, 3).join(', ') : undefined}
        />
        <Stat
          value={noOwner.length + noAssessment.length}
          label="Things nobody has answered for"
          tone={noOwner.length + noAssessment.length ? 'amber' : 'green'}
          sub="No owner, or no health on record"
        />
      </div>

      {/* What is moving, first. Written by Yaara during her assessment passes
          and ordered by a count she made, not one this page derives — deriving
          it here would disagree with whatever she says in Slack, which is the
          same question asked through a different door. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ActiveWorkCard
          title="Active initiatives"
          sub="Most movement first, with what actually happened underneath."
          work={activeInitiatives}
          href="/initiatives"
          hrefLabel="All initiatives"
        />
        <ActiveWorkCard
          title="Active projects"
          sub="Most movement first, with what actually happened underneath."
          work={activeProjects}
          href="/projects"
          hrefLabel="All projects"
        />
      </div>

      <Card>
        <CardHeading
          title="Driving the calendar"
          sub="Dated commitments in order. Red means contested, externally committed, or already passed."
          right={
            <Link href="/roadmap" className="btn no-print">
              Timeline
            </Link>
          }
        />
        {next.length === 0 ? (
          <Empty>No dated milestones recorded.</Empty>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {next.map((m) => {
              const overdue = m.status === 'pending' && m.targetDate! < now
              const risky = overdue || m.contested
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-[12.5px]"
                  style={{
                    borderColor: risky
                      ? 'color-mix(in srgb, var(--red) 30%, var(--line))'
                      : 'var(--line)',
                    background: risky ? 'var(--red-bg)' : 'var(--raised)',
                  }}
                >
                  <span
                    className="w-[92px] shrink-0 font-bold"
                    style={{ color: risky ? 'var(--red)' : 'var(--brand)' }}
                  >
                    {fmtDate(m.targetDate, { year: true })}
                  </span>
                  <span className="font-semibold">{m.name}</span>
                  <Muted>{m.project.name}</Muted>
                  <span className="ml-auto flex items-center gap-1.5">
                    {m.contested ? <Chip tone="red">contested</Chip> : null}
                    {overdue ? <Chip tone="red">overdue</Chip> : null}
                    {m.status === 'done' ? <Chip tone="green">done</Chip> : null}
                    <Muted>{relativeDays(m.targetDate)}</Muted>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeading
          title="Executive rollup"
          sub="Initiatives under the board narrative. Health is assessed by the program team — hover any badge for the reasoning and its evidence."
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {byTheme.map(({ theme, initiatives }) => (
            <div
              key={theme.id}
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: 'var(--line)' }}
            >
              <div
                className="px-3.5 py-2.5 text-[13.5px] font-bold text-white"
                style={{ background: theme.color ?? 'var(--brand)' }}
              >
                {theme.name}
              </div>
              <div className="px-3.5 py-2">
                {initiatives.length === 0 ? (
                  <Muted>No initiatives.</Muted>
                ) : (
                  initiatives.map((i) => (
                    <div
                      key={i.id}
                      className="flex items-start justify-between gap-2 border-b py-1.5 last:border-b-0"
                      style={{ borderColor: 'var(--line)', borderBottomStyle: 'dashed' }}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                          <RagDot rag={i.health.rag} />
                          <Link href="/initiatives" className="truncate hover:underline">
                            {i.name}
                          </Link>
                        </div>
                        {i.health.rationale ? (
                          <p
                            className="m-0 mt-0.5 line-clamp-2 text-[10.5px]"
                            style={{ color: 'var(--muted)' }}
                          >
                            {i.health.rationale}
                          </p>
                        ) : null}
                      </div>
                      {!i.ownerId ? <Chip tone="violet">no owner</Chip> : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
        {untheme.length > 0 ? (
          <p className="m-0 mt-3 text-[12px]" style={{ color: 'var(--muted)' }}>
            Not mapped to a theme: {untheme.map((i) => i.name).join(', ')}.
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="full-only">
          <CardHeading
            title="Open decisions"
            sub="The highest-value screen in a program review, and no upstream tool holds it."
            right={
              <Link href="/decisions" className="btn no-print">
                All decisions
              </Link>
            }
          />
          {openDecisions.length === 0 ? (
            <Empty>Nothing open.</Empty>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12.5px]">
              {openDecisions.slice(0, 6).map((d) => (
                <li key={d.id} className="flex items-baseline gap-2">
                  <Chip tone={d.contested ? 'red' : 'amber'}>{d.ref}</Chip>
                  <span className="font-semibold">{d.title}</span>
                  <Muted>
                    {d.ownerText ?? '—'}
                    {d.dueBy ? ` · ${d.dueBy}` : ''}
                  </Muted>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="full-only">
          <CardHeading
            title="Portfolio at a glance"
            sub="Counts, so the shape of the thing is visible without clicking through."
          />
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px]">
            <Row label="Initiatives" value={p.initiatives.length} />
            <Row label="Projects in flight or planned" value={openProjects.length} />
            <Row label="Live dependencies" value={liveDeps.length} />
            <Row label="Open decisions" value={openDecisions.length} />
            <Row label="Teams" value={p.teams.length} />
            <Row label="People with assignments" value={loads.length} />
          </div>
          <p className="m-0 mt-3 text-[11.5px]" style={{ color: 'var(--muted)' }}>
            Last sync:{' '}
            {p.lastSync ? (
              <>
                {vocab('sourceSystem', p.lastSync.system)} · {p.lastSync.status} ·{' '}
                {fmtDate(p.lastSync.startedAt, { year: true })}
              </>
            ) : (
              'never — nothing has been synced from a tracker yet.'
            )}
          </p>
        </Card>
      </div>
      {/* Moved to the bottom.
          Both of these are real and neither has changed. But a front page that
          opens with what is wrong is one people stop opening, and the squeeze
          in particular is a standing condition rather than news — it reads the
          same on the day it appears and ninety days later. What is moving goes
          first; what is stuck is still one scroll away. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card tone="alert">
          <CardHeading
            title="The core squeeze"
            sub="Not a capacity total — the named people every dated commitment routes through."
          />
          {hot.length === 0 ? (
            <Empty>No single-threaded people detected.</Empty>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {hot.slice(0, 3).map((l) => (
                <li
                  key={l.person.id}
                  className="flex items-start gap-3 rounded-lg border px-3 py-2"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--red) 30%, var(--line))',
                    background: 'var(--raised)',
                  }}
                >
                  <span
                    className="w-7 shrink-0 text-center text-[17px] font-bold"
                    style={{ color: 'var(--red)' }}
                  >
                    {l.projects.length}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold">
                      {l.person.name}{' '}
                      <Muted>· {l.person.role ?? l.team?.name ?? ''}</Muted>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {l.projects.slice(0, 6).map((pr) => (
                        <Chip key={pr.id} tone={pr.health.rag === 'red' ? 'red' : 'blue'}>
                          {pr.name}
                          {pr.targetDate ? ` · ${fmtDate(pr.targetDate)}` : ''}
                        </Chip>
                      ))}
                    </div>
                    {l.collisions.length > 1 ? (
                      <p className="m-0 mt-1 text-[11.5px]" style={{ color: 'var(--red)' }}>
                        {l.collisions.length} of these land within 45 days of each other.
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 mt-2.5 text-[12px]">
            <Link href="/contention" className="font-semibold hover:underline" style={{ color: 'var(--brand)' }}>
              {hot.length > 3 ? `See all ${hot.length} →` : 'Full contention view →'}
            </Link>
          </p>
        </Card>

        <Card>
          <CardHeading
            title="Biggest holes and conflicts"
            sub="Absence, stated plainly. These are the items that look fine on a roadmap and are not."
          />
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[12.5px]">
            {contested.length > 0 ? (
              <Hole tone="red" label={`${contested.length} contested decision${contested.length === 1 ? '' : 's'}`} href="/decisions?status=open">
                Two named parties actively disagree: {contested.map((d) => d.ref).join(', ')}.
              </Hole>
            ) : null}
            {externalRisk.length > 0 ? (
              <Hole tone="red" label={`${externalRisk.length} external blocker${externalRisk.length === 1 ? '' : 's'} at risk`} href="/dependencies">
                {externalRisk.map((d) => d.fromLabel).filter(Boolean).join(', ')} — outside the
                portfolio, so reprioritising will not fix them.
              </Hole>
            ) : null}
            {noOwner.length > 0 ? (
              <Hole tone="violet" label={`${noOwner.length} initiative${noOwner.length === 1 ? '' : 's'} with no owner`} href="/initiatives">
                {noOwner.map((g) => g.name).join(', ')}.
              </Hole>
            ) : null}
            {noAssessment.length > 0 ? (
              <Hole tone="amber" label={`${noAssessment.length} item${noAssessment.length === 1 ? '' : 's'} with no health on record`} href="/applications">
                Neither a source value nor an assessment. Reads as unknown rather than green, on
                purpose.
              </Hole>
            ) : null}
            {allGaps.filter((g) => g.kind === 'no_projects').length > 0 ? (
              <Hole tone="slate" label="Strategic initiatives with nothing in delivery" href="/initiatives">
                {allGaps.filter((g) => g.kind === 'no_projects').map((g) => g.name).join(', ')}.
              </Hole>
            ) : null}
            {allGaps.filter((g) => g.kind === 'stale_assessment').length > 0 ? (
              <Hole tone="amber" label="Stale assessments" href="/initiatives">
                {allGaps
                  .filter((g) => g.kind === 'stale_assessment')
                  .map((g) => `${g.name} (${g.detail.replace('Assessment is ', '').replace(' old', '')})`)
                  .join(', ')}
                .
              </Hole>
            ) : null}
            {contested.length + externalRisk.length + allGaps.length === 0 ? (
              <Empty>Nothing outstanding. Unusual — worth double-checking the assessments are current.</Empty>
            ) : null}
          </ul>
        </Card>
      </div>

    </div>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="text-right font-semibold tabular-nums">{value}</span>
    </>
  )
}

function Hole({
  tone,
  label,
  href,
  children,
}: {
  tone: 'red' | 'amber' | 'violet' | 'slate'
  label: string
  href: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-2">
      <Pill tone={tone}>{label}</Pill>
      <span className="min-w-0">
        <Link href={href} className="hover:underline">
          {children}
        </Link>
      </span>
    </li>
  )
}
