/**
 * Project readiness against the documented lifecycle.
 *
 * Two views of the same fact, deliberately in this order. The matrix answers
 * "where is this project in the process"; the roll-up under it answers "which
 * step of the process is the portfolio skipping". The second question is the
 * one a program lead can actually act on — a missing Program Review slide on
 * six projects is one conversation, not six.
 */
import Link from 'next/link'
import {
  Card,
  CardHeading,
  Chip,
  Empty,
  Kicker,
  Muted,
  Pill,
  ProgressBar,
  SectionNote,
  Stat,
  type Tone,
} from '@/components/ui'
import { label } from '@/lib/domain'
import { getPortfolio } from '@/lib/portfolio'
import {
  PHASE_LABEL,
  gapsByItem,
  getReadiness,
  isActive,
  scoreItems,
  type ReadinessScore,
  type ScorableProject,
} from '@/lib/readiness'

export const metadata = { title: 'Readiness · Portfolio Control Room' }

// Readiness is edited from the per-project screen; a cached render would show a
// program review a checklist that has already moved.
export const dynamic = 'force-dynamic'

/** Rows are grouped by how much the answer matters, not alphabetically. */
const STATUS_RANK: Record<string, number> = {
  in_progress: 0,
  planned: 1,
  paused: 2,
  backlog: 3,
  completed: 4,
}

/**
 * Completion colour.
 *
 * Nothing started reads as slate rather than red: a backlog project that has
 * not begun its kick-off has not failed at anything, and colouring it as a
 * failure is how a screen full of red stops being read at all.
 */
function toneFor(score: ReadinessScore): Tone {
  if (score.total === 0) return 'slate'
  if (score.done === 0) return 'slate'
  if (score.pct === 100) return 'green'
  if (score.pct >= 67) return 'amber'
  return 'red'
}

function Cell({ score, title }: { score: ReadinessScore; title: string }) {
  return (
    <span className={`chip tone-${toneFor(score)} tabular-nums`} title={title}>
      {score.done}/{score.total}
    </span>
  )
}

export default async function ReadinessPage() {
  const [p, model] = await Promise.all([getPortfolio(), getReadiness()])

  const rows: ScorableProject[] = p.projects
    .filter((pr) => pr.status !== 'canceled')
    .map((pr) => ({ id: pr.id, key: pr.key, name: pr.name, status: pr.status }))
    .sort((a, b) => {
      const ra = STATUS_RANK[a.status] ?? 9
      const rb = STATUS_RANK[b.status] ?? 9
      return ra === rb ? a.name.localeCompare(b.name) : ra - rb
    })

  const overall = new Map(rows.map((r) => [r.id, scoreItems(model, r.id, model.items)]))
  const active = rows.filter(isActive)
  const gaps = gapsByItem(model, rows)

  const fullyReady = active.filter((r) => overall.get(r.id)!.pct === 100)
  const untouched = active.filter((r) => overall.get(r.id)!.done === 0)
  const openGapCount = gaps.reduce((n, g) => n + g.projects.length, 0)
  const worst = gaps[0] ?? null

  // Nothing recorded at all is a different situation from a portfolio that is
  // genuinely behind, and the page must not accuse anyone of the latter when
  // it is looking at the former.
  const nothingRecorded = rows.every((r) => overall.get(r.id)!.done === 0)

  return (
    <div className="grid gap-4">
      <div>
        <Kicker>Lifecycle readiness</Kicker>
        <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">
          Is the documented process actually being followed
        </h2>
        <p className="m-0 mt-1 max-w-[820px] text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Every cell counts required items only, and an item marked N/A counts as satisfied —
          deciding something does not apply is a completed judgement, not an outstanding
          obligation. Optional items appear on a project&apos;s own checklist but never move these
          numbers.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          value={`${fullyReady.length}/${active.length}`}
          label="Active projects fully ready"
          tone={fullyReady.length === active.length ? 'green' : 'amber'}
          sub="Planned and in progress"
        />
        <Stat
          value={openGapCount}
          label="Required items outstanding"
          tone={nothingRecorded ? 'slate' : openGapCount ? 'amber' : 'green'}
          sub={nothingRecorded ? 'Nothing recorded yet' : 'Across every active project'}
        />
        <Stat
          value={untouched.length}
          label="Active with nothing done"
          tone={nothingRecorded ? 'slate' : untouched.length ? 'red' : 'green'}
          sub={nothingRecorded ? 'Nothing recorded yet' : 'In flight without a single gate cleared'}
        />
        <Stat
          value={worst ? worst.projects.length : 0}
          label="Most-skipped single item"
          tone={!nothingRecorded && worst && worst.projects.length > 2 ? 'red' : 'slate'}
          sub={worst ? worst.item.label : 'Nothing is being skipped'}
        />
      </div>

      {nothingRecorded ? (
        <SectionNote tone="blue">
          Nothing has been recorded against this checklist yet, so every project reads as
          outstanding. That is a blank slate, not a finding. Open a project below and start
          marking items off; the roll-up becomes meaningful as soon as it has real answers in it.
        </SectionNote>
      ) : untouched.length ? (
        <SectionNote tone="red">
          {untouched.length} active {untouched.length === 1 ? 'project has' : 'projects have'} not
          cleared a single required item —{' '}
          {untouched.map((r) => r.name).join(', ')}. Work is moving without a business case behind
          it.
        </SectionNote>
      ) : null}

      <Card>
        <CardHeading
          title="Readiness matrix"
          sub="Projects down, lifecycle gates across. Each cell is required items done over required items owed."
          right={
            <span className="flex flex-wrap items-center gap-1.5">
              <Chip tone="green">complete</Chip>
              <Chip tone="amber">mostly</Chip>
              <Chip tone="red">partial</Chip>
              <Chip tone="slate">not started</Chip>
            </span>
          }
        />
        <div className="scroll-x">
          <table className="grid">
            <thead>
              <tr>
                <th className="min-w-[220px]">Project</th>
                <th className="min-w-[90px]">Status</th>
                {model.gates.map((g) => (
                  <th key={g.id} className="min-w-[130px]" title={g.description ?? undefined}>
                    <div>{g.name}</div>
                    <Muted>{PHASE_LABEL[g.phase] ?? g.phase}</Muted>
                  </th>
                ))}
                <th className="min-w-[150px]">Overall</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const total = overall.get(r.id)!
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/readiness/${r.id}`} className="font-semibold hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td>
                      <Muted>{label('projectStatus', r.status)}</Muted>
                    </td>
                    {model.gates.map((g) => {
                      const score = scoreItems(model, r.id, g.items)
                      return (
                        <td key={g.id}>
                          <Cell
                            score={score}
                            title={
                              score.missingRequired.length
                                ? `Missing: ${score.missingRequired.map((i) => i.label).join(', ')}`
                                : `${g.name} — nothing outstanding`
                            }
                          />
                        </td>
                      )
                    })}
                    <td>
                      <ProgressBar value={total.pct / 100} tone={toneFor(total)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? <Empty>No projects to score.</Empty> : null}
      </Card>

      <div>
        <CardHeading
          title="Where the process is being skipped"
          sub="Every active project missing a required item, grouped by the item rather than the project. Ordered by how many projects skipped it."
        />
        {gaps.length === 0 ? (
          <Empty>Every active project has cleared every required item.</Empty>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {gaps.map((g) => (
              <Card
                key={g.item.id}
                tone={g.projects.length >= 3 ? 'alert' : 'default'}
                className="flex flex-col gap-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={g.projects.length >= 3 ? 'red' : 'amber'}>
                    {g.projects.length} project{g.projects.length === 1 ? '' : 's'}
                  </Pill>
                  {g.gate ? (
                    <Chip tone="blue" title={g.gate.description ?? undefined}>
                      {g.gate.name}
                    </Chip>
                  ) : null}
                  {g.item.ownerRole ? <Chip tone="violet">{g.item.ownerRole}</Chip> : null}
                </div>

                <div>
                  <h3 className="m-0 text-[13.5px] font-semibold leading-snug">{g.item.label}</h3>
                  {g.item.description ? (
                    <p
                      className="m-0 mt-1 text-[12px] leading-relaxed"
                      style={{ color: 'var(--muted)' }}
                    >
                      {g.item.description}
                    </p>
                  ) : null}
                </div>

                {g.item.templateUrl ? (
                  <a
                    href={g.item.templateUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] font-semibold underline"
                    style={{ color: 'var(--brand-2)' }}
                  >
                    Template
                  </a>
                ) : (
                  <Muted>No template — this one is a conversation, not a document.</Muted>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {g.projects.map((pr) => (
                    <Link key={pr.id} href={`/readiness/${pr.id}`} title={label('projectStatus', pr.status)}>
                      <Chip tone="slate">{pr.name}</Chip>
                    </Link>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
