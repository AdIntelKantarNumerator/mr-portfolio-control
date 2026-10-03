'use client'

/**
 * One card per objective — or per initiative, or per project.
 *
 * The same card at every level, because the question is the same at each: is
 * this on track for its next milestone, and if not, what is in the way. Only
 * the rollup underneath changes.
 *
 * WHAT IS CLICKABLE, AND WHY THAT IS OBVIOUS
 *
 * Everything on it. The first version of this made the interactions real but
 * invisible — no chevrons, no hover, nothing to suggest a number could be
 * opened — so nobody found them. Every target now has a hover state and a
 * visible affordance: a chevron, a pencil, or a "where this comes from" link.
 *
 * Every visual also answers where its data came from. A ring that says 65% and
 * cannot tell you why is an assertion; the provenance panel behind it makes it
 * a claim somebody can check.
 */
import { useActionState, useState } from 'react'
import type { HomeCard } from '@/lib/home'
import type { MixGroup } from '@/lib/home-types'
import { LocalTime } from './local-time'
import { railLabels } from '@/lib/rail-labels'
import { SourceIcon, sourceLabel } from './source-icon'
import { HealthPanel } from './health-state'
import { saveVerdict, restoreVerdict, type VerdictState } from '@/app/verdict-actions'
import { useReassess } from './reassess-button'

const STATUS = {
  good: { label: 'On track', tone: 'good' },
  warn: { label: 'At risk', tone: 'warn' },
  crit: { label: 'Blocked', tone: 'crit' },
  quiet: { label: 'No signal', tone: 'quiet' },
} as const

/**
 * Two vocabularies land on these cards: milestones use the deck's legend, and
 * projects use the lifecycle's. Both are here because the rail and the mix
 * bar sit on the same card and must not disagree about what green means.
 */
const MS_COLOR: Record<string, string> = {
  // milestone statuses
  complete: 'var(--c1)',
  on_track: 'var(--c5)',
  at_risk: 'var(--c2)',
  blocked: 'var(--c3)',
  planning: 'var(--line-2)',
  // project and initiative statuses
  completed: 'var(--c1)',
  // In-progress work, split by whether anything is in its way. Red here is
  // the one place it is earned on this bar: somebody has raised a blocker and
  // it is still open, which is precisely "needs attention".
  in_progress_on_track: 'var(--c5)',
  in_progress_blocked: 'var(--c3)',
  // Kept for any row whose blocker state could not be determined.
  in_progress: 'var(--c5)',
  active: 'var(--c5)',
  paused: 'var(--c2)',
  backlog: 'var(--line-3)',
  planned: 'var(--line-2)',
  // Red is reserved for "somebody needs to do something". Cancelled work
  // needs nothing from anybody; it was red here, which made every card with
  // a tidy-up on it look like a card in trouble.
  canceled: 'var(--ended)',
  cancelled: 'var(--ended)',
  withdrawn: 'var(--ended)',
}

const SIGNAL = {
  blocker: { color: 'var(--c3)', label: 'Blockers' },
  decision: { color: 'var(--c4)', label: 'Decisions' },
  action: { color: 'var(--c1)', label: 'Action items' },
} as const

function Chevron({ open = false }: { open?: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }}
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ObjectiveCard({
  card,
  onOpen,
}: {
  card: HomeCard
  onOpen: (title: string, body: React.ReactNode) => void
}) {
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const [saveState, save, saving] = useActionState<VerdictState, FormData>(saveVerdict, {})
  const [, restore] = useActionState<VerdictState, FormData>(restoreVerdict, {})
  const reassess = useReassess(card.level, card.id)

  const st = STATUS[card.health]

  const edited = Boolean(card.verdictEditedBy)
  const byline = edited ? card.verdictEditedBy : 'Yaara'

  /** What is actually in one segment of the mix bar. */
  function openMix(g: MixGroup) {
    const noun = card.level === 'objective' ? 'initiative' : card.level === 'initiative' ? 'project' : 'milestone'
    onOpen(
      `${card.name} — ${g.members.length} ${noun}${g.members.length === 1 ? '' : 's'} ${g.label}`,
      <div>
        <p className="lead">
          Counted from the status on each {noun} directly beneath this {card.level} — not from everything further
          down, which is a different and usually larger number.
        </p>
        <div className="chips">
          {g.members.map((m) => (
            <a key={m.id} href={m.href}>
              {m.name}
            </a>
          ))}
        </div>
      </div>,
    )
  }

  function provenance(what: string, extra?: React.ReactNode) {
    onOpen(`${card.name} — where ${what} comes from`, (
      <div>
        <p className="lead">
          {card.evidence.length
            ? `Read from ${card.evidence.length} source${card.evidence.length === 1 ? '' : 's'}.`
            : 'Nothing has been read about this yet.'}
        </p>
        {extra}
        {card.evidence.length > 0 && (
          <>
            <h4>Sources</h4>
            <div className="ev">
              {card.evidence.map((e, i) => (
                <EvidenceRow key={i} e={e} />
              ))}
            </div>
          </>
        )}
        <h4>How to check it yourself</h4>
        <p>
          Everything above is a link to the thing she read. If a number here looks wrong, the source is where the
          disagreement is — not her arithmetic.
        </p>
      </div>
    ))
  }

  return (
    <article className="icard" style={{ ['--edge' as string]: `var(--${st.tone})` }}>
      <div className="ihead">
        <div className="nm">
          <h2>
            <a href={card.href}>{card.name}</a>
          </h2>
          <span className="meta">
            {card.owner ? `${card.owner} · ` : ''}
            {card.beneath}
          </span>
        </div>
        <div className="right">
          <span className={`status ${st.tone}`}>{st.label}</span>
          <a className="drill" href={card.href}>
            Open
            <Chevron />
          </a>
        </div>
      </div>

      <div className="ibody">
        <div className="panel">
          <p className="ptitle">Health</p>
          {/* A state and the facts behind it. There was a completion ring
              here; every version of its number was computed from something
              other than work done. See lib/card-health.ts. */}
          <HealthPanel health={card.health} reasons={card.reasons} />
        </div>

        <div className="panel">
          {editing ? (
            <form
              action={(fd) => {
                save(fd)
                setEditing(false)
              }}
              className="vedit"
            >
              <input type="hidden" name="level" value={card.level} />
              <input type="hidden" name="entityId" value={card.id} />
              <input type="hidden" name="entityName" value={card.name} />
              <textarea
                name="verdict"
                defaultValue={card.verdict ?? ''}
                rows={3}
                autoFocus
                aria-label="Assessment"
              />
              <div className="vrow">
                <button className="btn primary" type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn" type="button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                {edited && (
                  <button className="btn" formAction={restore} type="submit">
                    Restore Yaara&rsquo;s
                  </button>
                )}
                {saveState.error && <span className="err">{saveState.error}</span>}
              </div>
            </form>
          ) : (
            <div className="vwrap">
              <button
                className={`verdict${reassess.running ? ' reassessing' : ''}`}
                aria-busy={reassess.running}
                onClick={() =>
                  onOpen(`${card.name} — assessment`, (
                    <div>
                      <p className="lead">{card.verdict ?? 'Nothing assessed yet.'}</p>
                      {card.verdictRolledUp && (
                        <p>
                          Nothing has been assessed against this {card.level} itself. What follows is every update
                          from the {card.verdictRolledUp} inside it, newest first, with duplicates removed.
                        </p>
                      )}
                      {card.detail.map((d, i) => (
                        <p key={i} className="point">
                          {d.text}
                          {/* The sources this point rests on, at its end:
                              each one opens what she read, a meeting's
                              document included. */}
                          {d.cites.length > 0 && (
                            <span className="cites">
                              {d.cites.map((c, j) => (
                                <SourceIcon key={j} source={c.source} href={c.url} what={c.title} />
                              ))}
                            </span>
                          )}
                        </p>
                      ))}
                      {card.evidence.length > 0 && (
                        <>
                          <h4>What this is based on</h4>
                          <div className="ev">
                            {card.evidence.map((e, i) => (
                              <EvidenceRow key={i} e={e} />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))
                }
              >
                {card.verdict ?? <span className="empty">No assessment yet.</span>}
                <span className="sig">
                  {byline}
                  {edited ? ' (edited)' : ''}
                  {/* A borrowed assessment says so. Presenting an initiative's
                      sentence as though it were written about the objective
                      would be the kind of quiet inaccuracy nobody catches. */}
                  {card.verdictRolledUp ? ` · from ${card.verdictRolledUp}` : ''}
                  {card.verdictStale ? <span className="sig-stale"> · {card.verdictStale}</span> : null}
                  {card.verdictAt ? (
                    <>
                      {' · '}
                      <LocalTime at={new Date(card.verdictAt).toISOString()} show="date" />
                    </>
                  ) : null}
                  {' · '}
                  <b>see the evidence ›</b>
                </span>
              </button>
              <div className="vtools">
              <button className="pencil" onClick={() => setEditing(true)} title="Edit this assessment" aria-label="Edit assessment">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M11.2 2.4l2.4 2.4M2.5 11.1l8.1-8.1 2.4 2.4-8.1 8.1-3.1.7.7-3.1z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {reassess.button}
              </div>
            </div>
          )}
          {!editing && reassess.note}

          {card.rail.length > 0 && (
            <>
              <p className="ptitle">Milestone rail</p>
              <button
                className="rail"
                onClick={() =>
                  onOpen(`${card.name} — milestones`, (
                    <div>
                      <p className="lead">{card.rail.length} milestones on this rail.</p>
                      <ul>
                        {card.rail.map((m) => (
                          <li key={m.id}>
                            {m.name} — {m.status.replace('_', ' ')}
                          </li>
                        ))}
                      </ul>
                      <h4>Where this comes from</h4>
                      <p>The milestones recorded against this {card.level} and the work beneath it.</p>
                    </div>
                  ))
                }
              >
                <span className="railline">
                  {/* No progress fill: there was one, drawn to a percentage
                      that measured elapsed time rather than work. What is
                      left is a span of dates and a line for today, both of
                      which are facts. */}
                  {card.railToday !== null ? (
                    <span className="railnow" style={{ left: `${card.railToday}%` }} title="Today" />
                  ) : null}
                </span>
                <span className="dots">
                  {/* Every dot where its date puts it; the words are laid out
                      separately, from the real gaps. See lib/rail-labels.ts. */}
                  {card.rail.map((m) => (
                    <span
                      className="dot"
                      key={m.id}
                      title={m.on ? `${m.name} — ${m.on}` : m.name}
                      style={{ left: `${m.at}%`, color: MS_COLOR[m.status] }}
                    >
                      <i style={{ background: MS_COLOR[m.status] }} />
                    </span>
                  ))}
                  {railLabels(card.rail).map((l) => (
                    <span
                      className={`rlabel ${l.anchor}`}
                      key={l.key}
                      title={l.title}
                      style={{ left: `${l.at}%`, maxWidth: `${l.width}%` }}
                    >
                      {l.text}
                    </span>
                  ))}
                </span>
              </button>
            </>
          )}
        </div>

        <div className="panel signals">
          <p className="ptitle">Signals — tap to expand</p>
          {card.signals.length === 0 ? (
            <p className="empty">
              No blockers, decisions or actions recorded. Consistent with the silence, not evidence of health.
            </p>
          ) : (
            card.signals.map((s, i) => (
              <div key={s.kind}>
                <button className="sig-row" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                  <span className="sw" style={{ background: SIGNAL[s.kind].color }} />
                  <span className="tx">
                    {s.summary}
                    <em>{SIGNAL[s.kind].label}</em>
                  </span>
                  <span className="ct">{s.items.length}</span>
                  <span className="cv">
                    <Chevron open={open === i} />
                  </span>
                </button>
                {open === i && (
                  <div className="kids">
                    {s.items.map((it) => (
                      <a key={it.id} href={it.href ?? '#'}>
                        <span>
                          {it.text}
                          {/* Which project — or, failing that, initiative — it
                              is about. Nothing when neither is known. */}
                          {it.where ? <small className="where">{it.where}</small> : null}
                        </span>
                        <span className="when">
                          {it.who ? `${it.who} · ` : ''}
                          {it.when}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="ifoot">
        {/* Each segment is its own button. One button for the whole bar could
            only ever say how many are in each state; a bar you cannot ask
            "which ones" is a bar you have to take on trust. */}
        <div className="mixwrap">
          <span className="mixbar">
            {card.mix.map((g) => (
              <button
                key={g.status}
                style={{ flex: g.members.length, background: MS_COLOR[g.status] ?? 'var(--line-2)' }}
                title={`${g.members.length} ${g.label} — click to see which`}
                aria-label={`${g.members.length} ${g.label}`}
                onClick={() => openMix(g)}
              />
            ))}
          </span>
          <span className="mixlegend">
            {card.mix.map((g) => (
              <button key={g.status} onClick={() => openMix(g)}>
                <i style={{ background: MS_COLOR[g.status] ?? 'var(--line-2)' }} />
                {g.label} <b>{g.members.length}</b>
              </button>
            ))}
          </span>
        </div>

        <button
          className="trendwrap"
          onClick={() =>
            provenance(
              'the activity score',
              <p>
                Commits, messages and meeting mentions counted over a widening window — not a judgement. It sets the sort
                order on this page, and an entity with a score of zero is flagged rather than assessed.
              </p>,
            )
          }
        >
          <span className="spark">
            {card.activity.map((v, i) => {
              const max = Math.max(1, ...card.activity)
              return <i key={i} style={{ height: `${Math.max(2, (v / max) * 28)}px`, opacity: i >= 5 ? 1 : 0.38 }} />
            })}
          </span>
          <span className="trendmeta">
            <b>{card.activityDelta}</b>
            activity
            <br />
            score
          </span>
        </button>
      </div>
    </article>
  )
}

/**
 * One thing she read: where from, what it was, and a link to it when there is
 * one. Both evidence lists on the card use this, so the one behind "see the
 * evidence" links the same as the other. The source marks live on the points
 * above instead, next to the sentence each source supports.
 */
function EvidenceRow({ e }: { e: { source: string; text: string; url: string | null } }) {
  return (
    <div>
      <span className="s">{sourceLabel(e.source)}</span>
      <span>
        {e.url ? (
          <a href={e.url} target="_blank" rel="noreferrer noopener" className="lnk">
            {e.text}
          </a>
        ) : (
          e.text
        )}
      </span>
    </div>
  )
}
