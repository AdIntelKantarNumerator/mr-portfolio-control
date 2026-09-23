/**
 * Initiatives, with the delivery work behind each one a keypress away.
 *
 * The collapsed row is the board-level answer — is it healthy, who owns it,
 * when does it land. The expanded panel is the delivery answer, and the two are
 * deliberately on the same screen so nobody has to reconcile a slide against a
 * tracker in their head.
 */
import {
  Card,
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
import Link from 'next/link'
import { getPortfolio, type InitiativeView, type ProjectView } from '@/lib/portfolio'
import { getBriefs, getTranscripts, type BriefRow, type TranscriptRow } from '@/lib/briefs'
import { Brief } from '@/components/brief'
import { fmtDate, fmtRange } from '@/lib/util'
import { Disclosure } from './disclosure'

// This page reads the live portfolio; prerendering it would serve stale data.
export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<string, Tone> = {
  active: 'blue',
  planned: 'slate',
  paused: 'amber',
  completed: 'green',
  canceled: 'slate',
}

function ProjectsTable({ projects }: { projects: ProjectView[] }) {
  return (
    <div className="scroll-x">
      <table className="grid">
        <thead>
          <tr>
            <th style={{ minWidth: 210 }}>Project</th>
            <th>Status</th>
            <th>Priority</th>
            <th style={{ minWidth: 120 }}>Progress</th>
            <th>Lead</th>
            <th style={{ minWidth: 130 }}>Dates</th>
            <th className="full-only">Milestones</th>
            <th className="full-only">Provenance</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td>
                <div className="flex flex-wrap items-center gap-1.5">
                  <HealthBadge health={p.health} showOrigin={false} />
                  <Link
                    href={`/projects/${p.id}`}
                    className="font-semibold underline decoration-dotted underline-offset-2"
                  >
                    {p.name}
                  </Link>
                </div>
              </td>
              <td>
                <Pill tone={p.status === 'in_progress' ? 'blue' : 'slate'}>
                  {label('projectStatus', p.status)}
                </Pill>
              </td>
              <td>{label('priority', p.priority)}</td>
              <td>
                <ProgressBar
                  value={p.progress}
                  tone={p.health.rag === 'red' ? 'red' : p.health.rag === 'amber' ? 'amber' : 'blue'}
                />
              </td>
              <td>
                {p.lead ? (
                  p.lead.name
                ) : (
                  <GapFlag title="No delivery lead on this project.">no lead</GapFlag>
                )}
              </td>
              <td className="tabular-nums">{fmtRange(p.startDate, p.targetDate)}</td>
              <td className="full-only tabular-nums">
                {p.milestones.length === 0 ? (
                  <Muted>none</Muted>
                ) : (
                  <span title={p.milestones.map((m) => m.name).join('\n')}>
                    {p.milestones.filter((m) => m.status === 'done').length}/{p.milestones.length}
                  </span>
                )}
              </td>
              <td className="full-only">
                <div className="flex flex-wrap gap-1">
                  {p.sources.length === 0 ? (
                    <Muted>typed here</Muted>
                  ) : (
                    p.sources.map((s, i) => (
                      <SourceBadge key={`${s.system}-${i}`} system={s.system} url={s.url} />
                    ))
                  )}
                  {p.overridden.length > 0 ? <OverrideBadge fields={p.overridden} /> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function InitiativeRow({
  i,
  brief,
  transcripts,
}: {
  i: InitiativeView
  brief: BriefRow | null
  transcripts: TranscriptRow[]
}) {
  const start = i.startDate ?? i.derivedStart
  const target = i.targetDate ?? i.derivedTarget
  // The derived dates are rolled up from child projects, so say so rather than
  // letting a date that nobody typed look like a commitment somebody made.
  const derived = !i.targetDate && Boolean(i.derivedTarget)
  const ownerMissing = i.ownerGap || !i.owner
  const themeColor = i.theme?.color ?? 'var(--line)'

  // Everything in the summary is phrasing content (spans), because it renders
  // inside the disclosure's <button> and block elements are invalid there.
  const summary = (
    <span className="flex flex-col gap-1.5">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[14.5px] font-semibold tracking-[-0.01em]">{i.name}</span>
        {i.theme ? (
          <Chip tone="slate" title={i.theme.description ?? undefined}>
            <span
              className="rag-dot"
              style={{ background: themeColor, width: 8, height: 8 }}
              aria-hidden="true"
            />
            {i.theme.name}
          </Chip>
        ) : (
          <GapFlag title="Not attached to a board theme.">no theme</GapFlag>
        )}
        <Pill tone={STATUS_TONE[i.status] ?? 'slate'}>{label('initiativeStatus', i.status)}</Pill>
        <HealthBadge health={i.health} />
      </span>

      {i.health.origin === 'assessed' && i.health.rationale ? (
        <span
          className="block max-w-[820px] text-[12px] leading-relaxed"
          style={{ color: 'var(--ink)' }}
        >
          {i.health.rationale}
          {i.health.evidence ? (
            <span style={{ color: 'var(--muted)' }}> — {i.health.evidence}</span>
          ) : null}
          {i.health.asOf ? (
            <span style={{ color: 'var(--muted)' }}> · {fmtDate(i.health.asOf)}</span>
          ) : null}
        </span>
      ) : null}

      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span>
          <Muted>Owner</Muted>{' '}
          {ownerMissing ? (
            <GapFlag title="No initiative owner. Everything below is nobody's to answer for.">
              no owner
            </GapFlag>
          ) : (
            <span className="font-semibold">{i.owner!.name}</span>
          )}
        </span>
        <span>
          <Muted>Projects</Muted> <span className="font-semibold tabular-nums">{i.projects.length}</span>
        </span>
        <span className="tabular-nums">
          <Muted>Dates</Muted> {fmtRange(start, target)}
          {derived ? <Muted> (rolled up)</Muted> : null}
        </span>
      </span>
    </span>
  )

  return (
    <Card className="border-l-4" style={{ borderLeftColor: themeColor }}>
      <Disclosure
        labelText={i.name}
        // Anything in trouble opens on load: the reasoning is what the row is
        // for, and a red initiative behind a click gets read as decoration.
        defaultOpen={i.health.rag === 'red'}
        summary={summary}
      >
        {i.notes ? (
          <p className="m-0 mb-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink)' }}>
            {i.notes}
          </p>
        ) : null}

        {i.projects.length === 0 ? (
          <SectionNote tone="violet">
            Strategic initiative, nothing in delivery yet — no projects roll up to it. That is a
            statement about the plan, not a missing row.
          </SectionNote>
        ) : (
          <ProjectsTable projects={i.projects} />
        )}

        {brief || transcripts.length > 0 ? (
          <Brief brief={brief} transcripts={transcripts} transcriptCount={transcripts.length} />
        ) : null}

        {i.overridden.length > 0 ? (
          <div className="full-only mt-2">
            <OverrideBadge fields={i.overridden} />
          </div>
        ) : null}
      </Disclosure>

      {/* Outside the disclosure on purpose: the one-page view of an initiative
          is the thing people come here for, and putting it behind an expand
          means it gets found by the people who already knew it existed. */}
      <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
        <Link
          href={`/initiatives/${i.id}`}
          className="text-[12px] font-semibold underline decoration-dotted underline-offset-2"
          style={{ color: 'var(--brand-2)' }}
        >
          Everything about {i.name} →
        </Link>
      </div>
    </Card>
  )
}

export default async function InitiativesPage() {
  const [p, briefs, transcripts] = await Promise.all([
    getPortfolio(),
    getBriefs(),
    getTranscripts(),
  ])

  // Theme order is the board's narrative order; initiatives without a theme sit
  // at the end rather than being dropped.
  const themeRank = new Map(p.themes.map((t, ix) => [t.id, t.sortOrder * 1000 + ix]))
  const sorted = [...p.initiatives].sort((a, b) => {
    const at = a.themeId ? (themeRank.get(a.themeId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
    const bt = b.themeId ? (themeRank.get(b.themeId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
    if (at !== bt) return at - bt
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.name.localeCompare(b.name)
  })

  const red = sorted.filter((i) => i.health.rag === 'red')
  const unowned = sorted.filter(
    (i) => (i.ownerGap || !i.owner) && !['completed', 'canceled'].includes(i.status),
  )
  const noDelivery = sorted.filter((i) => i.projects.length === 0)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Kicker>Initiatives</Kicker>
        <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">
          The board view, with the delivery work one keypress underneath
        </h2>
        <p className="m-0 mt-1 max-w-[820px] text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Sorted by theme, then by the order each theme reads in. Where health was assessed, the
          rationale sits under the badge — the colour on its own has never moved a decision.
          Anything assessed {label('rag', 'red')} is expanded already.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={sorted.length} label="Initiatives" />
        <Stat value={red.length} label={label('rag', 'red')} tone={red.length ? 'red' : 'green'} />
        <Stat value={unowned.length} label="No owner" tone={unowned.length ? 'amber' : 'green'} />
        <Stat
          value={noDelivery.length}
          label="Nothing in delivery"
          sub="strategic only, by design or by neglect"
        />
      </div>

      {unowned.length > 0 ? (
        <SectionNote tone="violet">
          {unowned.length} active {unowned.length === 1 ? 'initiative has' : 'initiatives have'} no
          owner: {unowned.map((i) => i.name).join(', ')}. An unowned initiative has nobody to ask
          when the date moves.
        </SectionNote>
      ) : null}

      {sorted.length === 0 ? (
        <Empty>No initiatives yet.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((i) => (
            <InitiativeRow
              key={i.id}
              i={i}
              brief={briefs.get(`initiative:${i.id}`) ?? null}
              transcripts={transcripts.get(`initiative:${i.id}`) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  )
}
