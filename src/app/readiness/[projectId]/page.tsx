/**
 * One project's lifecycle checklist.
 *
 * The matrix screen says a gate is 3/4; this is where the fourth thing gets
 * named, linked and closed. Each row carries the item's own description so the
 * standard travels with the checkbox — a team should not have to open the
 * process site to find out what "RACI" is expected to contain here.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  Card,
  CardHeading,
  Chip,
  Empty,
  GapFlag,
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
import { fmtDate } from '@/lib/util'
import {
  PHASE_LABEL,
  READINESS_STATUS,
  READINESS_STATUS_LABEL,
  getReadiness,
  progressFor,
  scoreItems,
  statusFor,
  type ReadinessStatus,
} from '@/lib/readiness'
import { updateReadiness } from '../actions'

export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<ReadinessStatus, Tone> = {
  not_started: 'slate',
  in_progress: 'amber',
  done: 'green',
  na: 'blue',
}

export default async function ProjectReadinessPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const [p, model] = await Promise.all([getPortfolio(), getReadiness()])

  const project = p.projects.find((pr) => pr.id === projectId)
  if (!project) notFound()

  const overall = scoreItems(model, project.id, model.items)

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Kicker>Lifecycle readiness</Kicker>
          <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">{project.name}</h2>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-[12.5px]">
            <Pill tone="slate">{label('projectStatus', project.status)}</Pill>
            {project.lead ? <Chip tone="blue">lead · {project.lead.name}</Chip> : <GapFlag>no lead</GapFlag>}
            {project.team ? <Chip tone="slate">{project.team.name}</Chip> : null}
            {project.targetDate ? (
              <Chip tone="accent">target · {fmtDate(project.targetDate, { year: true })}</Chip>
            ) : null}
          </p>
        </div>
        <Link href="/readiness" className="btn no-print">
          Back to the matrix
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          value={`${overall.done}/${overall.total}`}
          label="Required items satisfied"
          tone={overall.pct === 100 ? 'green' : overall.done === 0 ? 'red' : 'amber'}
          sub={<ProgressBar value={overall.pct / 100} tone={overall.pct === 100 ? 'green' : 'amber'} />}
        />
        <Stat
          value={overall.missingRequired.length}
          label="Still outstanding"
          tone={overall.missingRequired.length ? 'amber' : 'green'}
          sub={
            overall.missingRequired.length
              ? overall.missingRequired.map((i) => i.label).join(' · ')
              : 'Nothing owed'
          }
        />
        <Stat value={model.gates.length} label="Lifecycle gates" sub="The documented process end to end" />
      </div>

      {overall.missingRequired.length === 0 ? (
        <SectionNote tone="green">
          Every required item is done or explicitly marked N/A. Optional items below are still
          worth doing, but they do not gate anything.
        </SectionNote>
      ) : null}

      {model.gates.length === 0 ? <Empty>No lifecycle gates are defined yet.</Empty> : null}

      {model.gates.map((gate) => {
        const score = scoreItems(model, project.id, gate.items)
        return (
          <Card key={gate.id}>
            <CardHeading
              title={
                <span className="inline-flex flex-wrap items-center gap-2">
                  {gate.name}
                  <Chip tone="violet">{PHASE_LABEL[gate.phase] ?? gate.phase}</Chip>
                  <Pill tone={score.pct === 100 ? 'green' : score.done === 0 ? 'slate' : 'amber'}>
                    {score.done}/{score.total} required
                  </Pill>
                </span>
              }
              sub={gate.description}
            />

            <div className="grid gap-2.5">
              {gate.items.map((item) => {
                const status = statusFor(model, project.id, item.id)
                const row = progressFor(model, project.id, item.id)
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border p-3"
                    style={{
                      borderColor: 'var(--line)',
                      background: status === 'done' || status === 'na' ? 'var(--surface)' : 'var(--raised)',
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={STATUS_TONE[status]}>{READINESS_STATUS_LABEL[status]}</Pill>
                      {item.ownerRole ? <Chip tone="accent">{item.ownerRole}</Chip> : null}
                      {item.required ? null : (
                        <Chip tone="slate" title="Appears here but never counts against readiness.">
                          optional
                        </Chip>
                      )}
                      {item.templateUrl ? (
                        <a
                          href={item.templateUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11.5px] font-semibold underline"
                          style={{ color: 'var(--brand-2)' }}
                        >
                          Template
                        </a>
                      ) : null}
                      {status === 'done' && !row?.link ? (
                        <GapFlag title="Marked done with no link to the artifact. Nobody else can check it.">
                          done, no link
                        </GapFlag>
                      ) : null}
                    </div>

                    <div className="mt-1.5">
                      <div className="text-[13px] font-semibold leading-snug">{item.label}</div>
                      {item.description ? (
                        <p
                          className="m-0 mt-1 text-[12px] leading-relaxed"
                          style={{ color: 'var(--muted)' }}
                        >
                          {item.description}
                        </p>
                      ) : null}
                    </div>

                    {row?.link ? (
                      <div className="mt-1.5">
                        <a
                          href={row.link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[12px] underline"
                          style={{ color: 'var(--accent)' }}
                        >
                          {row.link}
                        </a>
                      </div>
                    ) : null}

                    {row?.note ? (
                      <p
                        className="m-0 mt-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px]"
                        style={{ borderColor: 'var(--line)' }}
                      >
                        {row.note}
                      </p>
                    ) : null}

                    {/* Operator console — the leadership read is the state above. */}
                    <form
                      action={updateReadiness}
                      className="full-only no-print mt-2.5 grid gap-2 border-t pt-2.5 sm:grid-cols-[auto_1fr_auto]"
                      style={{ borderColor: 'var(--line)' }}
                    >
                      <input type="hidden" name="projectId" value={project.id} />
                      <input type="hidden" name="itemId" value={item.id} />
                      <select
                        name="status"
                        defaultValue={status}
                        aria-label={`Status for ${item.label}`}
                        className="!w-auto !py-1 text-[11.5px]"
                      >
                        {READINESS_STATUS.map((v) => (
                          <option key={v} value={v}>
                            {READINESS_STATUS_LABEL[v]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="url"
                        name="link"
                        defaultValue={row?.link ?? ''}
                        placeholder="Where this project's copy actually lives"
                        aria-label={`Link for ${item.label}`}
                        className="!py-1 text-[11.5px]"
                      />
                      <button type="submit" className="btn !py-1">
                        Save
                      </button>
                      <textarea
                        name="note"
                        rows={1}
                        defaultValue={row?.note ?? ''}
                        placeholder="Note — what is outstanding, or why this does not apply."
                        aria-label={`Note for ${item.label}`}
                        className="text-[11.5px] sm:col-span-3"
                      />
                    </form>

                    {row?.updatedAt ? (
                      <div className="full-only mt-1.5">
                        <Muted>Last updated {fmtDate(row.updatedAt, { year: true })}</Muted>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
