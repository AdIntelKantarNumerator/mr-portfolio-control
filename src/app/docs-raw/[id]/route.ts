/**
 * An artifact's page, as it was uploaded, for the viewer's frame.
 *
 *   GET /docs-raw/<artifact id>[?v=<version>]
 *
 * Behind sign-in and the role gate like any Reference page (proxy.ts).
 *
 * WHY THE SANDBOX
 *
 * An artifact is someone's HTML and JavaScript, run on this site's address.
 * Served plainly it could read the page it sits in, call this app's APIs as
 * the person viewing it, or change what they see. The Content-Security-Policy
 * sandbox below gives it an origin of its own: its scripts, CDN libraries,
 * fonts, links and downloads all work as they do on Claude, but it cannot
 * reach this site, its cookies or its data. It applies even when this address
 * is opened directly rather than in the frame.
 */
import { artifactHtml } from '@/lib/docs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SANDBOX = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const v = Number(new URL(req.url).searchParams.get('v'))
  const html = await artifactHtml(id, Number.isInteger(v) && v > 0 ? v : undefined)
  if (html === null) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': SANDBOX,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': 'private, no-store',
    },
  })
}
