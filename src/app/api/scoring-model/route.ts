/**
 * Edits to the scoring model itself — criterion weights and the capacity that
 * draws the cut line.
 *
 * These are logged to the changelog even though individual score cells are
 * not: changing a weight or the available capacity re-orders the whole list
 * and moves the line, so "the ranking changed" needs an explanation attached.
 */
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db } from '@/db/client'
import { scoringCriteria, scoringModels } from '@/db/schema'
import { logChange } from '@/lib/portfolio'
import { actorName } from '@/lib/auth/current-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


const patchBody = z.discriminatedUnion('target', [
  z.object({
    target: z.literal('criterion'),
    criterionId: z.string().min(1),
    /** Zero is allowed: it is how a room retires a criterion without deleting its history. */
    weight: z.number().min(0).max(10),
  }),
  z.object({
    target: z.literal('capacity'),
    modelId: z.string().min(1),
    /** null means "we have not sized the cycle yet", which suppresses the cut line. */
    capacityUnits: z.number().min(0).max(100_000).nullable(),
  }),
])

export async function PATCH(req: Request) {
  const json = await req.json().catch(() => null)
  const parsed = patchBody.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  const body = parsed.data

  if (body.target === 'criterion') {
    const [criterion] = await db
      .select()
      .from(scoringCriteria)
      .where(eq(scoringCriteria.id, body.criterionId))
      .limit(1)
    if (!criterion) return NextResponse.json({ error: 'Unknown criterion' }, { status: 404 })

    if (criterion.weight === body.weight) {
      return NextResponse.json({ ok: true, weight: criterion.weight, changed: false })
    }

    await db
      .update(scoringCriteria)
      .set({ weight: body.weight })
      .where(eq(scoringCriteria.id, body.criterionId))

    await logChange({
      actor: await actorName(),
      kind: 'change',
      summary: `Scoring weight for "${criterion.label}" changed ${criterion.weight} → ${body.weight}`,
      detail: 'Every ranked request was re-scored against the new weight.',
      entityType: 'scoring_criterion',
      entityId: criterion.id,
    })

    revalidatePath('/prioritization')
    revalidatePath('/intake')
    revalidatePath('/changes')
    return NextResponse.json({ ok: true, weight: body.weight, changed: true })
  }

  const [model] = await db
    .select()
    .from(scoringModels)
    .where(eq(scoringModels.id, body.modelId))
    .limit(1)
  if (!model) return NextResponse.json({ error: 'Unknown scoring model' }, { status: 404 })

  if (model.capacityUnits === body.capacityUnits) {
    return NextResponse.json({ ok: true, capacityUnits: model.capacityUnits, changed: false })
  }

  await db
    .update(scoringModels)
    .set({ capacityUnits: body.capacityUnits })
    .where(eq(scoringModels.id, body.modelId))

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `Planning capacity changed ${model.capacityUnits ?? 'unset'} → ${
      body.capacityUnits ?? 'unset'
    } ${model.capacityLabel ?? 'units'}`,
    detail: 'The cut line on the ranked list moved with it.',
    entityType: 'scoring_model',
    entityId: model.id,
  })

  revalidatePath('/prioritization')
  revalidatePath('/changes')
  return NextResponse.json({ ok: true, capacityUnits: body.capacityUnits, changed: true })
}
