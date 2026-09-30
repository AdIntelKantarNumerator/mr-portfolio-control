/**
 * What each editable field accepts, and what counts as a change.
 *
 * Split out of the server action so it can be tested without a database, a
 * request or a Next.js context. The action does the IO; this decides what is
 * allowed, and it is the only copy of that decision — the click-to-edit
 * controls, the agent API and anything added later all read the same table
 * rather than each re-deciding what a valid status is.
 */
import { PRIORITY, INITIATIVE_STATUS, OBJECTIVE_STATUS, PROJECT_STATUS_SET, isEnded } from './domain'

export interface FieldSpec {
  /** The column it lands in. */
  column: string
  /** A closed vocabulary, when the field has one. */
  allowed?: Set<string>
  /** Resolved against `people` by name. */
  person?: boolean
  /** A calendar date. */
  date?: boolean
  /** 0–100. */
  percent?: boolean
}

/**
 * The editable surface, per level.
 *
 * Deliberately small. Everything here is a value somebody reads off a row and
 * knows to be wrong; nothing here creates, deletes or re-parents anything,
 * because a list row is a bad place to do something you cannot see the
 * consequences of.
 */
export const FIELDS: Record<'objective' | 'initiative' | 'project', Record<string, FieldSpec>> = {
  // The grouping tier. Same four fields as an initiative, because the question
  // "who owns this and when does it land" does not change with the tier.
  objective: {
    status: { column: 'status', allowed: new Set<string>(OBJECTIVE_STATUS) },
    owner: { column: 'ownerId', person: true },
    startDate: { column: 'startDate', date: true },
    targetDate: { column: 'targetDate', date: true },
  },
  initiative: {
    status: { column: 'status', allowed: new Set<string>(INITIATIVE_STATUS) },
    owner: { column: 'ownerId', person: true },
    sponsor: { column: 'sponsorId', person: true },
    startDate: { column: 'startDate', date: true },
    targetDate: { column: 'targetDate', date: true },
  },
  project: {
    status: { column: 'status', allowed: new Set<string>(PROJECT_STATUS_SET) },
    priority: { column: 'priority', allowed: new Set<string>(PRIORITY) },
    lead: { column: 'leadId', person: true },
    startDate: { column: 'startDate', date: true },
    targetDate: { column: 'targetDate', date: true },
    progress: { column: 'progress', percent: true },
  },
}

export type Level = keyof typeof FIELDS

export function isLevel(v: string): v is Level {
  return v === 'objective' || v === 'initiative' || v === 'project'
}

export function specFor(level: Level, field: string): FieldSpec | undefined {
  return FIELDS[level][field]
}

/**
 * A date typed into a date picker, or cleared.
 *
 * Parsed at midnight UTC rather than local: a target date is a calendar date,
 * and letting the server's zone decide the instant is how "14 Nov" comes back
 * as the 13th to a reader in New York.
 */
export function parseDate(raw: string): { ok: true; value: Date | null } | { ok: false } {
  const s = raw.trim()
  if (!s) return { ok: true, value: null }
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, value: d }
}

/**
 * A percentage typed by hand.
 *
 * "80%", " 80 " and "80" are the same thing. A number outside the scale is
 * refused rather than clamped: 120 is a typo, and silently storing 100 hides
 * it from the person who could correct it.
 */
export function parsePercent(raw: string): { ok: true; value: number } | { ok: false; why: string } {
  const n = Number(raw.replace(/%/g, '').trim())
  if (!Number.isFinite(n) || raw.trim() === '') return { ok: false, why: 'That is not a number.' }
  if (n < 0 || n > 100) return { ok: false, why: 'Progress runs from 0 to 100.' }
  return { ok: true, value: Math.round(n) }
}

/**
 * Whether the edit is a no-op.
 *
 * Worth its own function because the two cases that matter are both easy to
 * get wrong: two Dates are never `===` even at the same instant, and null,
 * undefined and '' all mean "empty" arriving from different places. A no-op
 * that slips through writes a changelog line saying `Platform → Platform`,
 * which is how a log stops being read.
 */
export function isSameValue(before: unknown, after: unknown): boolean {
  if (before instanceof Date || after instanceof Date) {
    const a = before instanceof Date ? before.getTime() : null
    const b = after instanceof Date ? after.getTime() : null
    return a === b
  }
  const a = before === undefined || before === '' ? null : before
  const b = after === undefined || after === '' ? null : after
  return a === b
}

/**
 * Whether click-to-edit may make this status change.
 *
 * Only between live states. Ending work and bringing it back are decisions
 * somebody should be able to explain later, so they go through the lifecycle
 * control, which asks why (app/lifecycle). A pill that could close something
 * in one click was a second, unguarded way to do the same thing, and every
 * closure made that way reached the changelog with no reason.
 */
export function pillMayChangeStatus(before: string | null | undefined, after: string): boolean {
  return !isEnded(before) && !isEnded(after)
}
