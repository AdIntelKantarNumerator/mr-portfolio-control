/**
 * Recording what dates look like today, so drift is answerable tomorrow.
 *
 *   POST /api/agent/dates   { observations: [{ entityType, entityId, field, value }] }
 *   GET  /api/agent/dates   current drift for everything that has moved
 *
 * Protected by SYNC_TOKEN.
 *
 * A row is written only when the value differs from the last one recorded. That
 * makes this safe to call every hour forever: a project whose date never moves
 * costs one row for its lifetime, and the history stays readable rather than
 * being ten thousand identical rows with the two interesting ones buried.
 */
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { dateObservations } from '@/db/schema'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { getDateDrift } from '@/lib/dates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FIELDS = new Set(['target_date', 'start_date'])
const ENTITY_TYPES = new Set(['initiative', 'project', 'milestone'])

interface Incoming {
  observations?: Array<{
    entityType?: string
    entityId?: string
    field?: string
    value?: string | null
    source?: string
  }>
}

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  let body: Incoming
  try {
    body = (await req.json()) as Incoming
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  let recorded = 0
  let unchanged = 0
  const rejected: string[] = []

  for (const o of body.observations ?? []) {
    const entityType = String(o?.entityType ?? '')
    const entityId = String(o?.entityId ?? '')
    const field = String(o?.field ?? '')

    if (!ENTITY_TYPES.has(entityType) || !entityId || !FIELDS.has(field)) {
      rejected.push(`${entityType}/${entityId}/${field}`)
      continue
    }

    const value = o.value ? new Date(o.value) : null
    if (value && Number.isNaN(value.getTime())) {
      rejected.push(`${entityId}/${field}: unparseable date`)
      continue
    }

    const [latest] = await db
      .select()
      .from(dateObservations)
      .where(
        and(
          eq(dateObservations.entityType, entityType),
          eq(dateObservations.entityId, entityId),
          eq(dateObservations.field, field),
        ),
      )
      .orderBy(desc(dateObservations.observedAt))
      .limit(1)

    const previous = latest?.value ? latest.value.getTime() : null
    const next = value ? value.getTime() : null
    if (latest && previous === next) {
      unchanged++
      continue
    }

    await db.insert(dateObservations).values({
      entityType,
      entityId,
      field,
      value,
      source: (o.source ?? 'linear').slice(0, 32),
    })
    recorded++
  }

  return Response.json({ recorded, unchanged, rejected })
}

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  return Response.json({ drift: await getDateDrift() })
}
