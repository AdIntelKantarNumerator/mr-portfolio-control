/**
 * Who gave an item to its owner, and who was in the meeting it came from
 * (Scott, 22 October 2026).
 *
 * David Hudzinski was reminded about B148, A760 and A1003, each filed from a
 * meeting he was not in. Read cold, "yours" looks like a mistake, and some of
 * them were - so a reminder now says who handed it over when the person was
 * not there, and the record keeps what that needs: who assigned it, the
 * invite's owner, and who was invited. One JSON column on each item table,
 * written by Yaara when she files an item and back-filled for open ones.
 *
 *   by          who in the meeting gave or asked for it, as a full name when it
 *               could be settled; null when the notes do not say
 *   organizer   who owns the meeting invite
 *   attendees   everyone invited, by full name; empty when nobody could be
 *               read, which means "unknown", never "nobody was there"
 */
export interface Assignment {
  by: string | null
  organizer: string | null
  attendees: string[]
}

const name = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null)

/** An assignment from a caller, or null when it says nothing usable. */
export function cleanAssignment(raw: unknown): Assignment | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const attendees = Array.isArray(r.attendees) ? r.attendees.map(name).filter((n): n is string => Boolean(n)).slice(0, 100) : []
  const a = { by: name(r.by), organizer: name(r.organizer), attendees }
  return a.by || a.organizer || a.attendees.length ? a : null
}

export function encodeAssignment(a: Assignment | null): string | null {
  return a ? JSON.stringify(a) : null
}

export function decodeAssignment(text: string | null | undefined): Assignment | null {
  if (!text) return null
  try {
    return cleanAssignment(JSON.parse(text))
  } catch {
    return null
  }
}
