/**
 * Score cell writes for the prioritization grid.
 *
 * PATCH { requestId, criterionId, value } sets one cell; a null value clears
 * it. The response echoes the value that was actually stored, so a client that
 * sent something out of range sees the clamp rather than continuing to display
 * a number the database never accepted.
 */
import { NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { intakeRequests, scores, scoringCriteria } from '@/db/schema'
import { clamp } from '@/lib/util'
import { revalidatePath } from 'next/cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const patchBody = z.object({
  requestId: z.string().min(1),
  criterionId: z.string().min(1),
  /** null clears the cell — "nobody has scored this" is a real state, not a zero. */
  value: z.number().finite().nullable(),
})

export async function PATCH(req: Request) {
  const json = await req.json().catch(() => null)
  const parsed = patchBody.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  const { requestId, criterionId, value } = parsed.data

  const [criterion] = await db
    .select()
    .from(scoringCriteria)
    .where(eq(scoringCriteria.id, criterionId))
    .limit(1)
  if (!criterion) return NextResponse.json({ error: 'Unknown criterion' }, { status: 404 })

  const [request] = await db
    .select({ id: intakeRequests.id })
    .from(intakeRequests)
    .where(eq(intakeRequests.id, requestId))
    .limit(1)
  if (!request) return NextResponse.json({ error: 'Unknown request' }, { status: 404 })

  const cell = and(eq(scores.criterionId, criterionId), eq(scores.requestId, requestId))

  if (value === null) {
    await db.delete(scores).where(cell)
    revalidatePath('/prioritization')
    revalidatePath('/intake')
    return NextResponse.json({ ok: true, value: null, clamped: false })
  }

  const stored = clamp(value, criterion.scaleMin, criterion.scaleMax)

  // Not an upsert: the unique index includes `scorer_id`, and Postgres does not
  // treat two NULL scorers as a conflict, so ON CONFLICT would quietly grow a
  // second row for the same cell every time an anonymous edit came in.
  const [existing] = await db
    .select({ id: scores.id })
    .from(scores)
    .where(cell)
    .orderBy(asc(scores.updatedAt))
    .limit(1)

  if (existing) {
    await db.update(scores).set({ value: stored }).where(eq(scores.id, existing.id))
  } else {
    await db
      .insert(scores)
      .values({ modelId: criterion.modelId, criterionId, requestId, value: stored })
  }

  // Deliberately not written to the changelog. A scoring session touches every
  // cell in the grid, and burying four real portfolio changes under eighty
  // score edits would make the "what changed" view useless. Changes to the
  // model itself are logged, because those move every row at once.
  revalidatePath('/prioritization')
  revalidatePath('/intake')

  return NextResponse.json({ ok: true, value: stored, clamped: stored !== value })
}
