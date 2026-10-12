/**
 * A proposed agenda for a series' next session: the pure part, kept apart from
 * the database and the model so it can be tested (12 October 2026).
 *
 * The agenda answers what the hand-written "Review on Friday" list answered:
 * what has to be decided first, which few topics the session should spend its
 * time on and why, and what looks wrong - judged against what the series is
 * for, not just against what happens to be open. It is built from the last few
 * session summaries, the open items and what changed since; every item it
 * names must be a real ref, and anything else is dropped.
 */
import { createHash } from 'node:crypto'

export interface AgendaPoint {
  title: string
  why: string
  refs: string[]
}

export interface AgendaTopic extends AgendaPoint {
  minutes: number | null
}

export interface Agenda {
  /** Questions that need a decision, first thing. */
  decideFirst: AgendaPoint[]
  topics: AgendaTopic[]
  /** One or two sentences: where the series stands against its goals. */
  goalCheck: string | null
  /** Conflicts, ambiguous owners, things recorded two ways. */
  flags: string[]
}

export interface AgendaItemLine {
  ref: string
  kind: 'blocker' | 'decision' | 'action'
  title: string
  owner: string | null
  due: string | null
  place: string | null
  section: string | null
  quiet: number
  heldUntil: string | null
  change: string | null
  suggested: string | null
}

export interface AgendaInput {
  seriesName: string
  goals: string | null
  forDay: string
  lastDay: string | null
  summaries: Array<{ meeting: string; sessionDay: string; text: string; stamp: string }>
  items: AgendaItemLine[]
}

export const AGENDA_SYSTEM = `You prepare the agenda for the next session of a recurring working session, for the person who chairs it. Your job is to drive the series toward its goals, not to list everything that is open.

You are given: what the series is for (its goals), the summaries of the last few sessions, and the items still open, each with its ref (A12 action, B3 blocker, D7 decision), owner, due date, topic, and how many sessions have gone by since anyone mentioned it.

Produce JSON only, in exactly this shape:
{"decideFirst":[{"title":"...","why":"...","refs":["B3"]}],
 "topics":[{"title":"...","minutes":15,"why":"...","refs":["A12","B3"]}],
 "goalCheck":"...",
 "flags":["..."]}

Rules:
- decideFirst: at most 5. Each is a question the session must settle, phrased as a question, with who decides if the notes say. Prefer: a blocker on the path to the goals, a decision recorded two different ways, a scope call left TBD, an item with nobody owning it that matters.
- topics: 3 to 7, in the order the session should take them, sized in minutes for a 60-minute session. Group related items into one topic. Each "why" is one sentence saying why it needs the room now, not what the item is.
- Leave out what does not need the meeting: routine actions on track, things already done, anything on hold until after the session.
- An item no one has mentioned for 3 or more sessions is either done and not closed or stuck and not owned: name the ones that matter.
- goalCheck: one or two plain sentences on progress against the goals, honest about what is at risk.
- flags: conflicts between the summaries and the items, owners that are ambiguous, dates that disagree. Empty if none.
- Use only refs from the items given. Never invent a name, date, ref or decision.
- Plain English, short, no filler.`

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…[cut]` : s)

export function agendaUserPrompt(input: AgendaInput): string {
  const items = input.items
    .map((i) =>
      [
        `${i.ref} [${i.kind}] ${i.title}`,
        `owner: ${i.owner ?? 'nobody'}`,
        i.due ? `due: ${i.due}` : null,
        i.place ? `topic: ${i.place}` : null,
        i.section ? `since last session: ${i.section}` : null,
        `quiet for ${i.quiet} session(s)`,
        i.heldUntil ? `ON HOLD until ${i.heldUntil}` : null,
        i.change ? `latest: ${i.change}` : null,
        i.suggested ? `looks done: ${i.suggested}` : null,
      ]
        .filter(Boolean)
        .join(' | '),
    )
    .join('\n')
  const summaries = input.summaries
    .map((s) => `### ${s.meeting}, ${s.sessionDay}\n${clip(s.text, 14_000)}`)
    .join('\n\n')
  return [
    `SERIES: ${input.seriesName}`,
    `GOALS: ${input.goals?.trim() || '(none written; infer what the series is for from the summaries, and say so in goalCheck)'}`,
    `NEXT SESSION: ${input.forDay}${input.lastDay ? ` (last session ${input.lastDay})` : ''}`,
    `RECENT SESSION SUMMARIES (oldest first):\n${summaries || '(none yet)'}`,
    `OPEN ITEMS:\n${items || '(none)'}`,
  ].join('\n\n')
}

/** What an agenda was built from. A different fingerprint means it is out of date. */
export function agendaFingerprint(input: AgendaInput): string {
  const h = createHash('sha256')
  h.update(JSON.stringify([input.goals ?? '', input.forDay, input.summaries.map((s) => s.stamp), input.items]))
  return h.digest('hex').slice(0, 32)
}

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)

/** The model's reply, checked: only real refs, sensible sizes, nothing missing. Null when unreadable. */
export function parseAgenda(raw: string, knownRefs: ReadonlySet<string>): Agenda | null {
  let parsed: unknown
  const body = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    parsed = JSON.parse(body)
  } catch {
    const a = body.indexOf('{')
    const b = body.lastIndexOf('}')
    if (a < 0 || b <= a) return null
    try {
      parsed = JSON.parse(body.slice(a, b + 1))
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  const refs = (v: unknown) =>
    [...new Set((Array.isArray(v) ? v : []).map((r) => String(r).trim().toUpperCase()).filter((r) => knownRefs.has(r)))]
  const point = (p: unknown): AgendaPoint | null => {
    const r = (p ?? {}) as Record<string, unknown>
    const title = text(r.title, 200)
    return title ? { title, why: text(r.why, 400), refs: refs(r.refs) } : null
  }
  const decideFirst = (Array.isArray(o.decideFirst) ? o.decideFirst : []).map(point).filter((p): p is AgendaPoint => Boolean(p)).slice(0, 5)
  const topics = (Array.isArray(o.topics) ? o.topics : [])
    .map((t): AgendaTopic | null => {
      const p = point(t)
      if (!p) return null
      const m = Number((t as Record<string, unknown>).minutes)
      return { ...p, minutes: Number.isFinite(m) && m >= 1 && m <= 90 ? Math.round(m) : null }
    })
    .filter((t): t is AgendaTopic => Boolean(t))
    .slice(0, 8)
  if (!decideFirst.length && !topics.length) return null
  return {
    decideFirst,
    topics,
    goalCheck: text(o.goalCheck, 600) || null,
    flags: (Array.isArray(o.flags) ? o.flags : []).map((f) => text(f, 300)).filter(Boolean).slice(0, 8),
  }
}
