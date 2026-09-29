/**
 * The template library: where the canonical copy of each document lives.
 *
 * The discovery question bank used to sit underneath it — a second page's
 * worth of prompts under a page that is a list of links. It is still in the
 * database and still seeded; it simply has no screen, which is the honest
 * state for something nobody was opening.
 *
 * Both halves exist for the same reason: the program team already wrote these
 * down, and a document nobody can find is functionally a document nobody
 * wrote. The question bank in particular is prompts rather than fields —
 * forcing "how far back are we going for history?" to be answered before a
 * date is committed, instead of in month three when the answer is expensive.
 */
import {
  Card,
  Chip,
  Empty,
  Kicker,
  SectionNote,
  type Tone,
} from '@/components/ui'
import {
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
  const templates = await getTemplates()

  return (
    <div className="grid gap-4">
      <div>
        <Kicker>Reference</Kicker>
        <h2 className="m-0 mt-0.5 text-[18px] font-bold tracking-[-0.01em]">Project Documents</h2>
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

    </div>
  )
}
