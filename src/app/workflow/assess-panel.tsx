'use client'

/**
 * The assessment chat: ask, read the answer, see it lit on the map.
 *
 * An answer is three lists — directly changed, likely affected, possibly
 * affected — each item a component on the map with one reason. Clicking a
 * name opens that component's card. Downstream components judged not
 * affected are one click away, never hidden: "the model decided this does not
 * matter" is itself something a reader should be able to check.
 *
 * Two things this panel does that a plain chat would not:
 *
 *   When nothing on the map matches, it says so and offers to add the
 *   missing component, prefilled from the question. The map gets better
 *   every time it fails.
 *
 *   An answer given before the map changed says so, names what changed, and
 *   offers to ask again (lib/assessment.ts, whatChanged).
 */
import { startTransition, useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AssessmentView, WorkflowComponentRow, WorkflowLinkRow } from '@/lib/workflow'
import { whatChanged, type AnswerItem, type Suggestion } from '@/lib/assessment'
import { askAssessment, type AssessState } from './assess-actions'

export type Tier = 'direct' | 'likely' | 'possible'

/** Which tier each component is in, for the map's highlight. */
export function tierMap(view: AssessmentView): Map<string, Tier> {
  const m = new Map<string, Tier>()
  for (const x of view.answer.possible) m.set(x.id, 'possible')
  for (const x of view.answer.likely) m.set(x.id, 'likely')
  for (const x of view.answer.direct) m.set(x.id, 'direct')
  return m
}

const EXAMPLES = [
  'Change the rules about how we classify data for the automotive industry',
  'Change how we group media in Insights Studio',
  'Change our entitlement packages to include creative attributes',
]

const EMPTY: AssessState = {}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function AssessPanel({
  assessments,
  activeId,
  setActiveId,
  onFresh,
  components,
  links,
  answeredBy,
  onOpen,
  onAddSuggested,
  gaps,
}: {
  assessments: AssessmentView[]
  activeId: string | null
  setActiveId: (id: string | null) => void
  onFresh: (view: AssessmentView) => void
  components: WorkflowComponentRow[]
  links: WorkflowLinkRow[]
  answeredBy: string | null
  onOpen: (id: string) => void
  onAddSuggested: (s: Suggestion) => void
  gaps: ReactNode
}) {
  const [state, ask, asking] = useActionState(askAssessment, EMPTY)
  const [question, setQuestion] = useState('')
  const formRef = useRef<HTMLFormElement>(null)

  // A fresh answer is shown the moment it arrives, before the page's own list
  // has refreshed to include it.
  useEffect(() => {
    if (state.ok && state.view) {
      onFresh(state.view)
      setActiveId(state.view.id)
    }
  }, [state.stamp, state.ok, state.view, onFresh, setActiveId])

  const active = assessments.find((a) => a.id === activeId) ?? null

  const changed = useMemo(() => {
    if (!active) return []
    return whatChanged(
      active.relied,
      active.askedAt,
      components.map((c) => ({ ...c, groupName: '', owner: c.owner })),
      links.map((l) => ({ from: l.from, to: l.to })),
    )
  }, [active, components, links])

  // Sends the question straight to the action rather than through the
  // textarea: submitting the form on the next frame raced React putting the
  // question into the box, and sent an empty one.
  const askAgain = (q: string) => {
    setQuestion(q)
    const fd = new FormData()
    fd.set('question', q)
    startTransition(() => ask(fd))
  }

  return (
    <div className="wa-panel wa-assess">
      <h2 className="wa-panel-title">Assess a change</h2>
      <p className="wa-p wa-muted wa-small">
        {answeredBy
          ? `Answered from the map as it is now, by ${answeredBy}`
          : 'No language model is configured, so answers use keywords and the map\'s connections.'}
      </p>

      <form ref={formRef} action={ask} className="wa-form">
        <label className="wa-label" htmlFor="wa-question">
          What do you want to change?
        </label>
        <textarea
          id="wa-question"
          name="question"
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              formRef.current?.requestSubmit()
            }
          }}
          placeholder="e.g. I want to change how we group media in Insights Studio"
        />
        <div className="wa-row">
          <button type="submit" className="btn btn-primary" disabled={asking || question.trim().length < 8}>
            {asking ? 'Reading the map…' : 'Assess'}
          </button>
          {asking ? <span className="wa-muted wa-small">Matching the request to the map, then following its connections.</span> : null}
          {state.error ? <span className="wa-err">{state.error}</span> : null}
        </div>
      </form>

      {!active && !assessments.length ? (
        <div className="wa-examples">
          <h3 className="wa-h3">Try one</h3>
          {EXAMPLES.map((q) => (
            <button key={q} type="button" className="wa-chipbtn wa-example" onClick={() => setQuestion(q)}>
              {q}
            </button>
          ))}
        </div>
      ) : null}

      {active ? (
        <AnswerView view={active} changed={changed} onOpen={onOpen} onAskAgain={askAgain} onAddSuggested={onAddSuggested} onClose={() => setActiveId(null)} />
      ) : null}

      {assessments.length ? (
        <>
          <h3 className="wa-h3">Recent questions</h3>
          <ul className="wa-history">
            {assessments.slice(0, 12).map((a) => (
              <li key={a.id}>
                <button type="button" className={`wa-histbtn${a.id === activeId ? ' on' : ''}`} onClick={() => setActiveId(a.id === activeId ? null : a.id)}>
                  <span className="wa-histq">{a.question}</span>
                  <span className="wa-histmeta">
                    {a.askedBy ?? 'someone'} · {when(a.askedAt)}
                    {a.answer.none ? ' · nothing matched' : ` · ${a.answer.direct.length + a.answer.likely.length + a.answer.possible.length} components`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {gaps}
    </div>
  )
}

function AnswerView({
  view,
  changed,
  onOpen,
  onAskAgain,
  onAddSuggested,
  onClose,
}: {
  view: AssessmentView
  changed: string[]
  onOpen: (id: string) => void
  onAskAgain: (q: string) => void
  onAddSuggested: (s: Suggestion) => void
  onClose: () => void
}) {
  const a = view.answer
  return (
    <section className="wa-answer" aria-label="Assessment">
      <div className="wa-panel-head">
        <span className="wa-muted wa-small">
          Asked by {view.askedBy ?? 'someone'}, {when(view.askedAt)} · {view.method === 'model' ? 'model' : 'keywords'}
        </span>
        <button type="button" className="wa-x" aria-label="Close this answer" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="wa-q">&ldquo;{view.question}&rdquo;</p>

      {changed.length ? (
        <div className="wa-stale">
          <b>The map has changed since this answer.</b>
          <ul>
            {changed.slice(0, 6).map((c) => (
              <li key={c}>{c}</li>
            ))}
            {changed.length > 6 ? <li>and {changed.length - 6} more.</li> : null}
          </ul>
          <button type="button" className="btn" onClick={() => onAskAgain(view.question)}>
            Ask again
          </button>
        </div>
      ) : null}

      {a.summary ? <p className="wa-p">{a.summary}</p> : null}

      {a.none ? (
        <div className="wa-none">
          <p className="wa-p">
            <b>Nothing on the map matches.</b> {a.none}
          </p>
          {a.suggestion ? (
            <>
              {a.suggestion.name ? (
                <p className="wa-p wa-small">
                  Suggested: <b>{a.suggestion.name}</b>
                  {a.suggestion.description ? ` — ${a.suggestion.description}` : ''}
                </p>
              ) : null}
              <button type="button" className="btn" onClick={() => onAddSuggested(a.suggestion!)}>
                Add it to the map
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <TierList title="Directly changed" tone="direct" items={a.direct} onOpen={onOpen} />
      <TierList title="Likely affected" tone="likely" items={a.likely} onOpen={onOpen} />
      <TierList title="Possibly affected" tone="possible" items={a.possible} onOpen={onOpen} />

      {a.unaffected.length ? (
        <details className="wa-unaffected">
          <summary>
            {a.unaffected.length} more downstream, judged not affected by this change
          </summary>
          <span className="wa-chips">
            {a.unaffected.map((u) => (
              <button key={u.id} type="button" className="wa-chipbtn" onClick={() => onOpen(u.id)}>
                {u.name}
              </button>
            ))}
          </span>
        </details>
      ) : null}

      {a.notes.length ? (
        <ul className="wa-notes">
          {a.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function TierList({ title, tone, items, onOpen }: { title: string; tone: Tier; items: AnswerItem[]; onOpen: (id: string) => void }) {
  if (!items.length) return null
  return (
    <div className={`wa-tier wa-tier-${tone}`}>
      <h3 className="wa-h3">
        {title} ({items.length})
      </h3>
      <ul>
        {items.map((x) => (
          <li key={x.id}>
            <button type="button" className="wa-link" onClick={() => onOpen(x.id)}>
              {x.name}
            </button>
            . {x.why}
          </li>
        ))}
      </ul>
    </div>
  )
}
