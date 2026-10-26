/**
 * Delegating an item rather than reassigning it (Sadiya, 26 October 2026).
 *
 * Reassigning hands the item over on one person's say-so. Delegating asks
 * first: Yaara sends the person it would go to a message, they accept or
 * decline, and only an acceptance changes the owner. Until they answer the
 * item stays with whoever owns it now - their reminders keep coming, and the
 * pending delegation is shown on the item.
 *
 * Kept on the item as one JSON column, like `assignment`: one pending
 * delegation at a time; a second replaces the first. The history of it - asked,
 * accepted, declined - is in the item's events, where every change is.
 *
 *   to       who it would go to, as asked ("Priya Shah")
 *   toRef    how Yaara reaches them, "slack:U123": also who may answer
 *   by       who asked, as a person reads it
 *   byRef    how to tell them the answer, "slack:U456"
 *   at       when it was asked
 *   note     what the delegator said, if anything
 *   sentAt   when the message went to `to`; null until it has
 */
export interface Delegation {
  to: string
  toRef: string | null
  by: string
  byRef: string | null
  at: string
  note: string | null
  sentAt: string | null
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export function decodeDelegation(raw: string | null | undefined): Delegation | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Record<string, unknown>
    const to = text(d.to, 120)
    const by = text(d.by, 120)
    const at = text(d.at, 40)
    if (!to || !by || !at) return null
    return { to, toRef: text(d.toRef, 80), by, byRef: text(d.byRef, 80), at, note: text(d.note, 1000), sentAt: text(d.sentAt, 40) }
  } catch {
    return null
  }
}

export function encodeDelegation(d: Delegation | null): string | null {
  return d ? JSON.stringify(d) : null
}

/** A new delegation from what a caller sent; why not, when it cannot be one. */
export function newDelegation(
  input: { to?: string | null; toRef?: string | null; by: string; byRef?: string | null; note?: string | null },
  now: Date,
): Delegation | string {
  const to = text(input.to, 120)
  if (!to) return 'Delegate to whom? Give "owner".'
  return { to, toRef: text(input.toRef, 80), by: input.by.slice(0, 120), byRef: text(input.byRef, 80), at: now.toISOString(), note: text(input.note, 1000), sentAt: null }
}
