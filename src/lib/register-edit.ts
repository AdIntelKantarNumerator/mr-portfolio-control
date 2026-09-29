/**
 * What may be changed on a blocker or a dependency, and what a change has to
 * satisfy before it is written.
 *
 * WHY THE RULES ARE HERE AND NOT IN THE SERVER ACTION
 *
 * Adding a register entry and editing one are the same judgements — a title
 * has to say something, a body has to be readable in three weeks, a date has
 * to be a date, nothing may depend on itself. Those judgements were written
 * once for adding, inside a function that also talks to the database, so the
 * only way to test them was to have a database, and the only way to reuse them
 * on the edit path would have been to write them a second time. Two copies of
 * a validation rule is how "say a little more" starts meaning one thing on one
 * screen and nothing at all on another.
 *
 * So the rules live here, with no database import, and the actions call them.
 *
 * WHY EDITING IS NARROWER THAN ADDING
 *
 * A blocker's `ref` is the handle people say out loud in a meeting, and its
 * `raisedBy` is a fact about something that already happened. Neither is
 * offered: renaming a live item is how a register stops being recognisable to
 * the people in it, and a record of who hit the wall is not improved by being
 * editable months later.
 */

export interface Fault {
  /** Which field to point at, when the form has one. */
  field?: string
  message: string
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: Fault }

const ok = <T>(value: T): Checked<T> => ({ ok: true, value })
const no = (message: string, field?: string): Checked<never> => ({ ok: false, error: { field, message } })

export const BLOCKER_STATUS = ['open', 'watch', 'decided', 'dropped'] as const
export const BLOCKER_CATEGORY = ['delivery', 'strategic', 'risk'] as const
export const DEPENDENCY_STATUS = ['open', 'at_risk', 'resolved', 'accepted_risk'] as const
export const DEPENDENCY_KIND = ['blocks', 'informs', 'shares_resource', 'related'] as const
export const CRITICALITY = ['normal', 'high', 'critical'] as const

const one = (allowed: readonly string[], v: string | null | undefined, fallback: string) =>
  allowed.includes(String(v)) ? String(v) : fallback

/**
 * A date from a date input.
 *
 * Empty means "no date", which is a real answer and not a mistake — a blocker
 * nobody has put a date on is the normal case. Anything else has to parse, and
 * a string that does not is the caller's problem rather than a silent null:
 * writing null for an unparseable date loses the only thing the reader typed.
 */
export function parseDay(raw: string | null | undefined, field: string): Checked<Date | null> {
  const text = (raw ?? '').trim()
  if (!text) return ok(null)
  const at = new Date(`${text}T00:00:00Z`)
  if (Number.isNaN(at.getTime())) return no('That is not a date.', field)
  return ok(at)
}

/** "project:abc" → { type, id }. The form's one field for a two-part answer. */
export function parseEndpoint(raw: string | null | undefined): { type: string; id: string } | null {
  const [type, ...rest] = String(raw ?? '').split(':')
  const id = rest.join(':')
  if (!type || !id) return null
  return { type, id }
}

export interface BlockerEdit {
  title: string
  body: string
  status: string
  category: string
  ownerId: string | null
  dueBy: string | null
  /** Where it is filed. Empty entityId means "nothing in particular". */
  level: string | null
  entityId: string | null
}

export function blockerPatch(input: {
  title?: string
  body?: string
  status?: string
  category?: string
  ownerId?: string | null
  dueBy?: string | null
  /** "project:abc", or "" for nothing in particular. */
  at?: string | null
}): Checked<BlockerEdit> {
  const title = (input.title ?? '').trim()
  const body = (input.body ?? '').trim()
  if (title.length < 3) return no('Say what is blocked, in a few words.', 'title')
  // Same bar as raising one. The body is what somebody reads in three weeks,
  // when the title has stopped meaning anything to them.
  if (body.length < 3) return no('Say what is actually in the way.', 'body')

  const at = (input.at ?? '').trim()
  let level: string | null = null
  let entityId: string | null = null
  if (at) {
    const end = parseEndpoint(at)
    if (!end || !['initiative', 'project', 'workstream'].includes(end.type)) {
      return no('That is not a piece of work this portfolio has.', 'at')
    }
    level = end.type
    entityId = end.id
  }

  return ok({
    title,
    body,
    status: one(BLOCKER_STATUS, input.status, 'open'),
    category: one(BLOCKER_CATEGORY, input.category, 'delivery'),
    ownerId: (input.ownerId ?? '').trim() || null,
    // Free text on purpose: "next leads", "~7/10", "this week" is what people
    // say, and a date picker invents a precision they do not have.
    dueBy: (input.dueBy ?? '').trim() || null,
    level,
    entityId,
  })
}

export interface DependencyEdit {
  fromType: string
  fromId: string
  toType: string
  toId: string
  kind: string
  status: string
  criticality: string
  description: string | null
  dueDate: Date | null
  ownerId: string | null
}

export function dependencyPatch(input: {
  from?: string
  to?: string
  kind?: string
  status?: string
  criticality?: string
  description?: string | null
  dueDate?: string | null
  ownerId?: string | null
}): Checked<DependencyEdit> {
  const from = parseEndpoint(input.from)
  const to = parseEndpoint(input.to)
  if (!from) return no('Pick what has to land.', 'from')
  if (!to) return no('Pick what is waiting on it.', 'to')
  // Not a pedantic check: a row pointing at itself is drawn as an arrow with
  // no direction and marks its own work blocked on its own account.
  if (from.type === to.type && from.id === to.id) return no('Something cannot depend on itself.', 'to')

  const due = parseDay(input.dueDate, 'dueDate')
  if (!due.ok) return due

  return ok({
    fromType: from.type,
    fromId: from.id,
    toType: to.type,
    toId: to.id,
    kind: one(DEPENDENCY_KIND, input.kind, 'blocks'),
    status: one(DEPENDENCY_STATUS, input.status, 'open'),
    criticality: one(CRITICALITY, input.criticality, 'normal'),
    description: (input.description ?? '').trim() || null,
    dueDate: due.value,
    ownerId: (input.ownerId ?? '').trim() || null,
  })
}

/**
 * What changed, in words, for the changelog.
 *
 * A log line saying "blocker edited" tells the next reader that something
 * moved and nothing about what — which is the same as not logging it. This
 * names the fields and, for the short ones, what they became.
 */
export function describeChange(
  // `object` rather than an index signature: the callers pass a database row
  // and a patch, which are interfaces, and an interface is not assignable to
  // Record<string, unknown> however many string keys it has.
  before: object,
  after: object,
  labels: Record<string, string>,
): string[] {
  const was = before as Record<string, unknown>
  const now = after as Record<string, unknown>
  const out: string[] = []
  for (const [key, label] of Object.entries(labels)) {
    const a = norm(was[key])
    const b = norm(now[key])
    if (a === b) continue
    out.push(b === '' ? `${label} cleared` : a === '' ? `${label} set to ${short(b)}` : `${label} ${short(a)} → ${short(b)}`)
  }
  return out
}

function norm(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim()
}

const short = (v: string) => (v.length > 60 ? `${v.slice(0, 57)}…` : v)
