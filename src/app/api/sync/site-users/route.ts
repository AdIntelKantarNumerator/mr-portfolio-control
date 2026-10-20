/**
 * Loading people's access in bulk: the Slack pass (20 October 2026).
 *
 *   POST /api/sync/site-users   { users: [{ email, name, title, role, isAdmin, canEditDocs, source }] }
 *
 * SYNC_TOKEN only. Under /api/sync, not /api/agent, on purpose: Yaara's own
 * token is good for /api/agent alone (lib/machine-auth.ts), so she can never
 * change anyone's access. A person an admin has already set is never changed
 * (lib/site-users.ts).
 */
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { importSiteUsers, type ImportRow } from '@/lib/site-users'
import { logChange } from '@/lib/portfolio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  let body: { users?: unknown; by?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'The body must be JSON.' }, { status: 400 })
  }
  const rows: ImportRow[] = (Array.isArray(body.users) ? body.users : [])
    .map((u) => u as Record<string, unknown>)
    .filter((u) => typeof u.email === 'string')
    .map((u) => ({
      email: String(u.email),
      name: typeof u.name === 'string' ? u.name : null,
      title: typeof u.title === 'string' ? u.title : null,
      role: u.role === 'product' ? 'product' : 'commercial',
      isAdmin: u.isAdmin === true,
      canEditDocs: u.canEditDocs === true,
      source: u.source === 'review' ? 'review' : 'slack',
    }))
  const by = typeof body.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 100) : 'Slack import'
  const result = await importSiteUsers(rows, by)
  await logChange({ actor: by, kind: 'change', summary: `Access: loaded ${rows.length} people from Slack (${result.added} new, ${result.updated} updated, ${result.kept} kept as an admin set them)` })
  return Response.json(result)
}
