import { db } from '@/db/client'
import { settings as settingsTable } from '@/db/schema'
import { getPortfolio, risks } from '@/lib/portfolio'
import { buildTimeline, horizonFor } from '@/lib/timeline'
import { Timeline, TimelineLegend, KeyDateStrip } from '@/components/timeline'
import { Card, CardHeading, Empty, Muted, Stat } from '@/components/ui'
import { fmtDate } from '@/lib/util'

export const metadata = { title: 'Timeline' }
export const dynamic = 'force-dynamic'

type Search = { theme?: string; risk?: string }

export default async function RoadmapPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const { theme, risk } = await searchParams
  const portfolio = await getPortfolio()
  const settingRows = await db.select().from(settingsTable)
  const setting = (k: string) => settingRows.find((s) => s.key === k)?.value ?? null

  let initiatives = portfolio.initiatives
  if (theme) initiatives = initiatives.filter((i) => i.theme?.key === theme)
  if (risk === '1') initiatives = initiatives.filter((i) => i.health.rag === 'red' || i.health.rag === 'amber')

  const horizon = horizonFor(portfolio, {
    start: setting('portfolio.horizonStart'),
    end: setting('portfolio.horizonEnd'),
  })
  const model = buildTimeline(portfolio, { ...horizon, initiatives })

  const open = portfolio.projects.filter(
    (p) => !['completed', 'canceled'].includes(p.status),
  )
  const undated = open.filter((p) => !p.startDate && !p.targetDate)
  const nextMilestone = model.keyDates.find((k) => k.milestone.status !== 'done')
  const atRisk = risks(portfolio).filter((r) => r.rag === 'red')

  const themeHref = (key?: string) => {
    const params = new URLSearchParams()
    if (key) params.set('theme', key)
    if (risk === '1') params.set('risk', '1')
    const qs = params.toString()
    return qs ? `/roadmap?${qs}` : '/roadmap'
  }
  const riskHref = () => {
    const params = new URLSearchParams()
    if (theme) params.set('theme', theme)
    if (risk !== '1') params.set('risk', '1')
    const qs = params.toString()
    return qs ? `/roadmap?${qs}` : '/roadmap'
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat value={open.length} label="Projects in flight or planned" />
        <Stat
          value={nextMilestone ? fmtDate(nextMilestone.milestone.targetDate) : '—'}
          label={nextMilestone ? nextMilestone.milestone.name : 'No dated commitments ahead'}
          tone={nextMilestone?.overdue || nextMilestone?.milestone.contested ? 'red' : undefined}
        />
        <Stat value={atRisk.length} label="Items assessed red" tone={atRisk.length ? 'red' : 'green'} />
        <Stat
          value={undated.length}
          label="Open projects with no dates at all"
          tone={undated.length ? 'amber' : undefined}
          sub={undated.length ? 'They cannot be planned against or drawn below.' : undefined}
        />
      </div>

      <Card>
        <CardHeading
          title="Initiative and project timeline"
          sub={
            <>
              {fmtDate(model.start, { year: true })} → {fmtDate(model.end, { year: true })}. One lane
              per initiative; each bar is a project, coloured by assessed health. Diamonds are
              milestones. Click a bar for that project&rsquo;s kick-off readiness.
            </>
          }
          right={
            <div className="no-print flex flex-wrap items-center gap-1.5">
              <FilterLink href={themeHref()} active={!theme}>
                All themes
              </FilterLink>
              {portfolio.themes.map((t) => (
                <FilterLink key={t.id} href={themeHref(t.key)} active={theme === t.key}>
                  {t.name}
                </FilterLink>
              ))}
              <FilterLink href={riskHref()} active={risk === '1'}>
                Only at risk
              </FilterLink>
            </div>
          }
        />
        <TimelineLegend />
        {model.lanes.length === 0 ? (
          <Empty>No initiatives match this filter.</Empty>
        ) : (
          <Timeline model={model} />
        )}
      </Card>

      <Card>
        <CardHeading
          title="Dated commitments"
          sub="Milestones marked portfolio-level. Red means the date is contested, externally committed, or already passed while the milestone is still open."
        />
        <KeyDateStrip model={model} />
      </Card>

      {undated.length > 0 ? (
        <Card tone="alert">
          <CardHeading
            title="Open work with no dates"
            sub="These cannot appear on the timeline. Either they are genuinely unscheduled, or someone owes a date."
          />
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {undated.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="font-semibold">{p.name}</span>
                <Muted>
                  {p.initiativeId ? '' : 'no initiative · '}
                  {p.lead ? p.lead.name : 'no lead'}
                </Muted>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      className="rounded-full border px-2.5 py-1 text-[11.5px] font-semibold"
      style={{
        background: active ? 'var(--brand)' : 'var(--surface)',
        color: active ? '#fff' : 'var(--muted)',
        borderColor: active ? 'var(--brand)' : 'var(--line)',
      }}
    >
      {children}
    </a>
  )
}
