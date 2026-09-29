'use server'

/**
 * "This update is on the wrong objective."
 *
 * WHY THE CORRECTION IS MADE HERE AND NOT IN A SETTINGS SCREEN
 *
 * The only moment anybody knows an attribution is wrong is the moment they are
 * looking at it. A correction that has to be made somewhere else is one that
 * gets made after the meeting, or never, and "never" is what has been
 * happening: people learned which cards to distrust instead.
 *
 * WHAT IS RECORDED, AND WHY IT IS NOT "THIS ITEM WAS WRONG"
 *
 * The coordinates of the source — which system, where inside it, who wrote it
 * — rather than a pointer at the evidence row. The evidence row is a snapshot
 * of one window and is replaced on the next pass, so a correction pointing at
 * it would be dangling within the hour. What is being said is "things like
 * this belong there", and those three fields are the "things like this".
 *
 * WHAT HAPPENS NEXT
 *
 * Yaara reads the unconsumed corrections at the start of each pass and turns
 * each into a standing routing rule, then marks it done with the rule's id.
 * So the effect is visible on the next pass rather than immediately, and the
 * message the reader gets says so — a control that claims to have fixed
 * something that is still wrong an hour later is worse than one that explains
 * the wait.
 */
import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { objectives, initiatives, projects, routingCorrections } from '@/db/schema'
import { actorName } from '@/lib/auth/current-user'

export interface CorrectionState {
  ok?: boolean
  message?: string
  error?: string
  stamp?: number
}

const TABLES = { objective: objectives, initiative: initiatives, project: projects } as const
type Level = keyof typeof TABLES

function isLevel(v: string): v is Level {
  return v === 'objective' || v === 'initiative' || v === 'project'
}

export interface CorrectionInput {
  /** Where it is wrongly showing. */
  wrongEntityType: string
  wrongEntityId: string
  /**
   * Where it belongs: "type:id", or the empty string for "nothing".
   *
   * One field rather than two because it arrives from a <select> and a pair
   * that can disagree with itself is a state nobody needs.
   */
  belongsTo: string
  source: string
  location?: string | null
  author?: string | null
  evidenceId?: string | null
  evidenceTitle?: string | null
  note?: string | null
}

export async function recordCorrection(input: CorrectionInput): Promise<CorrectionState> {
  if (!isLevel(input.wrongEntityType)) return { error: 'Unknown kind of record.' }
  const source = (input.source ?? '').trim()
  if (!source) return { error: 'Nothing is known about where this came from, so there is no rule to make from it.' }

  const location = (input.location ?? '').trim() || null
  const author = (input.author ?? '').trim() || null

  // A correction with no coordinates beyond the system it came from would
  // become a rule claiming everything from that system. Yaara refuses such a
  // rule, so accepting it here would only mean the person is told later, on a
  // screen they are not looking at.
  if (!location && !author) {
    return {
      error:
        'This update does not say which channel, repo or meeting it came from, so a rule from it would claim everything from ' +
        `${source}. Tell Yaara directly and she can narrow it.`,
    }
  }

  let rightType: Level | null = null
  let rightId: string | null = null
  const belongs = (input.belongsTo ?? '').trim()
  if (belongs) {
    const [type, id] = belongs.split(':')
    if (!type || !id || !isLevel(type)) return { error: 'That is not a record this portfolio has.' }
    // Checked against the real row: a correction pointing at something deleted
    // would become a rule that routes evidence into a hole and looks, from
    // every listing, like it is working.
    const [row] = await db.select({ id: TABLES[type].id }).from(TABLES[type]).where(eq(TABLES[type].id, id)).limit(1)
    if (!row) return { error: 'That record no longer exists — reload the page.' }
    rightType = type
    rightId = id
  }

  if (rightType === input.wrongEntityType && rightId === input.wrongEntityId) {
    return { error: 'That is where it already is.' }
  }

  // The same person saying the same thing twice about the same source is one
  // correction, not two rules. Pending only: once Yaara has made a rule, a
  // second correction about the same source is a real disagreement with it and
  // should be recorded.
  const existing = await db
    .select({ id: routingCorrections.id })
    .from(routingCorrections)
    .where(
      and(
        isNull(routingCorrections.consumedAt),
        eq(routingCorrections.wrongEntityId, input.wrongEntityId),
        eq(routingCorrections.source, source),
      ),
    )
    .limit(1)

  if (existing.length) {
    return {
      ok: true,
      stamp: Date.now(),
      message: 'Already noted — Yaara has this one waiting and will act on it on her next pass.',
    }
  }

  await db.insert(routingCorrections).values({
    wrongEntityType: input.wrongEntityType,
    wrongEntityId: input.wrongEntityId,
    rightEntityType: rightType,
    rightEntityId: rightId,
    source,
    location,
    author,
    evidenceId: (input.evidenceId ?? '').trim() || null,
    evidenceTitle: (input.evidenceTitle ?? '').trim() || null,
    note: (input.note ?? '').trim() || null,
    createdBy: await actorName(),
  })

  // The same guard objectives/actions.ts carries: revalidatePath needs a
  // request context and throws this one invariant without it, and the caller
  // with no request is scripts/check-corrections.ts. Every other error still
  // propagates.
  try {
    revalidatePath('/')
    revalidatePath(`/${input.wrongEntityType}s/${input.wrongEntityId}`)
  } catch (err) {
    if (!(err instanceof Error) || !/static generation store/i.test(err.message)) throw err
  }

  const where = location ?? author ?? source
  return {
    ok: true,
    stamp: Date.now(),
    message: rightId
      ? `Noted: ${where} belongs elsewhere. Yaara turns this into a standing rule on her next pass, so it stops happening rather than just being fixed here.`
      : `Noted: ${where} is not this work. Yaara will stop attaching it from her next pass.`,
  }
}

/**
 * Everything a correction could point at, for the picker.
 *
 * All three tiers in one list because the reader is answering "where does this
 * belong", and the answer is sometimes a project and sometimes the
 * objective two levels up. Making them choose a tier first would be asking
 * them to classify their own answer before giving it.
 */
export async function correctionTargets(): Promise<Array<{ value: string; label: string }>> {
  const [inits, projs, wss] = await Promise.all([
    db.select({ id: objectives.id, name: objectives.name }).from(objectives),
    db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives),
    db.select({ id: projects.id, name: projects.name }).from(projects),
  ])
  const sort = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label)
  return [
    ...inits.map((r) => ({ value: `objective:${r.id}`, label: `${r.name} — objective` })).sort(sort),
    ...projs.map((r) => ({ value: `initiative:${r.id}`, label: `${r.name} — initiative` })).sort(sort),
    ...wss.map((r) => ({ value: `project:${r.id}`, label: `${r.name} — project` })).sort(sort),
  ]
}
