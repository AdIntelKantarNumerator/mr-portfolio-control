/**
 * A small mark for where a piece of evidence came from.
 *
 * The evidence list names its source in a narrow uppercase column, which is
 * easy to read past when every row is "GITHUB". A glyph at the end of the row
 * is what the eye catches when scanning for "was any of this said in a
 * meeting". Generic glyphs, coloured per source, rather than copies of each
 * company's logo: they only have to be told apart from each other, and the
 * title says the name.
 *
 * Source names are Yaara's (her collectors, and `initiative` for an objective's
 * rolled-up initiative assessments). Anything unknown gets a plain document.
 */

type Glyph = 'branch' | 'chat' | 'meeting' | 'ticket' | 'layers' | 'doc'

const SOURCES: Record<string, { label: string; glyph: Glyph; color: string }> = {
  github: { label: 'GitHub', glyph: 'branch', color: 'var(--ink)' },
  'azure-repos': { label: 'Azure Git', glyph: 'branch', color: '#0078d4' },
  slack: { label: 'Slack', glyph: 'chat', color: '#611f69' },
  meeting: { label: 'Meeting', glyph: 'meeting', color: '#188038' },
  meetings: { label: 'Meeting', glyph: 'meeting', color: '#188038' },
  linear: { label: 'Linear', glyph: 'ticket', color: '#5e6ad2' },
  initiative: { label: 'Initiative', glyph: 'layers', color: 'var(--brand)' },
}

export function sourceLabel(source: string): string {
  return SOURCES[source]?.label ?? source
}

/**
 * `href` makes the mark a link to the thing itself; `what` names it in the
 * hover ("Slack — #gpc-taxonomy"), so a reader knows where it goes first.
 */
export function SourceIcon({ source, href, what }: { source: string; href?: string | null; what?: string }) {
  const s = SOURCES[source] ?? { label: source, glyph: 'doc' as const, color: 'var(--muted)' }
  const isMeeting = s.glyph === 'meeting'
  const hasLink = Boolean(href)
  const base =
    isMeeting && !hasLink
      ? `${s.label} — read from a transcript file, so there is no document to open`
      : isMeeting
        ? `${s.label} — opens the meeting document`
        : source === 'initiative'
          ? 'An initiative’s latest assessment, rolled up into this objective'
          : s.label
  const title = what ? `${base}: ${what}` : base

  const mark = (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[s.glyph]}
    </svg>
  )
  return href ? (
    <a className="srcicon" href={href} target="_blank" rel="noreferrer noopener" title={title} aria-label={title} style={{ color: s.color }}>
      {mark}
    </a>
  ) : (
    <span className="srcicon" title={title} aria-label={title} role="img" style={{ color: s.color }}>
      {mark}
    </span>
  )
}

const GLYPHS: Record<Glyph, React.ReactNode> = {
  // A branch: two commits and a merge.
  branch: (
    <>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M4.5 5v6M11.5 7c0 3-4 2.5-6.2 4.3" />
    </>
  ),
  // A speech bubble.
  chat: <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />,
  // A calendar page.
  meeting: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </>
  ),
  // A ticket.
  ticket: <path d="M2.5 5V3.5h11V5a1.5 1.5 0 0 0 0 3v4.5h-11V8a1.5 1.5 0 0 0 0-3z" />,
  // Stacked layers: the work beneath.
  layers: <path d="M8 2.5l5.5 3-5.5 3-5.5-3zM2.5 8.5l5.5 3 5.5-3M2.5 11l5.5 3 5.5-3" />,
  // A page.
  doc: <path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" />,
}
