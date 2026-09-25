/**
 * What is being talked about on this piece of work that nobody owns.
 *
 * Neither a decision nor a blocker, and therefore nothing anybody has to act
 * on — which is exactly why it is worth showing. A subject that has come up in
 * five meetings without becoming either is the thing most likely to become a
 * blocker next month, and it is invisible in every other view.
 *
 * Deliberately quieter than the assessments above it. These are read out of
 * documents by a machine and nobody has confirmed them, so they carry the same
 * warning an agent assessment does and none of the visual weight.
 */
import { Card, CardHeading, Muted } from './ui'

export interface ThemeRowView {
  id: string
  theme: string
  summary: string
  mentions: number
  lastMeeting: string | null
  lastSeenAt: Date | null
  authoredBy: string | null
}

function day(d: Date | null): string | null {
  if (!d) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function Themes({ themes }: { themes: ThemeRowView[] }) {
  if (themes.length === 0) return null

  const agent = themes.find((t) => t.authoredBy)?.authoredBy

  return (
    <Card>
      <CardHeading
        title="Also being discussed"
        sub="Read out of shared documents. Nobody owns these — they are here so a recurring subject is visible before it becomes a blocker."
      />
      <div className="flex flex-col gap-2.5">
        {themes.map((t) => (
          <div key={t.id} className="text-[12.5px]">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold">{t.theme}</span>
              <Muted>
                {/* Once is a mention; five times is a pattern. The count is the
                    whole reason a theme is worth reading. */}
                {t.mentions === 1 ? 'mentioned once' : `${t.mentions} mentions`}
                {t.lastMeeting ? ` · last in ${t.lastMeeting}` : ''}
                {day(t.lastSeenAt) ? ` · ${day(t.lastSeenAt)}` : ''}
              </Muted>
            </div>
            <p className="m-0 mt-0.5 leading-relaxed" style={{ color: 'var(--muted)' }}>
              {t.summary}
            </p>
          </div>
        ))}
      </div>
      {agent ? (
        <div className="mt-3">
          <Muted>
            Read from documents by {agent}. Not reviewed by anyone.
          </Muted>
        </div>
      ) : null}
    </Card>
  )
}
