import Link from 'next/link'
import { getPortfolio, personLoads } from '@/lib/portfolio'
import { Card, CardHeading, Chip, Empty, Muted, Pill, Stat } from '@/components/ui'
import { label as vocab, type AllocationMode } from '@/lib/domain'
import { fmtDate } from '@/lib/util'

export const metadata = { title: 'Contention & people' }
export const dynamic = 'force-dynamic'

const MODE_TONE: Record<AllocationMode, 'blue' | 'amber' | 'red' | 'slate' | 'violet'> = {
  primary: 'blue',
  borrowed: 'amber',
  competing: 'red',
  frozen: 'slate',
  undefined: 'violet',
}

export default async function ContentionPage() {
  const p = await getPortfolio()
  const loads = personLoads(p)
  const hot = loads.filter((l) => l.hot)

  // Only show teams and initiatives that actually appear in the matrix —
  // an all-empty row teaches nothing and makes the real cells harder to find.
  const allocByTeam = new Map<string, Map<string, (typeof p.allocations)[number]>>()
  for (const a of p.allocations) {
    if (!allocByTeam.has(a.teamId)) allocByTeam.set(a.teamId, new Map())
    allocByTeam.get(a.teamId)!.set(a.initiativeId, a)
  }
  const teams = p.teams.filter((t) => allocByTeam.has(t.id))
  const initiativeIds = new Set(p.allocations.map((a) => a.initiativeId))
  const initiatives = p.initiatives.filter((i) => initiativeIds.has(i.id))

  const competing = p.allocations.filter((a) => a.mode === 'competing')
  const frozen = p.allocations.filter((a) => a.mode === 'frozen')

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat value={hot.length} label="People carrying colliding commitments" tone={hot.length ? 'red' : 'green'} />
        <Stat value={competing.length} label="Team/initiative pairs in open competition" tone={competing.length ? 'amber' : undefined} />
        <Stat value={frozen.length} label="Frozen allocations" sub="Capacity deliberately withheld" />
        <Stat
          value={p.teams.length - teams.length}
          label="Teams with no allocation recorded"
          tone={p.teams.length - teams.length ? 'amber' : undefined}
          sub="Their competing demands are invisible until someone fills this in."
        />
      </div>

      <Card>
        <CardHeading
          title="Named people spread across the portfolio"
          sub="Reconciled from project leads. Red means one person is the dependency for several dated things at once — the bottleneck a capacity total hides."
        />
        {loads.length === 0 ? (
          <Empty>No project leads assigned yet.</Empty>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {loads.map((l) => (
              <li
                key={l.person.id}
                className="flex items-start gap-3 rounded-lg border px-3 py-2.5"
                style={{
                  borderColor: l.hot
                    ? 'color-mix(in srgb, var(--red) 30%, var(--line))'
                    : 'var(--line)',
                  background: l.hot ? 'var(--red-bg)' : 'var(--raised)',
                }}
              >
                <span
                  className="w-8 shrink-0 text-center text-[17px] font-bold tabular-nums"
                  style={{ color: l.hot ? 'var(--red)' : 'var(--brand)' }}
                  title={`${l.projects.length} open projects led`}
                >
                  {l.projects.length}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[12.5px] font-semibold">{l.person.name}</span>
                    <Muted>{l.person.role ?? l.team?.name ?? ''}</Muted>
                    {l.person.bottleneck ? <Chip tone="red">flagged single point</Chip> : null}
                    {l.initiativeCount > 1 ? (
                      <Muted>across {l.initiativeCount} initiatives</Muted>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {l.projects.map((pr) => (
                      <Chip
                        key={pr.id}
                        tone={pr.health.rag === 'red' ? 'red' : pr.health.rag === 'amber' ? 'amber' : 'blue'}
                        title={`${vocab('projectStatus', pr.status)}${pr.targetDate ? ` · target ${fmtDate(pr.targetDate, { year: true })}` : ''}`}
                      >
                        {pr.name}
                        {pr.targetDate ? ` · ${fmtDate(pr.targetDate)}` : ''}
                      </Chip>
                    ))}
                  </div>
                  {l.collisions.length > 1 ? (
                    <p className="m-0 mt-1.5 text-[11.5px]" style={{ color: 'var(--red)' }}>
                      {l.collisions.length} commitments land within 45 days of each other:{' '}
                      {l.collisions.map((c) => `${c.name} (${fmtDate(c.targetDate)})`).join(', ')}.
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeading
          title="Who competes for whom"
          sub="Teams as rows, initiatives as columns. Read across a row to see what one team is being asked to do at once."
        />
        {teams.length === 0 ? (
          <Empty>No allocations recorded yet.</Empty>
        ) : (
          <>
            <div className="scroll-x">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ minWidth: 190 }}>Team / resource</th>
                    {initiatives.map((i) => (
                      <th key={i.id} className="text-center" style={{ minWidth: 120 }}>
                        {i.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teams.map((t) => {
                    const row = allocByTeam.get(t.id)!
                    const competingCount = [...row.values()].filter((a) => a.mode === 'competing').length
                    return (
                      <tr key={t.id}>
                        <th style={{ background: 'var(--raised)' }}>
                          <div className="font-semibold">{t.name}</div>
                          <Muted>
                            {t.headcount ? `${t.headcount} people` : 'headcount unknown'}
                            {competingCount ? ` · ${competingCount} competing` : ''}
                          </Muted>
                        </th>
                        {initiatives.map((i) => {
                          const cell = row.get(i.id)
                          if (!cell)
                            return (
                              <td key={i.id} className="text-center">
                                <Muted>·</Muted>
                              </td>
                            )
                          return (
                            <td key={i.id} className="text-center">
                              <Pill tone={MODE_TONE[cell.mode as AllocationMode] ?? 'slate'}>
                                {vocab('allocationMode', cell.mode)}
                              </Pill>
                              {cell.note ? (
                                <div className="mt-1 text-[10px]" style={{ color: 'var(--muted)' }}>
                                  {cell.note}
                                </div>
                              ) : null}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {(['primary', 'borrowed', 'competing', 'frozen', 'undefined'] as const).map((m) => (
                <Pill key={m} tone={MODE_TONE[m]}>
                  {vocab('allocationMode', m)}
                </Pill>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card tone="alert" className="full-only">
        <CardHeading title="Read this first" />
        <p className="m-0 text-[12.5px]">
          {hot.length > 0 ? (
            <>
              <strong>
                {hot
                  .slice(0, 3)
                  .map((h) => h.person.name)
                  .join(', ')}
              </strong>{' '}
              {hot.length === 1 ? 'is' : 'are'} the real cross-cutting constraint. Every
              &ldquo;can we also do X?&rdquo; is a withdrawal from{' '}
              {hot.length === 1 ? 'this person' : 'these people'}, not from a pool. A capacity
              total will not show you that — which is why this page counts named humans rather
              than engineer-weeks.
            </>
          ) : (
            'No single-threaded people detected from the current lead assignments. That is either good news or a sign that project leads are not filled in.'
          )}
        </p>
        <p className="m-0 mt-2 text-[12px]">
          <Link href="/prioritization" className="font-semibold hover:underline" style={{ color: 'var(--brand)' }}>
            Take this to prioritization →
          </Link>
        </p>
      </Card>
    </div>
  )
}
