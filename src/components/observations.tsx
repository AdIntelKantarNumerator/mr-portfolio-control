/**
 * What Yaara has observed, rendered so nobody mistakes it for a person's work.
 *
 * The label is not decoration. Everything on this card was written by a model
 * reading tickets and pull requests, and the moment that becomes invisible the
 * portfolio stops being a record of what people know and becomes a record of
 * what a model guessed. So: the header says who wrote it, the health call says
 * whether anyone has reviewed it, and every bullet carries the evidence it came
 * from.
 */
import { Card, CardHeading, Chip, Empty, Muted, SectionNote } from '@/components/ui'
import type { AgentAssessmentRow, ObservationRow } from '@/lib/observations'
import { MarkReviewedButton } from '@/app/initiatives/[id]/review-action'

const KIND_LABEL: Record<string, string> = {
  progress: 'progress',
  blocker: 'blocker',
  decision_needed: 'decision needed',
  decision_made: 'decision made',
  risk: 'risk',
  change: 'change',
}

const KIND_TONE: Record<string, 'slate' | 'amber' | 'red' | 'green' | 'violet'> = {
  progress: 'green',
  blocker: 'red',
  decision_needed: 'amber',
  decision_made: 'violet',
  risk: 'amber',
  change: 'slate',
}

const RAG_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  green: 'green',
  amber: 'amber',
  red: 'red',
  unknown: 'slate',
}

function Bullets({
  title,
  note,
  items,
  evidence,
}: {
  title: string
  note: string
  items: ObservationRow['items']
  evidence: ObservationRow['evidence']
}) {
  if (items.length === 0) return null
  const byId = new Map(evidence.map((e) => [e.id, e]))

  return (
    <div className="mt-3">
      <div
        className="text-[10px] font-bold uppercase tracking-[0.06em]"
        style={{ color: 'var(--muted)' }}
      >
        {title}
      </div>
      <Muted>{note}</Muted>
      <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
        {items.map((item, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-1.5 text-[12.5px]">
            <Chip tone={KIND_TONE[item.kind] ?? 'slate'}>{KIND_LABEL[item.kind] ?? item.kind}</Chip>
            <span>{item.text}</span>
            <span className="flex flex-wrap gap-1">
              {item.citations.map((c) => {
                const source = byId.get(c)
                if (!source) return null
                return source.url ? (
                  <a
                    key={c}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] underline decoration-dotted underline-offset-2"
                    style={{ color: 'var(--muted)' }}
                    title={source.title}
                  >
                    {source.source}
                  </a>
                ) : (
                  <span key={c} className="text-[11px]" style={{ color: 'var(--muted)' }} title={source.title}>
                    {source.source}
                  </span>
                )
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Observations({
  observation,
  assessment,
  canReview,
}: {
  observation: ObservationRow | null
  assessment: AgentAssessmentRow | null
  canReview: boolean
}) {
  if (!observation && !assessment) {
    return (
      <Card>
        <CardHeading title="Yaara" sub="Continuous reading of Linear, GitHub and attached conversations" />
        <Empty>
          Yaara has not published anything about this yet. She writes when the connected sources say
          something about it — silence here means nothing new was found, not that nothing happened.
        </Empty>
      </Card>
    )
  }

  const engineering = observation?.items.filter((i) => i.audience === 'engineering') ?? []
  const stakeholder = observation?.items.filter((i) => i.audience === 'stakeholder') ?? []

  return (
    <Card>
      <CardHeading
        title="Yaara"
        sub={
          observation
            ? `Written by ${observation.agent} · ${observation.model}${
                observation.servedBy ? ` via ${observation.servedBy}` : ''
              } · ${observation.ageHours < 24 ? `${observation.ageHours}h ago` : `${Math.round(observation.ageHours / 24)}d ago`}`
            : 'Machine-written'
        }
      />

      <SectionNote tone="violet">
        Written by an agent, not a person. Every bullet cites what it read — follow the links before
        repeating any of it.
      </SectionNote>

      {assessment ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2"
          style={{ borderColor: 'var(--line)' }}
        >
          <Chip tone={RAG_TONE[assessment.rag] ?? 'slate'}>{assessment.rag}</Chip>
          <Muted>{assessment.confidence} confidence</Muted>
          <span className="text-[12.5px]">{assessment.rationale}</span>
          <span className="ml-auto flex items-center gap-2">
            {assessment.reviewedAt ? (
              <Chip tone="green">
                reviewed{assessment.reviewerName ? ` by ${assessment.reviewerName}` : ''}
              </Chip>
            ) : (
              <>
                <Chip tone="amber">not human reviewed</Chip>
                {canReview ? <MarkReviewedButton assessmentId={assessment.id} /> : null}
              </>
            )}
          </span>
        </div>
      ) : null}

      <Bullets
        title="For engineering"
        note="What someone doing the work needs."
        items={engineering}
        evidence={observation?.evidence ?? []}
      />
      <Bullets
        title="For stakeholders"
        note="What someone funding or depending on this needs."
        items={stakeholder}
        evidence={observation?.evidence ?? []}
      />

      {observation && observation.evidence.length > 0 ? (
        <div className="mt-3">
          <div
            className="text-[10px] font-bold uppercase tracking-[0.06em]"
            style={{ color: 'var(--muted)' }}
          >
            What she read
          </div>
          <div className="mt-1 flex flex-col gap-1">
            {observation.evidence.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 text-[12px]">
                <Chip tone="slate">{e.source}</Chip>
                {e.url ? (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-2"
                  >
                    {e.title}
                  </a>
                ) : (
                  <span>{e.title}</span>
                )}
                <Muted>{e.occurredAt ? e.occurredAt.slice(0, 10) : 'undated'}</Muted>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  )
}
