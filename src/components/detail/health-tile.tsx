'use client'

/**
 * What Yaara makes of this, in three ringed rows.
 *
 * WHY THE "WRITTEN BY AN AGENT" BANNER IS GONE
 *
 * It was a violet note across the top of every card, and it was there for a
 * good reason: a machine's reading must not be mistaken for a person's. But a
 * banner that appears on every card every time is read once and then becomes
 * furniture, which means it stopped doing the job it was added for while
 * still taking the space.
 *
 * The attribution has not gone anywhere — it moved into the places a reader
 * actually looks. The assessment line carries the byline of whoever owns the
 * sentence, and it changes to a person's name the moment somebody edits it.
 * Every bullet's evidence is a hover away, and "What she read" lists it in
 * full. The claim is still checkable; it is no longer shouted.
 */
import { useState } from 'react'
import { Ring, paceColor } from '@/components/ring'
import { AssessmentText } from '@/components/assessment-text'
import { Tile } from './tile'

export interface UpdateBullet {
  id: string
  kind: string
  text: string
  /** Sources, for the hover. */
  detail?: string
}

export interface Evidence {
  id: string
  source: string
  title: string
  url: string | null
  occurredAt: string | null
  /**
   * Where inside its source this came from — a Slack channel, a repo, a
   * meeting series — and who wrote it, when Yaara knew.
   *
   * Optional because observations written before she started sending them do
   * not have it, and those rows are not rewritten. A line without them simply
   * offers no correction button.
   */
  location?: string | null
  author?: string | null
}

/**
 * Kinds, as a colour and a word.
 *
 * The word only ever appears in a tooltip now. A row of pills reading
 * "progress progress blocker progress" spent a third of the line width
 * telling the reader something a coloured dot tells them at a glance.
 */
const KIND: Record<string, { tone: string; label: string }> = {
  progress: { tone: 'var(--c5)', label: 'progress' },
  blocker: { tone: 'var(--c3)', label: 'blocker' },
  decision_needed: { tone: 'var(--c2)', label: 'decision needed' },
  decision_made: { tone: 'var(--c4)', label: 'decision made' },
  risk: { tone: 'var(--c2)', label: 'risk' },
  change: { tone: 'var(--c1)', label: 'change' },
}

const RAG_COLOR: Record<string, string> = {
  green: 'var(--good)',
  amber: 'var(--warn)',
  red: 'var(--crit)',
  unknown: 'var(--line-2)',
}

/**
 * The ring beside a list of updates.
 *
 * It fills with the share of those updates that report progress, and turns
 * the colour of the worst thing in the list. It is a shape of the list, not a
 * measurement of the work — the number in the middle is the count, which is
 * the only hard fact available here, and the tooltip says so.
 */
function BulletRing({ items, label }: { items: UpdateBullet[]; label: string }) {
  const good = items.filter((i) => i.kind === 'progress' || i.kind === 'decision_made').length
  const bad = items.some((i) => i.kind === 'blocker')
  const warn = items.some((i) => i.kind === 'risk' || i.kind === 'decision_needed')
  const pct = items.length === 0 ? 0 : Math.round((good / items.length) * 100)
  const color = bad ? 'var(--c3)' : warn ? 'var(--c2)' : items.length ? 'var(--c5)' : 'var(--line-2)'
  return (
    <span
      className="hring"
      title={`${items.length} ${label}${items.length === 1 ? '' : 's'} — ${good} reporting progress${
        bad ? ', and at least one blocker' : warn ? ', and at least one risk or open decision' : ''
      }`}
    >
      <Ring pct={pct} expected={0} color={color} />
      <b style={{ color }}>{items.length}</b>
    </span>
  )
}

function Bullets({ items }: { items: UpdateBullet[] }) {
  if (items.length === 0) return <p className="tile-empty">Nothing recorded.</p>
  return (
    <ul className="hbullets">
      {items.map((b) => {
        const k = KIND[b.kind] ?? { tone: 'var(--line-2)', label: b.kind }
        return (
          <li key={b.id} title={[k.label, b.detail].filter(Boolean).join(' · ')}>
            <i style={{ background: k.tone }} aria-hidden="true" />
            <span>{b.text}</span>
          </li>
        )
      })}
    </ul>
  )
}

export function HealthTile({
  tier,
  assessmentId,
  rag,
  confidence,
  summary,
  authoredBy,
  stakeholder,
  engineering,
  evidence,
  pct,
  expected,
  canEdit,
}: {
  /** "Project", "Workstream", "Initiative" — the tile is titled after it. */
  tier: string
  assessmentId: string | null
  rag: string | null
  confidence: string | null
  summary: string | null
  authoredBy: string | null
  stakeholder: UpdateBullet[]
  engineering: UpdateBullet[]
  evidence: Evidence[]
  /** Milestone completion and where the calendar says it should be. */
  pct: number
  expected: number
  canEdit: boolean
}) {
  const [reading, setReading] = useState(false)

  return (
    <Tile
      title={`${tier} Health`}
      icon="health"
      className="tile-health"
      right={
        evidence.length > 0 ? (
          <button type="button" className="tile-link" onClick={() => setReading(true)}>
            What she read
          </button>
        ) : null
      }
    >
      <div className="hrow">
        <span className="hring" title={`${pct}% of the way to the next milestone; the calendar says ${expected}%`}>
          <Ring pct={pct} expected={expected} color={RAG_COLOR[rag ?? 'unknown'] ?? paceColor('quiet', 0)} />
          <b style={{ color: RAG_COLOR[rag ?? 'unknown'] }}>{pct}%</b>
        </span>
        <div className="hbody">
          {summary && assessmentId ? (
            <>
              <p className="hlead">
                <AssessmentText id={assessmentId} text={summary} canEdit={canEdit} />
              </p>
              <p className="hnote">
                {confidence ? `${confidence} confidence` : null}
                {/* 'human' is the column's default for every row written
                    before agents existed, so it names nobody. A real name or
                    an agent's name is worth saying; that word is not. */}
                {confidence && authoredBy && authoredBy !== 'human' ? ' · ' : null}
                {authoredBy && authoredBy !== 'human' ? `by ${authoredBy}` : null}
              </p>
            </>
          ) : (
            <p className="hlead muted-lead">
              No assessment yet. Silence here means nothing was found, not that nothing happened.
            </p>
          )}
        </div>
      </div>

      <div className="hrow">
        <BulletRing items={stakeholder} label="stakeholder update" />
        <div className="hbody">
          <h3>Stakeholder Updates</h3>
          <Bullets items={stakeholder} />
        </div>
      </div>

      <div className="hrow">
        <BulletRing items={engineering} label="engineering update" />
        <div className="hbody">
          <h3>Engineering Updates</h3>
          <Bullets items={engineering} />
        </div>
      </div>

      {reading && (
        <div className="modal-scrim" role="presentation" onClick={() => setReading(false)}>
          <div className="modal" role="dialog" aria-label="What she read" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>What she read</h3>
              <button type="button" onClick={() => setReading(false)} aria-label="Close">
                ×
              </button>
            </div>
            <ul className="modal-list">
              {evidence.map((e) => (
                <li key={e.id}>
                  <span className="src">{e.source}</span>
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noreferrer">
                      {e.title}
                    </a>
                  ) : (
                    <span>{e.title}</span>
                  )}
                  {e.occurredAt ? <em>{e.occurredAt.slice(0, 10)}</em> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Tile>
  )
}
