import { getPortfolio, labelForEndpoint } from '@/lib/portfolio'
import { buildGraph, teamDependencyMatrix } from '@/lib/graph'
import { DependencyGraphView, GraphLegend } from '@/components/dep-graph'
import { Card, CardHeading, Chip, Empty, Muted, Pill, SectionNote, Stat } from '@/components/ui'
import { label as vocab } from '@/lib/domain'
import { fmtDate, relativeDays } from '@/lib/util'
import { DependencyForm, type EndpointOption } from './dependency-form'
import { deleteDependency, setDependencyStatus } from './actions'

export const metadata = { title: 'Dependencies' }
export const dynamic = 'force-dynamic'

const STATUS_TONE = {
  open: 'amber',
  at_risk: 'red',
  resolved: 'green',
  accepted_risk: 'slate',
} as const

export default async function DependenciesPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>
}) {
  const { all } = await searchParams
  const includeResolved = all === '1'
  const portfolio = await getPortfolio()
  const graph = buildGraph(portfolio, { includeResolved })

  const nodeLabel = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id

  const endpointOptions: EndpointOption[] = [
    ...portfolio.projects
      .filter((p) => !['completed', 'canceled'].includes(p.status))
      .map((p) => ({ value: `project:${p.id}`, label: p.name, group: 'Projects' })),
    ...portfolio.initiatives.map((i) => ({
      value: `initiative:${i.id}`,
      label: i.name,
      group: 'Initiatives',
    })),
    ...portfolio.milestones
      .filter((m) => m.status !== 'done')
      .map((m) => ({
        value: `milestone:${m.id}`,
        label: `${m.project.name} — ${m.name}`,
        group: 'Milestones',
      })),
  ]

  const live = portfolio.dependencies.filter((d) => d.status !== 'resolved')
  const atRisk = live.filter((d) => d.status === 'at_risk')
  const criticalOpen = live.filter((d) => d.criticality === 'critical')
  const externalBlockers = live.filter((d) => d.fromType === 'external')

  const teamMatrix = teamDependencyMatrix(portfolio)
  const teamsWithEdges = portfolio.teams.filter((t) =>
    [...teamMatrix.keys()].some((k) => k.startsWith(`${t.id}|`) || k.endsWith(`|${t.id}`)),
  )

  const sorted = [...portfolio.dependencies].sort((a, b) => {
    const rank = { at_risk: 0, open: 1, accepted_risk: 2, resolved: 3 } as Record<string, number>
    const r = (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
    if (r !== 0) return r
    const ad = a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER
    const bd = b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER
    return ad - bd
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat value={live.length} label="Live dependencies" />
        <Stat value={atRisk.length} label="At risk" tone={atRisk.length ? 'red' : 'green'} />
        <Stat
          value={criticalOpen.length}
          label="Open and critical"
          tone={criticalOpen.length ? 'red' : undefined}
        />
        <Stat
          value={externalBlockers.length}
          label="Blocked by something outside the portfolio"
          tone={externalBlockers.length ? 'amber' : undefined}
          sub={externalBlockers.length ? 'The ones you cannot fix by reprioritising.' : undefined}
        />
      </div>

      <Card>
        <CardHeading
          title="What has to be true first"
          sub="Every unresolved dependency, laid out as a chain. The heavy outline is the longest unresolved run — if the leftmost node slips, everything behind it moves."
          right={
            <a
              href={includeResolved ? '/dependencies' : '/dependencies?all=1'}
              className="btn no-print"
            >
              {includeResolved ? 'Hide resolved' : 'Show resolved'}
            </a>
          }
        />
        <GraphLegend />
        {graph.brokenCycles.length > 0 ? (
          <SectionNote tone="violet">
            {graph.brokenCycles.length} circular dependenc
            {graph.brokenCycles.length === 1 ? 'y' : 'ies'} detected and drawn with one edge
            reversed:{' '}
            {graph.brokenCycles
              .map((c) => `${nodeLabel(c.from)} ⇄ ${nodeLabel(c.to)}`)
              .join('; ')}
            . Two things waiting on each other will not resolve on their own.
          </SectionNote>
        ) : null}
        <DependencyGraphView graph={graph} />

        {graph.criticalPath.length > 1 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="font-semibold">Critical chain:</span>
            {graph.criticalPath.map((id, i) => (
              <span key={id} className="inline-flex items-center gap-1.5">
                {i > 0 ? <span style={{ color: 'var(--muted)' }}>→</span> : null}
                <Chip tone={i === 0 ? 'red' : 'blue'}>{nodeLabel(id)}</Chip>
              </span>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeading
          title="Dependency register"
          sub="The same edges as a list, sorted by urgency. Status changes are logged to What changed."
        />
        {sorted.length === 0 ? (
          <Empty>Nothing recorded yet. Add the first one below.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="grid">
              <thead>
                <tr>
                  <th>Blocker</th>
                  <th>Blocks</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Criticality</th>
                  <th>Needed by</th>
                  <th>Detail</th>
                  <th className="full-only no-print">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => (
                  <tr key={d.id} style={{ opacity: d.status === 'resolved' ? 0.55 : 1 }}>
                    <td className="font-semibold">
                      {d.fromLabel ?? labelForEndpoint(portfolio, d.fromType, d.fromId)}
                      {d.fromType === 'external' ? (
                        <div>
                          <Chip tone="violet">outside portfolio</Chip>
                        </div>
                      ) : null}
                    </td>
                    <td>{d.toLabel ?? labelForEndpoint(portfolio, d.toType, d.toId)}</td>
                    <td>
                      <Muted>{vocab('dependencyKind', d.kind)}</Muted>
                    </td>
                    <td>
                      <Pill tone={STATUS_TONE[d.status as keyof typeof STATUS_TONE] ?? 'slate'}>
                        {vocab('dependencyStatus', d.status)}
                      </Pill>
                    </td>
                    <td>
                      {d.criticality === 'normal' ? (
                        <Muted>normal</Muted>
                      ) : (
                        <Chip tone={d.criticality === 'critical' ? 'red' : 'amber'}>
                          {d.criticality}
                        </Chip>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {d.dueDate ? (
                        <>
                          {fmtDate(d.dueDate, { year: true })}
                          <div>
                            <Muted>{relativeDays(d.dueDate)}</Muted>
                          </div>
                        </>
                      ) : (
                        <Muted>—</Muted>
                      )}
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <Muted>{d.description ?? '—'}</Muted>
                    </td>
                    <td className="full-only no-print whitespace-nowrap">
                      <form action={setDependencyStatus} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={d.id} />
                        <select
                          name="status"
                          defaultValue={d.status}
                          className="!w-auto !px-1.5 !py-1 text-[11px]"
                          aria-label="Status"
                        >
                          <option value="open">Open</option>
                          <option value="at_risk">At risk</option>
                          <option value="resolved">Resolved</option>
                          <option value="accepted_risk">Accepted</option>
                        </select>
                        <button type="submit" className="btn !px-2 !py-1 text-[11px]">
                          Save
                        </button>
                      </form>
                      <form action={deleteDependency} className="mt-1">
                        <input type="hidden" name="id" value={d.id} />
                        <button
                          type="submit"
                          className="btn !px-2 !py-1 text-[11px]"
                          style={{ color: 'var(--red)' }}
                        >
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {teamsWithEdges.length > 1 ? (
        <Card className="full-only">
          <CardHeading
            title="Cross-team dependency matrix"
            sub="Rows wait on columns. Cross-team cells are where dependencies actually go wrong; same-team sequencing usually sorts itself out."
          />
          <div className="scroll-x">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ minWidth: 180 }}>Waits on →</th>
                  {teamsWithEdges.map((t) => (
                    <th key={t.id} className="text-center">
                      {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teamsWithEdges.map((row) => (
                  <tr key={row.id}>
                    <th className="font-semibold" style={{ background: 'var(--raised)' }}>
                      {row.name}
                    </th>
                    {teamsWithEdges.map((col) => {
                      const cell = teamMatrix.get(`${col.id}|${row.id}`)
                      const same = col.id === row.id
                      return (
                        <td key={col.id} className="text-center">
                          {!cell ? (
                            <Muted>·</Muted>
                          ) : (
                            <Chip tone={cell.atRisk ? 'red' : same ? 'slate' : 'blue'}>
                              {cell.count}
                              {cell.atRisk ? ` · ${cell.atRisk} at risk` : ''}
                            </Chip>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card className="full-only no-print">
        <CardHeading
          title="Add a dependency"
          sub="Anything can depend on anything — including something outside the portfolio entirely, which is where most real slippage comes from."
        />
        <DependencyForm options={endpointOptions} />
      </Card>
    </div>
  )
}
