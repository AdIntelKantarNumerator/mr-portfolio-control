/**
 * Conversations: what is attached to what, what has been ingested, and the
 * briefs generated from it.
 *
 * This is the screen where someone takes responsibility for a source being
 * read. Every link records who attached it; ingestion is off until switched
 * on; and the full text of everything ingested is listed here rather than
 * hidden behind the summary, because the summary is the derivative and this is
 * the evidence.
 */
import { Brief } from '@/components/brief'
import {
  Card,
  CardHeading,
  Chip,
  Empty,
  GapFlag,
  Kicker,
  Muted,
  SectionNote,
  Stat,
} from '@/components/ui'
import { label } from '@/lib/domain'
import { getBriefs, getSources, getTranscripts } from '@/lib/briefs'
import { getPortfolio } from '@/lib/portfolio'
import { summariserConfigured, summariserDescription } from '@/lib/summarize'
import {
  AddSourceForm,
  AddTranscriptForm,
  DetachButton,
  GenerateBriefButton,
  IngestToggle,
  RemoveTranscriptButton,
  type EntityOption,
  type SourceOption,
} from './forms'

export const dynamic = 'force-dynamic'

const KEY = (t: string, i: string) => `${t}:${i}`

export default async function SourcesPage() {
  const [p, sources, transcripts, briefs] = await Promise.all([
    getPortfolio(),
    getSources(),
    getTranscripts(),
    getBriefs(),
  ])

  // Initiatives first, then their projects indented — the same order the rest
  // of the app uses, so the dropdown matches the mental model.
  const entities: EntityOption[] = []
  for (const i of p.initiatives) {
    entities.push({ value: KEY('initiative', i.id), label: i.name })
    for (const proj of i.projects) {
      entities.push({ value: KEY('project', proj.id), label: `  ${proj.name}` })
    }
  }

  const nameFor = new Map(entities.map((e) => [e.value, e.label.trim()]))

  const allSources = [...sources.values()].flat()
  const allTranscripts = [...transcripts.values()].flat()
  const enabled = allSources.filter((s) => s.ingestEnabled)

  const sourceOptions: SourceOption[] = allSources.map((s) => ({
    id: s.id,
    label: s.label,
    entity: KEY(s.entityType, s.entityId),
  }))

  // Only entities that have something attached get a card; an empty screen of
  // every project in the portfolio would bury the handful that matter.
  const withSomething = [...new Set([...sources.keys(), ...transcripts.keys()])].sort((a, b) =>
    (nameFor.get(a) ?? a).localeCompare(nameFor.get(b) ?? b),
  )

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Kicker>Conversations</Kicker>
        <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">
          What was said, and what it adds up to
        </h2>
        <p className="m-0 mt-1 max-w-[760px] text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Meeting transcripts, channel excerpts and documents attached to the work they are
          about, summarised into a few bullets with every point traceable to what was actually
          said. A brief is a machine&apos;s reading, never an assessment.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={allSources.length} label="Sources attached" />
        <Stat
          value={enabled.length}
          label="Ingestion enabled"
          tone={enabled.length ? 'amber' : 'slate'}
        />
        <Stat value={allTranscripts.length} label="Conversations stored" />
        <Stat value={briefs.size} label="Briefs" />
      </div>

      {summariserConfigured() ? (
        <SectionNote tone="slate">
          <strong>Summariser:</strong> {summariserDescription()}
        </SectionNote>
      ) : (
        <SectionNote tone="amber">
          <strong>No summariser is configured.</strong> Conversations can be attached and stored,
          but no brief can be generated until one of an Azure OpenAI deployment, a Gemini key or
          an Anthropic key is set on the server. Everything else on this screen works without one.
        </SectionNote>
      )}

      <SectionNote tone="violet">
        Anyone with a company account can read this app, and there are no roles yet. A summary of
        a conversation is readable by everyone the moment it is generated — so ingestion is off
        by default on every source, and turning it on is a decision someone is recorded as having
        made.
      </SectionNote>

      <Card>
        <CardHeading
          title="Attach a source"
          sub="A Slack channel, a recurring meeting, or a standing document. Nothing is read until you allow it."
        />
        <AddSourceForm entities={entities} />
      </Card>

      <Card>
        <CardHeading
          title="Add a conversation"
          sub="Paste a transcript or notes. Works with no admin access anywhere — you decide what is relevant."
        />
        <AddTranscriptForm entities={entities} sources={sourceOptions} />
      </Card>

      {withSomething.length === 0 ? (
        <Empty>Nothing attached yet. Attach a source or paste a conversation above.</Empty>
      ) : (
        withSomething.map((k) => {
          const [entityType, entityId] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]
          const mySources = sources.get(k) ?? []
          const myTranscripts = transcripts.get(k) ?? []
          const brief = briefs.get(k) ?? null
          const briefIsStale =
            brief && myTranscripts.length > 0
              ? myTranscripts.some((t) => t.createdAt > brief.createdAt)
              : false

          return (
            <Card key={k}>
              <CardHeading
                title={nameFor.get(k) ?? entityId}
                sub={`${entityType} · ${mySources.length} source(s) · ${myTranscripts.length} conversation(s)`}
              />

              {mySources.length > 0 ? (
                <div className="mb-3 flex flex-col gap-2">
                  {mySources.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2"
                      style={{ borderColor: 'var(--line)' }}
                    >
                      <Chip tone="slate">{label('sourceKind', s.kind)}</Chip>
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[12.5px] font-semibold underline decoration-dotted underline-offset-2"
                        >
                          {s.label}
                        </a>
                      ) : (
                        <span className="text-[12.5px] font-semibold">{s.label}</span>
                      )}
                      {s.notes ? <Muted>{s.notes}</Muted> : null}
                      {!s.ingestEnabled ? (
                        <Muted>not being read</Muted>
                      ) : (
                        <Chip tone="amber">being read</Chip>
                      )}
                      <span className="ml-auto flex items-center gap-2">
                        {s.addedBy ? <Muted>attached by {s.addedBy}</Muted> : null}
                        <IngestToggle
                          sourceId={s.id}
                          enabled={s.ingestEnabled}
                          labelText={s.label}
                        />
                        <DetachButton sourceId={s.id} />
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mb-2 flex flex-wrap items-center gap-2">
                <GenerateBriefButton
                  entityType={entityType}
                  entityId={entityId}
                  disabled={myTranscripts.length === 0 || !summariserConfigured()}
                />
                {briefIsStale ? (
                  <GapFlag title="Conversations have been added since this brief was generated.">
                    brief is behind the material
                  </GapFlag>
                ) : null}
              </div>

              <Brief
                brief={brief}
                transcripts={myTranscripts}
                transcriptCount={myTranscripts.length}
              />

              {myTranscripts.length > 0 ? (
                <div className="mt-3">
                  <div
                    className="text-[10px] font-bold uppercase tracking-[0.06em]"
                    style={{ color: 'var(--muted)' }}
                  >
                    What it read
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    {myTranscripts.map((t) => (
                      <div
                        key={t.id}
                        className="flex flex-wrap items-center gap-2 text-[12px]"
                      >
                        <Chip tone="slate">{t.kind}</Chip>
                        {t.url ? (
                          <a
                            href={t.url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-dotted underline-offset-2"
                          >
                            {t.title}
                          </a>
                        ) : (
                          <span>{t.title}</span>
                        )}
                        <Muted>
                          {t.occurredAt
                            ? t.occurredAt.toISOString().slice(0, 10)
                            : 'no date given'}
                          {' · '}
                          {t.length.toLocaleString()} chars
                          {t.ingestedBy ? ` · added by ${t.ingestedBy}` : ''}
                        </Muted>
                        <span className="ml-auto">
                          <RemoveTranscriptButton transcriptId={t.id} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </Card>
          )
        })
      )}
    </div>
  )
}
