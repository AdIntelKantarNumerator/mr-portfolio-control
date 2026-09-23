/**
 * The template library and the discovery question bank.
 *
 * Both halves exist for the same reason: the program team already wrote these
 * down, and a document nobody can find is functionally a document nobody
 * wrote. The question bank in particular is prompts rather than fields —
 * forcing "how far back are we going for history?" to be answered before a
 * date is committed, instead of in month three when the answer is expensive.
 */
import {
  Card,
  CardHeading,
  Chip,
  Empty,
  Kicker,
  Muted,
  SectionNote,
  type Tone,
} from '@/components/ui'
import {
  WORKSTREAM_LABEL,
  WORKSTREAM_ORDER,
  getDiscoveryTopics,
  getTemplates,
} from '@/lib/readiness'

// This page reads the live portfolio; prerendering it would serve stale data.
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Templates · Portfolio Control Room' }

const KIND_TONE: Record<string, Tone> = {
  doc: 'blue',
  sheet: 'green',
  slides: 'amber',
  board: 'violet',
  folder: 'slate',
}

export default async function TemplatesPage() {
  const [templates, topicsByWorkstream] = await Promise.all([getTemplates(), getDiscoveryTopics()])

  // Any workstream the seed did not anticipate still renders, after the known
  // ones, rather than silently disappearing from the bank.
  const workstreams = [
    ...WORKSTREAM_ORDER.filter((w) => topicsByWorkstream.has(w)),
    ...[...topicsByWorkstream.keys()].filter(
      (w) => !(WORKSTREAM_ORDER as readonly string[]).includes(w),
    ),
  ]

  const questionCount = [...topicsByWorkstream.values()].reduce((n, q) => n + q.length, 0)

  return (
    <div className="grid gap-4">
      <div>
        <Kicker>Standard templates</Kicker>
        <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">
          The documents every project is expected to have
        </h2>
        <p className="m-0 mt-1 max-w-[820px] text-[12.5px]" style={{ color: 'var(--muted)' }}>
          One place for the canonical links, so a kick-off does not start with someone hunting
          Drive for last quarter&apos;s charter. The readiness checklist points at these same
          documents.
        </p>
      </div>

      <SectionNote tone="amber">Make copies of these — do not alter the templates.</SectionNote>

      {templates.length === 0 ? (
        <Empty>No templates have been registered yet.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="m-0 text-[13.5px] font-semibold leading-snug">{t.name}</h3>
                <Chip tone={KIND_TONE[t.kind] ?? 'slate'}>{t.kind}</Chip>
              </div>
              {t.description ? (
                <p className="m-0 text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                  {t.description}
                </p>
              ) : null}
              <a
                href={t.url}
                target="_blank"
                rel="noreferrer"
                className="btn mt-auto self-start !py-1"
              >
                Open template
              </a>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-2">
        <Kicker>Discovery question bank</Kicker>
        <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">
          What a data project has to answer before it commits to a date
        </h2>
        <p className="m-0 mt-1 max-w-[820px] text-[12.5px]" style={{ color: 'var(--muted)' }}>
          {questionCount} questions across {workstreams.length} workstreams. These are prompts, not
          fields — the value is in a team having to say &ldquo;we don&apos;t know yet&rdquo; out
          loud while that is still cheap.
        </p>
      </div>

      {workstreams.length === 0 ? (
        <Empty>The question bank is empty.</Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {workstreams.map((w) => {
            const questions = topicsByWorkstream.get(w) ?? []
            return (
              <Card key={w}>
                <CardHeading
                  title={WORKSTREAM_LABEL[w] ?? w}
                  right={
                    <Muted>
                      {questions.length} question{questions.length === 1 ? '' : 's'}
                    </Muted>
                  }
                />
                <ol className="m-0 grid list-none gap-1.5 p-0">
                  {questions.map((q, ix) => (
                    <li key={q.id} className="flex gap-2 text-[12.5px] leading-relaxed">
                      <span
                        className="shrink-0 tabular-nums font-semibold"
                        style={{ color: 'var(--brand-2)' }}
                      >
                        {ix + 1}.
                      </span>
                      <span>{q.question}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
