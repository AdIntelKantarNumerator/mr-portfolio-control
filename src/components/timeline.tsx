import Link from 'next/link'
import type { TimelineModel } from '@/lib/timeline'
import { RAG_BAR_COLOR } from '@/lib/timeline'
import { label as vocab } from '@/lib/domain'
import { fmtDate, fmtRange, relativeDays } from '@/lib/util'
import { Chip, Muted, Pill } from './ui'

const LANE_LABEL_WIDTH = 210
const MIN_COL_WIDTH = 66

/**
 * Initiative-by-initiative timeline.
 *
 * Uses one CSS grid for the header and a positioned track per lane, rather
 * than a chart library: the bars carry interactive content (links, tooltips,
 * milestone diamonds) and need to stay readable at print width, which is
 * awkward to get out of a canvas renderer.
 */
export function Timeline({ model }: { model: TimelineModel }) {
  const cols = model.columns.length
  const minWidth = LANE_LABEL_WIDTH + cols * MIN_COL_WIDTH
  const gridTemplate = `${LANE_LABEL_WIDTH}px repeat(${cols}, minmax(${MIN_COL_WIDTH}px, 1fr))`

  // Quarter header cells, built by collapsing runs of months in the same quarter.
  const quarters: { label: string; span: number }[] = []
  for (const c of model.columns) {
    const last = quarters[quarters.length - 1]
    if (last && last.label === c.quarterLabel) last.span += 1
    else quarters.push({ label: c.quarterLabel, span: 1 })
  }

  return (
    <div className="scroll-x">
      <div style={{ minWidth }}>
        {/* Quarter band */}
        <div
          className="grid text-[11px] font-bold"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <div
            className="sticky left-0 z-20 border-b px-2.5 py-1.5"
            style={{ background: 'var(--canvas)', borderColor: 'var(--line)' }}
          />
          {quarters.map((q, i) => (
            <div
              key={`${q.label}-${i}`}
              className="border-b border-l px-2 py-1.5 text-center"
              style={{
                gridColumn: `span ${q.span}`,
                background: 'color-mix(in srgb, var(--brand) 10%, var(--surface))',
                borderColor: 'var(--line)',
                color: 'var(--brand)',
              }}
            >
              {q.label}
            </div>
          ))}
        </div>

        {/* Month band */}
        <div className="grid text-[11px]" style={{ gridTemplateColumns: gridTemplate }}>
          <div
            className="sticky left-0 z-20 border-b px-2.5 py-1.5 text-[11px] font-semibold"
            style={{ background: 'var(--canvas)', borderColor: 'var(--line)', color: 'var(--muted)' }}
          >
            Initiative
          </div>
          {model.columns.map((c) => (
            <div
              key={c.key}
              className="border-b border-l px-1 py-1.5 text-center font-semibold"
              style={{
                background: 'var(--raised)',
                borderColor: 'var(--line)',
                color: 'var(--muted)',
              }}
            >
              {c.label}
            </div>
          ))}
        </div>

        {/* Lanes */}
        {model.lanes.map((lane) => (
          <div
            key={lane.initiative.id}
            className="grid"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div
              className="sticky left-0 z-10 flex flex-col justify-center gap-0.5 border-b px-2.5 py-2"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
            >
              <Link
                href={`/initiatives#${lane.initiative.key}`}
                className="truncate text-[11.5px] font-semibold hover:underline"
                title={lane.initiative.name}
              >
                {lane.initiative.name}
              </Link>
              <div className="flex items-center gap-1">
                <span
                  className={`rag-dot bg-rag-${lane.initiative.health.rag}`}
                  title={vocab('rag', lane.initiative.health.rag)}
                />
                <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                  {lane.initiative.theme?.name ?? 'No theme'}
                </span>
              </div>
              {lane.undatedProjects.length > 0 ? (
                <span
                  className="text-[10px]"
                  style={{ color: 'var(--violet)' }}
                  title={lane.undatedProjects.map((p) => p.name).join('\n')}
                >
                  {lane.undatedProjects.length} undated
                </span>
              ) : null}
            </div>

            {/* The track spans every month column; bars are absolutely placed. */}
            <div
              className="relative border-b border-l"
              style={{
                gridColumn: `span ${cols}`,
                borderColor: 'var(--line)',
                minHeight: 56,
              }}
            >
              {/* Month gridlines, drawn behind the bars. */}
              <div
                className="pointer-events-none absolute inset-0 grid"
                style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
                aria-hidden
              >
                {model.columns.map((c) => (
                  <div
                    key={c.key}
                    className="border-l"
                    style={{
                      borderColor: c.quarterStart
                        ? 'color-mix(in srgb, var(--brand-2) 35%, transparent)'
                        : 'color-mix(in srgb, var(--line) 70%, transparent)',
                    }}
                  />
                ))}
              </div>

              {model.todayPct !== null ? (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-[1] w-px"
                  style={{ left: `${model.todayPct}%`, background: 'var(--accent)' }}
                  aria-hidden
                />
              ) : null}

              {lane.bars.map((bar) => (
                <Link
                  key={bar.project.id}
                  href={`/readiness/${bar.project.id}`}
                  className="absolute z-[2] flex items-center overflow-hidden rounded-md px-2 text-[10px] font-semibold text-white transition-transform hover:scale-y-110"
                  style={{
                    left: `${bar.leftPct}%`,
                    width: `${bar.widthPct}%`,
                    top: 10,
                    height: 22,
                    background: RAG_BAR_COLOR[bar.rag],
                    borderTopLeftRadius: bar.clippedStart ? 0 : undefined,
                    borderBottomLeftRadius: bar.clippedStart ? 0 : undefined,
                    borderTopRightRadius: bar.clippedEnd ? 0 : undefined,
                    borderBottomRightRadius: bar.clippedEnd ? 0 : undefined,
                    opacity: ['completed', 'canceled'].includes(bar.project.status) ? 0.45 : 1,
                  }}
                  title={[
                    bar.project.name,
                    `${vocab('projectStatus', bar.project.status)} · ${Math.round(bar.project.progress * 100)}%`,
                    fmtRange(bar.project.startDate, bar.project.targetDate),
                    bar.project.lead ? `Lead: ${bar.project.lead.name}` : 'No lead',
                    bar.project.health.rationale ?? '',
                  ]
                    .filter(Boolean)
                    .join('\n')}
                >
                  <span className="truncate">{bar.project.name}</span>
                </Link>
              ))}

              {lane.milestones.map((m) => (
                <div
                  key={m.milestone.id}
                  className="absolute z-[3] -translate-x-1/2 text-center"
                  style={{ left: `${m.leftPct}%`, top: 36 }}
                  title={[
                    `${m.projectName} — ${m.milestone.name}`,
                    fmtDate(m.milestone.targetDate, { year: true }),
                    m.milestone.contested ? 'Contested or externally committed date.' : '',
                    m.milestone.description ?? '',
                  ]
                    .filter(Boolean)
                    .join('\n')}
                >
                  <div
                    className="mx-auto h-2.5 w-2.5 rotate-45 border-2"
                    style={{
                      background: m.milestone.status === 'done' ? 'var(--brand)' : 'var(--surface)',
                      borderColor:
                        m.overdue || m.milestone.contested ? 'var(--red)' : 'var(--brand)',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TimelineLegend() {
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px]"
      style={{ color: 'var(--muted)' }}
    >
      <span className="font-semibold">Bar colour = assessed health:</span>
      {(['green', 'amber', 'red', 'unknown'] as const).map((r) => (
        <span key={r} className="inline-flex items-center gap-1.5">
          <i
            className="inline-block h-3 w-3.5 rounded-[3px]"
            style={{ background: RAG_BAR_COLOR[r] }}
          />
          {vocab('rag', r)}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <i
          className="inline-block h-2.5 w-2.5 rotate-45 border-2"
          style={{ borderColor: 'var(--brand)', background: 'var(--surface)' }}
        />
        Milestone
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i
          className="inline-block h-2.5 w-2.5 rotate-45 border-2"
          style={{ borderColor: 'var(--red)', background: 'var(--surface)' }}
        />
        Contested or overdue
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i className="inline-block h-3.5 w-px" style={{ background: 'var(--accent)' }} />
        Today
      </span>
      <span>Faded bars are completed or cancelled.</span>
    </div>
  )
}

/** The dated commitments, spelled out under the chart. */
export function KeyDateStrip({ model }: { model: TimelineModel }) {
  if (model.keyDates.length === 0) return null
  return (
    <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {model.keyDates.map((k) => {
        const risky = k.overdue || k.milestone.contested
        return (
          <div
            key={k.milestone.id}
            className="rounded-lg border px-3 py-2.5"
            style={{
              borderColor: risky ? 'color-mix(in srgb, var(--red) 40%, var(--line))' : 'var(--line)',
              background: risky ? 'var(--red-bg)' : 'var(--raised)',
            }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <div
                className="text-[12px] font-bold"
                style={{ color: risky ? 'var(--red)' : 'var(--brand)' }}
              >
                {fmtDate(k.milestone.targetDate, { year: true })}
              </div>
              <Muted>{relativeDays(k.milestone.targetDate)}</Muted>
            </div>
            <div className="mt-0.5 text-[11.5px] font-semibold">{k.milestone.name}</div>
            <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {k.projectName}
            </div>
            {k.milestone.description ? (
              <p className="m-0 mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                {k.milestone.description}
              </p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap gap-1">
              {k.milestone.status === 'done' ? <Chip tone="green">done</Chip> : null}
              {k.milestone.contested ? <Chip tone="red">contested</Chip> : null}
              {k.overdue ? <Pill tone="red">overdue</Pill> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
