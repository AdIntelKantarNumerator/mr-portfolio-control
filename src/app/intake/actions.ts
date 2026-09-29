'use server'

/**
 * Intake mutations.
 *
 * Everything that moves a request writes a `changelog_entries` row, because in
 * a program review the question is never "what is the queue now" — people can
 * read that off the screen — it is "what moved since we last looked, and who
 * moved it".
 */
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { intakeRequests, projects } from '@/db/schema'
import { INTAKE_STATUS, LABELS, intakeInput, type IntakeStatus } from '@/lib/domain'
import { logChange } from '@/lib/portfolio'
import { actorName } from '@/lib/auth/current-user'
import { nextRef, slugify } from '@/lib/util'

/** There is no auth layer yet, so the changelog records the surface, not a person. */

const ENTITY = 'intake_request'

function statusLabel(status: string): string {
  return LABELS.intakeStatus[status as IntakeStatus] ?? status
}

/** Everything intake touches shows up on these three screens. */
function revalidateIntake() {
  revalidatePath('/intake')
  revalidatePath('/prioritization')
  revalidatePath('/changes')
}

// ---------------------------------------------------------------------------
// Moving a request through the queue
// ---------------------------------------------------------------------------

export async function moveRequest(formData: FormData) {
  const id = String(formData.get('requestId') ?? '')
  const next = String(formData.get('status') ?? '')
  if (!id || !(INTAKE_STATUS as readonly string[]).includes(next)) return

  const [row] = await db.select().from(intakeRequests).where(eq(intakeRequests.id, id)).limit(1)
  if (!row || row.status === next) return

  // 'converted' is owned by approveAndConvert — reaching it by hand would leave
  // a request marked converted with no project behind it.
  if (next === 'converted') return

  await db.update(intakeRequests).set({ status: next }).where(eq(intakeRequests.id, id))

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `${row.ref} moved ${statusLabel(row.status)} → ${statusLabel(next)}`,
    detail: row.title,
    entityType: ENTITY,
    entityId: id,
  })

  revalidateIntake()
}

// ---------------------------------------------------------------------------
// Decision notes
// ---------------------------------------------------------------------------

export async function recordDecisionNote(formData: FormData) {
  const id = String(formData.get('requestId') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return

  const [row] = await db.select().from(intakeRequests).where(eq(intakeRequests.id, id)).limit(1)
  if (!row) return

  await db
    .update(intakeRequests)
    .set({ decisionNote: note || null })
    .where(eq(intakeRequests.id, id))

  await logChange({
    actor: await actorName(),
    kind: 'note',
    summary: note
      ? `${row.ref} decision note recorded`
      : `${row.ref} decision note cleared`,
    detail: note || row.decisionNote,
    entityType: ENTITY,
    entityId: id,
  })

  revalidateIntake()
}

// ---------------------------------------------------------------------------
// New request
// ---------------------------------------------------------------------------

export interface IntakeFormState {
  /** 'idle' before the first submit; 'error' when the last submit was rejected. */
  status: 'idle' | 'error'
  /** Keyed by field name so each input can render its own message. */
  errors: Record<string, string[]>
  message: string | null
  /** Echoed back so a rejected submit does not wipe what was typed. */
  values: Record<string, string>
}

/** Postgres unique-violation, reported identically by both drivers. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  )
}

/** '' from a <select> or an empty <input> means "not set", not "the empty string". */
function blankToNull(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '' ? null : s
}

export async function createRequest(
  _prev: IntakeFormState,
  formData: FormData,
): Promise<IntakeFormState> {
  const values: Record<string, string> = {}
  for (const [k, v] of formData.entries()) if (typeof v === 'string') values[k] = v

  const parsed = intakeInput.safeParse({
    title: String(formData.get('title') ?? '').trim(),
    problem: String(formData.get('problem') ?? '').trim(),
    outcome: blankToNull(formData.get('outcome')),
    requesterName: String(formData.get('requesterName') ?? '').trim(),
    requesterEmail: blankToNull(formData.get('requesterEmail')),
    sponsor: blankToNull(formData.get('sponsor')),
    stakeholders: blankToNull(formData.get('stakeholders')),
    themeId: blankToNull(formData.get('themeId')),
    appAreaId: blankToNull(formData.get('appAreaId')),
    proposedInitiativeId: blankToNull(formData.get('proposedInitiativeId')),
    desiredDate: blankToNull(formData.get('desiredDate')),
    hardDate: formData.get('hardDate') === 'on',
    hardDateReason: blankToNull(formData.get('hardDateReason')),
    tshirt: blankToNull(formData.get('tshirt')),
    businessCase: blankToNull(formData.get('businessCase')),
    source: blankToNull(formData.get('source')) ?? 'web',
  })

  if (!parsed.success) {
    const errors: Record<string, string[]> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.map((p) => String(p)).join('.') || '_form'
      ;(errors[key] ??= []).push(issue.message)
    }
    return {
      status: 'error',
      errors,
      message: 'Nothing was saved — the fields below need attention.',
      values,
    }
  }

  const data = parsed.data

  // `ref` is derived from the highest existing number, so two people filing in
  // the same second can compute the same one. The unique index catches it; this
  // re-reads and tries again rather than handing the second person an error
  // about a field they never filled in.
  let ref = ''
  for (let attempt = 0; ; attempt++) {
    const existing = await db.select({ ref: intakeRequests.ref }).from(intakeRequests)
    ref = nextRef('REQ-', existing.map((r) => r.ref))
    try {
      await db.insert(intakeRequests).values({
        ref,
        title: data.title,
        problem: data.problem,
        outcome: data.outcome ?? null,
        requesterName: data.requesterName,
        requesterEmail: data.requesterEmail || null,
        sponsor: data.sponsor ?? null,
        stakeholders: data.stakeholders ?? null,
        themeId: data.themeId ?? null,
        appAreaId: data.appAreaId ?? null,
        proposedInitiativeId: data.proposedInitiativeId ?? null,
        desiredDate: data.desiredDate,
        hardDate: data.hardDate,
        hardDateReason: data.hardDateReason ?? null,
        tshirt: data.tshirt ?? null,
        businessCase: data.businessCase ?? null,
        status: 'new',
        source: data.source,
      })
      break
    } catch (err) {
      const duplicate = isUniqueViolation(err)
      if (!duplicate) throw err
      if (attempt >= 3) {
        return {
          status: 'error',
          errors: {},
          message: `Could not assign a reference — ${ref} kept being taken. Try again.`,
          values,
        }
      }
    }
  }

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `${ref} raised — ${data.title}`,
    detail: [
      `Requester: ${data.requesterName}`,
      data.sponsor ? `Sponsor: ${data.sponsor}` : null,
      data.hardDate
        ? `Hard date${data.hardDateReason ? `: ${data.hardDateReason}` : ' with no reason given'}`
        : null,
    ]
      .filter(Boolean)
      .join(' · '),
    entityType: ENTITY,
  })

  revalidateIntake()
  redirect('/intake')
}

// ---------------------------------------------------------------------------
// Approve → create project
// ---------------------------------------------------------------------------

export async function approveAndConvert(formData: FormData) {
  const id = String(formData.get('requestId') ?? '')
  if (!id) return

  const [row] = await db.select().from(intakeRequests).where(eq(intakeRequests.id, id)).limit(1)
  // Converting anything but an approved request would turn intake into a side
  // door around the decision it exists to record.
  if (!row || row.status !== 'approved' || row.convertedProjectId) return

  const existing = await db
    .select({ key: projects.key, sortOrder: projects.sortOrder })
    .from(projects)
    .orderBy(desc(projects.sortOrder))
  const taken = new Set(existing.map((p) => p.key))
  const base = slugify(row.title) || slugify(row.ref)
  // Deterministic rather than "-2", "-3": two concurrent submits for the same
  // request compute the same key, so the unique index turns a double-click into
  // a no-op instead of a second project nobody asked for.
  const key = taken.has(base) ? `${base}-${slugify(row.ref)}` : base

  // The id is generated here rather than read back with `.returning()`: the
  // `db` handle is a union of two drivers and the returning overload does not
  // resolve across it, and the request row needs the id in the same breath.
  const projectId = randomUUID()

  try {
    await db.insert(projects).values({
      id: projectId,
      key,
      name: row.title,
      description: row.problem,
      status: 'backlog',
      progress: 0,
      initiativeId: row.proposedInitiativeId,
      appAreaId: row.appAreaId,
      targetDate: row.desiredDate,
      sortOrder: (existing[0]?.sortOrder ?? 0) + 1,
    })
  } catch (err) {
    if (isUniqueViolation(err)) return
    throw err
  }

  await db
    .update(intakeRequests)
    .set({ status: 'converted', convertedProjectId: projectId })
    .where(eq(intakeRequests.id, id))

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `${row.ref} approved and converted to project "${row.title}"`,
    detail: [
      `Project key ${key}`,
      row.proposedInitiativeId ? 'Linked to the proposed initiative' : 'No initiative linked yet',
      row.desiredDate ? `Target date carried over from the desired date` : 'No target date set',
    ].join(' · '),
    entityType: ENTITY,
    entityId: id,
  })

  revalidateIntake()
  revalidatePath('/')
}
