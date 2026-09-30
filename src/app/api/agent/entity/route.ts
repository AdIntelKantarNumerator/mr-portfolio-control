/**
 * Changing a project or an initiative.
 *
 *   POST /api/agent/entity
 *
 * Protected by SYNC_TOKEN.
 *
 * WHAT MAKES THIS DIFFERENT FROM EVERY OTHER AGENT WRITE
 *
 * Everything else an agent writes here is additive and attributed: an
 * observation, a register entry, a program review row. Somebody reading it can
 * see it came from her and weigh it accordingly, and nothing she wrote replaced
 * anything a person put there.
 *
 * This endpoint edits the records themselves. A renamed project is renamed for
 * everyone, a moved project changes the rollups and the deck, and a closed one
 * disappears from the default lists. There is no "her version" of a project
 * name. So the rules here are stricter than anywhere else in the API:
 *
 * NOTHING IS CREATED. She may change an existing project or initiative and
 * nothing else. Every reference — an owner, a team, an app area, a parent
 * initiative — must already exist, matched by name, or the change is refused
 * with the list of what does exist. An agent that could create a Person to
 * satisfy an owner field would eventually create "Unknown" and assign work to
 * it.
 *
 * NOTHING IS DELETED. There is no delete path. Ending a piece of work is a
 * status change, which is reversible and visible, rather than a removal. A
 * person can delete an empty Strategic Objective from its page; an agent
 * cannot, here or anywhere.
 *
 * EVERY CHANGE CARRIES A REASON. Refused without one. The reason goes in the
 * changelog beside the old and new value, so "why is this called that now" has
 * an answer six weeks later.
 *
 * EVERY CHANGE IS LOGGED INDIVIDUALLY. One changelog entry per field, not one
 * per request, because that is the granularity somebody scanning What Changed
 * needs.
 *
 * WHY THE ROW AND NOT AN OVERRIDE
 *
 * field_overrides exists so a stated value can beat a synced one. Nothing syncs
 * these fields today — the Linear sync does not write project rows — so an
 * override would add a second place where a project's name lives, and the UI
 * edit and the agent edit would disagree about which one is true. A person
 * editing on the project page writes the row; she writes the row.
 */
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { appAreas, objectives, initiatives, people, projects, teams } from '@/db/schema'
import {
  INITIATIVE_STATUS,
  PRIORITY,
  PROJECT_STATUS_SET,
} from '@/lib/domain'
import { closest, exact } from '@/lib/match-name'
import { logChange } from '@/lib/portfolio'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Incoming {
  agent?: string
  entityType?: string
  /** Either is enough; the id wins when both are given. */
  entityId?: string
  entityName?: string
  /** Why. Not optional. */
  reason?: string
  changes?: Record<string, unknown>
}

interface Applied {
  field: string
  from: string | null
  to: string | null
}

/** A date the way the deck and the register write them, or null to clear. */
function asDate(value: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, value: d }
}

function show(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  let body: Incoming
  try {
    body = (await req.json()) as Incoming
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const agent = (body.agent ?? 'yaara').slice(0, 64)
  const reason = String(body.reason ?? '').trim()
  if (!reason) {
    return Response.json(
      {
        error:
          'Every change needs a reason — it is recorded beside the old and new value so somebody can tell later why this changed.',
      },
      { status: 400 },
    )
  }

  const kind = body.entityType === 'initiative' ? 'initiative' : 'project'
  const table = kind === 'initiative' ? initiatives : projects

  const rows = await db.select().from(table)
  const asked = String(body.entityName ?? '')
  const row = body.entityId ? rows.find((r) => r.id === body.entityId) : exact(asked, rows)

  if (!row) {
    // A shortlist, not the whole list. People say the name they remember, and
    // the answer to "move Keystone" should be "did you mean Keystone Data
    // Migration?" rather than forty project names alphabetically, only one of
    // which is relevant.
    //
    // Suggestions, never a substitution: picking the top match automatically
    // is how one team's plan ends up on another team's project.
    const near = closest(asked, rows)
    return Response.json(
      {
        error: near.length
          ? `No ${kind} is called exactly "${asked}".`
          : `No ${kind} called "${asked || body.entityId}", and nothing close. I do not create them.`,
        suggestions: near.map((n) => n.name),
        available: near.length === 0 ? rows.map((r) => r.name).slice(0, 40) : undefined,
      },
      { status: 400 },
    )
  }

  const changes = body.changes ?? {}
  const applied: Applied[] = []
  const refused: string[] = []
  const patch: Record<string, unknown> = {}

  // Loaded once, and only when something actually references them.
  const wantsPerson = 'owner' in changes || 'sponsor' in changes
  const [peopleRows, teamRows, areaRows] = await Promise.all([
    wantsPerson ? db.select().from(people) : Promise.resolve([]),
    'team' in changes ? db.select().from(teams) : Promise.resolve([]),
    'appArea' in changes ? db.select().from(appAreas) : Promise.resolve([]),
  ])

  function resolve(
    label: string,
    value: unknown,
    candidates: { id: string; name: string }[],
  ): { ok: true; id: string | null } | { ok: false } {
    if (value === null || value === '') return { ok: true, id: null }

    const asked = String(value)
    const found = exact(asked, candidates)
    if (found) return { ok: true, id: found.id }

    const near = closest(asked, candidates)
    refused.push(
      near.length
        ? `no ${label} called exactly "${asked}" — did you mean ${near.map((n) => n.name).join(', or ')}?`
        : `no ${label} called "${asked}", and nothing close. It has to exist first — I do not create ${label}s.`,
    )
    return { ok: false }
  }

  for (const [field, value] of Object.entries(changes)) {
    switch (field) {
      case 'name': {
        const name = String(value ?? '').trim()
        if (!name) {
          refused.push('name cannot be blank')
          break
        }
        // Two projects with the same name breaks her own matching, silently,
        // and a program review with two identical slide titles is unreadable.
        const clash = exact(name, rows.filter((r) => r.id !== row.id))
        if (clash) {
          refused.push(`another ${kind} is already called "${clash.name}"`)
          break
        }
        patch.name = name.slice(0, 200)
        applied.push({ field: 'name', from: row.name, to: name })
        break
      }

      case 'description': {
        const text = value === null ? null : String(value).trim().slice(0, 4000) || null
        patch.description = text
        applied.push({ field: 'description', from: show(row.description), to: show(text) })
        break
      }

      case 'status': {
        const allowed: readonly string[] = kind === 'initiative' ? INITIATIVE_STATUS : PROJECT_STATUS_SET
        const status = String(value ?? '')
        if (!allowed.includes(status)) {
          refused.push(`status "${status}" is not one of: ${allowed.join(', ')}`)
          break
        }
        patch.status = status
        applied.push({ field: 'status', from: row.status, to: status })
        break
      }

      case 'priority': {
        if (kind === 'initiative') {
          refused.push('an initiative has no priority')
          break
        }
        const priority = value === null ? null : String(value)
        if (priority !== null && !(PRIORITY as readonly string[]).includes(priority)) {
          refused.push(`priority "${priority}" is not one of: ${PRIORITY.join(', ')}`)
          break
        }
        patch.priority = priority
        applied.push({ field: 'priority', from: show((row as { priority?: string }).priority), to: priority })
        break
      }

      case 'startDate':
      case 'targetDate': {
        const parsed = asDate(value)
        if (!parsed.ok) {
          refused.push(`${field} "${String(value)}" is not a date I can read — use YYYY-MM-DD`)
          break
        }
        patch[field] = parsed.value
        applied.push({
          field,
          from: show((row as Record<string, unknown>)[field]),
          to: show(parsed.value),
        })
        break
      }

      case 'devLead':
      case 'programLead': {
        if (kind === 'initiative') {
          refused.push(`an initiative has no ${field}`)
          break
        }
        // Free text on purpose: the deck says "Scott & Sadiya", which is not a
        // Person and should not be forced into becoming one.
        const text = value === null ? null : String(value).trim().slice(0, 200) || null
        patch[field] = text
        applied.push({ field, from: show((row as Record<string, unknown>)[field]), to: show(text) })
        break
      }

      case 'owner':
      case 'sponsor': {
        if (field === 'sponsor' && kind === 'project') {
          refused.push('a project has no sponsor')
          break
        }
        const found = resolve('person', value, peopleRows)
        if (!found.ok) break
        const column = field === 'owner' ? 'ownerId' : 'sponsorId'
        if (kind === 'project' && field === 'owner') {
          // Projects call it the lead.
          patch.leadId = found.id
          applied.push({
            field: 'owner',
            from: show((row as { leadId?: string }).leadId),
            to: show(found.id),
          })
          break
        }
        patch[column] = found.id
        applied.push({ field, from: show((row as Record<string, unknown>)[column]), to: show(found.id) })
        break
      }

      case 'team': {
        if (kind === 'initiative') {
          refused.push('an initiative has no team')
          break
        }
        const found = resolve('team', value, teamRows)
        if (!found.ok) break
        patch.teamId = found.id
        applied.push({ field: 'team', from: show((row as { teamId?: string }).teamId), to: show(found.id) })
        break
      }

      case 'appArea': {
        if (kind === 'initiative') {
          refused.push('an initiative has no application area')
          break
        }
        const found = resolve('application area', value, areaRows)
        if (!found.ok) break
        patch.appAreaId = found.id
        applied.push({
          field: 'appArea',
          from: show((row as { appAreaId?: string }).appAreaId),
          to: show(found.id),
        })
        break
      }

      case 'initiative': {
        if (kind === 'initiative') {
          refused.push('an initiative does not sit under another initiative')
          break
        }
        if (value === null || value === '') {
          patch.initiativeId = null
          applied.push({
            field: 'initiative',
            from: show((row as { initiativeId?: string }).initiativeId),
            to: null,
          })
          break
        }
        const all = await db.select().from(initiatives)
        const asked = String(value)
        const found = exact(asked, all)
        if (!found) {
          const near = closest(asked, all)
          refused.push(
            near.length
              ? `no initiative called exactly "${asked}" — did you mean ${near.map((n) => n.name).join(', or ')}?`
              : `no initiative called "${asked}", and nothing close.`,
          )
          break
        }
        patch.initiativeId = found.id
        applied.push({
          field: 'initiative',
          from: show((row as { initiativeId?: string }).initiativeId),
          to: found.name,
        })
        break
      }

      /**
       * Which objective an initiative rolls up to.
       *
       * The tier above initiatives, and the only relationship in this app with no
       * source outside it. An agent moving one is moving somebody's judgement,
       * so it is refused for projects (they roll up to initiatives, not
       * objectives) and it names near misses rather than guessing.
       */
      case 'objective': {
        if (kind !== 'initiative') {
          refused.push('only an initiative rolls up to an objective — a project rolls up to an initiative')
          break
        }
        if (value === null || value === '') {
          patch.objectiveId = null
          applied.push({
            field: 'objective',
            from: show((row as { objectiveId?: string }).objectiveId),
            to: null,
          })
          break
        }
        const all = await db.select().from(objectives)
        const asked = String(value)
        const found = exact(asked, all)
        if (!found) {
          const near = closest(asked, all)
          refused.push(
            near.length
              ? `no objective called exactly "${asked}" — did you mean ${near.map((n) => n.name).join(', or ')}?`
              : `no objective called "${asked}", and nothing close. Objectives are created on the objectives page, not by me.`,
          )
          break
        }
        patch.objectiveId = found.id
        applied.push({
          field: 'objective',
          from: show((row as { objectiveId?: string }).objectiveId),
          to: found.name,
        })
        break
      }

      default:
        refused.push(`I cannot change "${field}"`)
    }
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ entity: row.name, applied: [], refused, changed: 0 })
  }

  await db
    .update(table)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(table.id, row.id))

  // One entry per field. Somebody scanning What Changed wants "the owner
  // moved", not "four things changed on this project".
  for (const change of applied) {
    await logChange({
      actor: agent,
      kind: 'change',
      summary: `${row.name}: ${change.field} changed`,
      detail: `${change.from ?? '(none)'} → ${change.to ?? '(none)'} — ${reason}`,
      entityType: kind,
      entityId: row.id,
    })
  }

  return Response.json({ entity: row.name, applied, refused, changed: applied.length })
}
