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
import { AssessmentText } from '@/components/assessment-text'
import { updateMixText } from '@/lib/update-mix'
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

/** The assessment in the words people use for it, not the traffic-light name. */
const RAG_WORD: Record<string, string> = {
  green: 'On track',
  amber: 'At risk',
  red: 'In trouble',
}

/**
 * The count beside a list of updates, and what it is made of.
 *
 * There was a dial here. The number inside it was the count of bullets,
 * which is a fact; the arc around it was the share Yaara had classified as
 * progress, drawn in the shape the rest of the app used for completion — so
 * "3" in a two-thirds-full ring read as "67% done" and meant "two of the
 * three things she wrote mention progress".
 *
 * The count stays, and so does the colour, which is the worst kind of thing
 * in the list. The composition is said in words instead of drawn as an arc.
 * See lib/update-mix.ts.
 */
function BulletCount({ items, label }: { items: UpdateBullet[]; label: string }) {
  const bad = items.some((i) => i.kind === 'blocker')
  const warn = items.some((i) => i.kind === 'risk' || i.kind === 'decision_needed')
  const color = bad ? 'var(--c3)' : warn ? 'var(--c2)' : items.length ? 'var(--c5)' : 'var(--line-2)'
  const mix = updateMixText(items)
  // Just the number here. The composition goes on the heading line, where
  // there is room for it to read as a sentence rather than wrap to four
  // lines in a gutter sized for a ring.
  return (
    <span className="hcount" title={`${items.length} ${label}${items.length === 1 ? '' : 's'}${mix ? ` — ${mix}` : ''}`}>
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
  canEdit,
}: {
  /** "Initiative", "Project", "Strategic Objective" — the tile is titled after it. */
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
        {/* A dial, not a percentage.
            This drew the same completion ring the board did, and the number
            behind it was the share of the calendar elapsed before the next
            milestone — which moves on its own, every day, whether or not any
            work happens. The RAG beside it is a real assessment somebody or
            Yaara made, and it is what this tile is actually reporting. See
            lib/card-health.ts. */}
        <span className="hrag" title={rag ? `Assessed ${RAG_WORD[rag] ?? rag}` : 'Nothing assessed yet'}>
          <i style={{ background: RAG_COLOR[rag ?? 'unknown'] ?? 'var(--line-2)' }} aria-hidden="true" />
          <b style={{ color: RAG_COLOR[rag ?? 'unknown'] ?? 'var(--muted)' }}>{rag ? (RAG_WORD[rag] ?? rag) : '—'}</b>
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
        <BulletCount items={stakeholder} label="stakeholder update" />
        <div className="hbody">
          <h3>
            Stakeholder Updates
            {stakeholder.length > 0 ? <span className="hmix">{updateMixText(stakeholder)}</span> : null}
          </h3>
          <Bullets items={stakeholder} />
        </div>
      </div>

      <div className="hrow">
        <BulletCount items={engineering} label="engineering update" />
        <div className="hbody">
          <h3>
            Engineering Updates
            {engineering.length > 0 ? <span className="hmix">{updateMixText(engineering)}</span> : null}
          </h3>
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
