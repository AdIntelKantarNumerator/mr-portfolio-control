/**
 * A Report Builder report as a file, from the download links in the chat.
 *
 *   GET /prototypes/report-builder/export?r=<report>&name=<file name>&format=csv|xlsx|pdf
 *
 * Laid out as 360 lays out its CSV, Excel and PDF (lib/report-builder/export/files.ts).
 *
 * The report travels in the link (base64url JSON) and is recomputed here for
 * whoever opens it, on their own saved state, so a link never carries data,
 * only the question. Under /prototypes, so the request gate already requires
 * a portfolio sign-in with "Sees prototypes"; checked again here because the
 * gate does not enforce roles on the embedded local database.
 */
import { currentAccess } from '@/lib/auth/access'
import { getAuthConfig } from '@/lib/auth/config'
import { engineFor, loadUser } from '@/lib/report-builder/agent'
import { csvFile, FORMATS, pdfFile, xlsxFile, type FileFormat, type FileMeta } from '@/lib/report-builder/export/files'
import { describeReport } from '@/lib/report-builder/page-view'
import { emptyChat } from '@/lib/report-builder/tools'
import type { Spec } from '@/lib/report-builder/engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const access = await currentAccess()
  if (getAuthConfig().enabled && !access.canSeePrototypes) return new Response('Report Builder is not switched on for you.', { status: 403 })

  const url = new URL(req.url)
  let spec: Spec
  try {
    spec = JSON.parse(Buffer.from(url.searchParams.get('r') ?? '', 'base64url').toString('utf8')) as Spec
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('not a report')
  } catch {
    return new Response('That download link is damaged. Ask Report Builder to run the report again.', { status: 400 })
  }

  const { engine } = await engineFor(access.email ? await loadUser(access.email.toLowerCase()) : null, access.email ? access.email.toLowerCase() : null)
  const v = await engine.validate(spec)
  if (!v.ok) return new Response('That report is not complete, so there is nothing to download.', { status: 400 })
  const result = await engine.run(v.spec)
  const name = (url.searchParams.get('name') ?? 'Report').replace(/[^A-Za-z0-9 &'()-]+/g, '').trim().slice(0, 80) || 'Report'
  const f = url.searchParams.get('format')
  const format: FileFormat = f === 'xlsx' || f === 'pdf' ? f : 'csv'

  const panel = await describeReport(engine, { ...emptyChat(), report: v.spec })
  const imp = (spec as { import_360?: { client: string; user: string; report: string; notes?: Array<{ impact: string; what: string; did: string }> } }).import_360
  const meta: FileMeta = {
    title: name,
    completed: new Date(),
    summary: panel.rows.concat(panel.period ? [{ label: 'Period', value: panel.period }] : []),
    ...(access.email ? { owner: access.email } : {}),
    ...(imp ? { imported: { client: imp.client, user: imp.user, report: imp.report, notes: imp.notes ?? [] } } : {}),
  }
  let body: string | Uint8Array
  try {
    body = format === 'xlsx' ? await xlsxFile(result, meta) : format === 'pdf' ? await pdfFile(result, meta) : csvFile(result, meta)
  } catch (err) {
    // Said in words, not a bare 500: the person can try another format meanwhile.
    console.error(`[report-builder export] ${format}, ${result.rows.length} rows:`, err)
    return new Response(`The ${format.toUpperCase()} file could not be made (${(err as Error).message}). The CSV download has every row; please tell the Report Builder team.`, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  const file = `${name} (${result.period.label.replace('–', 'to')}).${FORMATS[format].ext}`
  return new Response(body as BodyInit, {
    headers: {
      'content-type': FORMATS[format].type,
      'content-disposition': `attachment; filename="${file.replace(/"/g, '')}"`,
      'cache-control': 'no-store',
    },
  })
}
