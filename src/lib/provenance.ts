/**
 * Where a register entry came from.
 *
 * Yaara reads meeting transcripts and documents and files what she finds, and
 * she records where each thing was said — the meeting, the date, who said it,
 * and often the sentence itself. None of that has ever been visible on the
 * three list pages. The reader sees "Waiting on the upstream feed" with no way
 * to ask "says who, and when?" short of opening the detail page and hoping.
 *
 * That is the difference between a register somebody trusts and one they
 * quietly stop believing: an item with no attribution is indistinguishable
 * from one somebody typed in a hurry, and the only way to tell them apart is
 * to show the provenance.
 *
 * THE FIELDS ARE UNEVEN, ON PURPOSE
 *
 * Three tables record this three ways, because they were filled in at
 * different times by different writers:
 *
 *   - `action_items` has sourceKind / sourceTitle / sourceUrl, which is the
 *     tidiest of the three and the newest.
 *   - `decisions` has raisedAtMeeting and raisedDocumentId from the agent API,
 *     and `evidence` — free text from the seed and from people, holding either
 *     a phrase ("Jul 6 Leads call") or a bare URL, because the API writes
 *     `document.url ?? document.title` into it.
 *   - `decision_events` has one row per time the thing was mentioned, with the
 *     quote in `note`. It is the best of the three and the least populated.
 *
 * This module is where that unevenness stops. It turns whatever exists into
 * one shape, and says plainly when there is nothing — which is itself worth
 * showing, rather than a popup that appears empty and reads as a bug.
 */

export interface Mention {
  /** raised | discussed | updated | resolved | reopened */
  kind: string
  /** The meeting or document it was said in. */
  where: string | null
  /** ISO day. */
  when: string | null
  /** Who said it, as the document named them. */
  who: string | null
  /** What was said — the citation for everything else. */
  note: string | null
  url: string | null
}

export interface Provenance {
  /** Where this came from, as a phrase to print. */
  where: string | null
  /** A link to it, when one is known. */
  url: string | null
  /** ISO day it was said. */
  when: string | null
  /** Who said it. */
  who: string | null
  /** meeting | slack | document — what sort of source that was. */
  medium: string | null
  /** Later mentions, newest first. Empty when there is only the one. */
  later: Mention[]
  /** Where and when it was closed, if it has been. */
  closed: { where: string | null; when: string | null } | null
  /** True when nothing at all is recorded about where this came from. */
  unattributed: boolean
  /**
   * Nothing points outside this app: a date and a person, and no document,
   * meeting or mention anywhere.
   *
   * Inferred rather than recorded, and safe to infer because the agent API
   * always writes `raisedAtMeeting` alongside what it files - so an entry with
   * a raiser and no meeting was typed on the page by the person named. Worth
   * distinguishing: "added here by Ashley on the 24th" is a real answer to
   * "where did this come from", and printing it as a sourceless entry throws
   * that away.
   */
  enteredHere: boolean
}

const EMPTY: Provenance = {
  where: null,
  url: null,
  when: null,
  who: null,
  medium: null,
  later: [],
  closed: null,
  unattributed: true,
  enteredHere: false,
}

/** A bare URL, as opposed to a phrase naming a meeting. */
export function isUrl(v: string | null | undefined): boolean {
  return /^https?:\/\/\S+$/i.test(String(v ?? '').trim())
}

/**
 * A URL as something a person can read.
 *
 * Printing the whole thing pushes everything else off the card, and printing
 * "link" tells the reader nothing about where it goes. The host, which is
 * usually the system it lives in, is the useful middle.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function day(v: Date | string | null | undefined): string | null {
  if (!v) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  const s = String(v).trim()
  return s ? s.slice(0, 10) : null
}

function clean(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}

export interface ActionSource {
  sourceKind?: string | null
  sourceTitle?: string | null
  sourceUrl?: string | null
  raisedAt?: Date | string | null
  authoredBy?: string | null
}

/** What an action item knows about where it came from. */
export function provenanceOfAction(row: ActionSource): Provenance {
  const url = clean(row.sourceUrl)
  const title = clean(row.sourceTitle)
  const when = day(row.raisedAt)
  const who = clean(row.authoredBy)
  // A title that is itself a URL is a link, not a name: the writer had only
  // the one field and put the more useful thing in it.
  const titleIsUrl = title !== null && isUrl(title)
  const link = url ?? (titleIsUrl ? title : null)
  const where = titleIsUrl ? (link ? hostOf(link) : null) : title

  if (!where && !link && !when && !who) return EMPTY
  return {
    where,
    url: link,
    when,
    who,
    medium: clean(row.sourceKind),
    later: [],
    closed: null,
    unattributed: false,
    enteredHere: !where && !link,
  }
}

export interface EntrySource {
  evidence?: string | null
  raisedAtMeeting?: string | null
  raisedAt?: Date | string | null
  raisedBy?: string | null
  /** The document the agent read it out of, already looked up. */
  document?: { title: string | null; url: string | null; occurredAt?: Date | string | null } | null
  resolvedAtMeeting?: string | null
  resolvedAt?: Date | string | null
  /** Every recorded mention, in any order. */
  events?: ReadonlyArray<Mention>
}

/**
 * What a blocker or decision knows, assembled from the three places it is
 * written down.
 *
 * Order of preference for "where": the document the agent actually read, then
 * the meeting name it recorded, then the free-text evidence. Each is more
 * specific than the next, and the first one present wins rather than all three
 * being concatenated into a line nobody can read.
 */
export function provenanceOfEntry(row: EntrySource): Provenance {
  const events = [...(row.events ?? [])].sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''))
  const raised = events.filter((e) => e.kind === 'raised').pop() ?? null
  const later = events.filter((e) => e !== raised)

  const evidence = clean(row.evidence)
  const evidenceIsUrl = evidence !== null && isUrl(evidence)

  const where =
    clean(row.document?.title) ??
    clean(row.raisedAtMeeting) ??
    raised?.where ??
    (evidenceIsUrl ? null : evidence)

  const url = clean(row.document?.url) ?? raised?.url ?? (evidenceIsUrl ? evidence : null)
  const when = day(row.raisedAt) ?? raised?.when ?? day(row.document?.occurredAt)
  const who = clean(row.raisedBy) ?? raised?.who ?? null

  const closedWhere = clean(row.resolvedAtMeeting)
  const closedWhen = day(row.resolvedAt)
  const closed = closedWhere || closedWhen ? { where: closedWhere, when: closedWhen } : null

  if (!where && !url && !when && !who && later.length === 0 && !closed) return EMPTY

  return {
    // A link with nothing to call it still says where it goes.
    where: where ?? (url ? hostOf(url) : null),
    url,
    when,
    who,
    medium: null,
    later,
    closed,
    unattributed: false,
    enteredHere: !where && !url && later.length === 0 && !closed,
  }
}

/**
 * The one-line version, for a tooltip or a screen reader.
 *
 * Deliberately a sentence rather than a field list: it is read aloud as often
 * as it is read.
 */
export function provenanceLine(p: Provenance): string {
  if (p.unattributed) return 'No source recorded'
  if (p.enteredHere) {
    return `Added on this page${p.who ? ` by ${p.who}` : ''}${p.when ? ` on ${p.when}` : ''}`
  }
  const bits: string[] = []
  if (p.where) bits.push(p.where)
  if (p.when) bits.push(p.when)
  if (p.who) bits.push(p.who)
  const head = bits.length ? `From ${bits.join(' · ')}` : 'Source recorded'
  const more = p.later.length ? `, mentioned ${p.later.length + 1} times` : ''
  return head + more
}
