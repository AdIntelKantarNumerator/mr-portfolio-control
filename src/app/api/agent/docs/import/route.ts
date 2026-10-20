/**
 * A document published through Google Drive (Scott, 20 October 2026).
 *
 *   POST /api/agent/docs/import
 *     { sourceRef, driveFileId, folderPath, fileName, content, by, byName? }
 *
 * Protected by SYNC_TOKEN (or Yaara's own token).
 *
 * Claude in Cowork cannot reach this site - its workspace's network allowlist
 * blocks it, and only an org admin can change that - but it can save a file to
 * Google Drive. So people publish by saving the artifact into the shared
 * "Process Documentation" Drive folder, in the subfolder it belongs in, and
 * Yaara (yaara/src/collect/docs-drop.ts) brings each new or changed file here.
 *
 *   folderPath  the file's Drive folders below the shared one, "Guides/Release";
 *               made on the site if missing. A file at the top goes to Unsorted.
 *   by          who last saved the file in Drive. They must be allowed to edit
 *               documentation here; Drive's own sharing is not the check.
 *
 * The answer says what happened, so Yaara can tell a refusal from an outage:
 * 200 added | replaced | already, 403 not allowed, 400 not a document.
 */
import { accessFor } from '@/lib/auth/access'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { logChange } from '@/lib/portfolio'
import { DocError, importFromDrive } from '@/lib/docs'
import { nameFromFile, prepareUpload } from '@/lib/docs-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const base = () => (process.env.APP_URL?.trim() || '').replace(/\/+$/, '')
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'The body must be JSON.' }, { status: 400 })
  }
  const sourceRef = str(body.sourceRef)
  const driveFileId = str(body.driveFileId)
  const fileName = str(body.fileName)
  const by = str(body.by).toLowerCase()
  const content = typeof body.content === 'string' ? body.content : ''
  if (!sourceRef || !driveFileId || !fileName || !by) return Response.json({ error: 'Send sourceRef, driveFileId, fileName, content and by.' }, { status: 400 })

  const access = await accessFor(by)
  if (!access.canEditDocs) return Response.json({ error: `${by} may not edit documentation. An admin can grant it in Admin.`, outcome: 'refused' }, { status: 403 })

  try {
    const name = prepareUpload({ content, fileName }).name || nameFromFile(fileName)
    const done = await importFromDrive({ sourceRef, driveFileId, folderPath: str(body.folderPath), name, fileName, content, by })
    if (done.outcome !== 'already') {
      await logChange({
        actor: by,
        kind: 'change',
        summary: `${done.outcome === 'replaced' ? `New version (${done.version}) of` : 'Published'} "${name}" in Process Documentation, from Google Drive`,
      })
    }
    return Response.json({ ...done, name, url: `${base()}/process-docs/a/${done.id}` })
  } catch (err) {
    if (err instanceof DocError) return Response.json({ error: err.message, outcome: 'refused' }, { status: 400 })
    throw err
  }
}
