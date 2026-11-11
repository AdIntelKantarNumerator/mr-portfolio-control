/**
 * A Report Builder spreadsheet, from the download link in the chat.
 *
 *   GET /prototypes/report-builder/export?r=<report>&name=<file name>
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
import { csv } from '@/lib/report-builder/engines'
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

  const { engine } = await engineFor(access.email ? await loadUser(access.email.toLowerCase()) : null)
  const v = await engine.validate(spec)
  if (!v.ok) return new Response('That report is not complete, so there is nothing to download.', { status: 400 })
  const result = await engine.run(v.spec)
  const name = (url.searchParams.get('name') ?? 'Report').replace(/[^A-Za-z0-9 &'-]+/g, '').trim().slice(0, 80) || 'Report'
  const file = `${name} (${result.period.label.replace('–', 'to')}).csv`
  return new Response('﻿' + csv(result), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${file.replace(/"/g, '')}"`,
      'cache-control': 'no-store',
    },
  })
}
