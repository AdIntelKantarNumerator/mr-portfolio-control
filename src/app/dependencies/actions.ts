'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { dependencies } from '@/db/schema'
import { dependencyInput } from '@/lib/domain'
import { logChange } from '@/lib/portfolio'
import { actorName } from '@/lib/auth/current-user'

export interface ActionState {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

function refresh() {
  revalidatePath('/dependencies')
  revalidatePath('/')
  revalidatePath('/changes')
}

/**
 * Endpoints arrive from the form as "type:id" so one <select> can offer
 * projects, initiatives and milestones together without three parallel fields.
 * An endpoint typed as free text becomes an `external` node — which is how the
 * vendor feeds and other-org deliverables that actually slip get represented.
 */
function parseEndpoint(raw: string, freeText: string | null) {
  if (raw === '__external__') {
    const labelText = (freeText ?? '').trim()
    if (!labelText) return null
    return {
      type: 'external' as const,
      id: labelText.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60),
      label: labelText,
    }
  }
  const [type, ...rest] = raw.split(':')
  const id = rest.join(':')
  if (!type || !id) return null
  return { type, id, label: null }
}

export async function createDependency(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const from = parseEndpoint(
    String(formData.get('from') ?? ''),
    String(formData.get('fromExternal') ?? ''),
  )
  const to = parseEndpoint(
    String(formData.get('to') ?? ''),
    String(formData.get('toExternal') ?? ''),
  )

  const fieldErrors: Record<string, string> = {}
  if (!from) fieldErrors.from = 'Pick a blocker, or name an external one.'
  if (!to) fieldErrors.to = 'Pick what is blocked.'
  if (from && to && from.type === to.type && from.id === to.id) {
    fieldErrors.to = 'Something cannot depend on itself.'
  }
  if (Object.keys(fieldErrors).length) return { fieldErrors }

  const dueRaw = String(formData.get('dueDate') ?? '')
  const parsed = dependencyInput.safeParse({
    fromType: from!.type,
    fromId: from!.id,
    fromLabel: from!.label,
    toType: to!.type,
    toId: to!.id,
    toLabel: to!.label,
    kind: String(formData.get('kind') ?? 'blocks'),
    status: String(formData.get('status') ?? 'open'),
    criticality: String(formData.get('criticality') ?? 'normal'),
    description: String(formData.get('description') ?? '') || null,
    dueDate: dueRaw || null,
  })

  if (!parsed.success) {
    const errs: Record<string, string> = {}
    for (const issue of parsed.error.issues) errs[String(issue.path[0] ?? 'form')] = issue.message
    return { fieldErrors: errs }
  }

  await db.insert(dependencies).values(parsed.data)
  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `Dependency added: ${from!.label ?? from!.id} → ${to!.label ?? to!.id}`,
    detail: parsed.data.description ?? null,
  })
  refresh()
  return { ok: true }
}

export async function setDependencyStatus(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!id || !['open', 'at_risk', 'resolved', 'accepted_risk'].includes(status)) return

  const [before] = await db.select().from(dependencies).where(eq(dependencies.id, id)).limit(1)
  if (!before) return

  await db.update(dependencies).set({ status }).where(eq(dependencies.id, id))
  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `Dependency moved ${before.status} → ${status}`,
    detail: before.description ?? null,
  })
  refresh()
}

export async function deleteDependency(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const [before] = await db.select().from(dependencies).where(eq(dependencies.id, id)).limit(1)
  await db.delete(dependencies).where(eq(dependencies.id, id))
  if (before) {
    await logChange({
      actor: await actorName(),
      kind: 'change',
      summary: 'Dependency removed',
      detail: before.description ?? null,
    })
  }
  refresh()
}
