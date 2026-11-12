/**
 * GET /taxonomy-comparison/creative/<creative id>?type=thumbnail|creative
 *
 * A creative's thumbnail, or the creative itself, from MediaRadar's creative
 * API (Scott, 12 November 2026) - one way for every media type:
 *
 *   api.mediaradar.com/api/v1/Creative/CreativeByGlobalCreativeID
 *     ?accessKey=<key>&globalCreativeID=<creative_id>&fileType=thumbnail|creative
 *
 * A thumbnail is a JPEG for every media; "creative" is the file itself, an
 * MP4 for TV, CTV and Social, an image for Digital (checked 12 November).
 *
 * The page never sees the key: it asks here, behind the sign-in, and this
 * fetches with MEDIARADAR_API_KEY (a Key Vault reference, MEDIARADAR-API-KEY
 * in kv-mr-portfolio-web) and passes the file through. Nothing that carries
 * the key is logged or returned - an error says what failed, not where.
 * A Range request is passed on, so a video can be scrubbed.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const API = 'https://api.mediaradar.com/api/v1/Creative/CreativeByGlobalCreativeID'
const TYPES = new Set(['thumbnail', 'creative'])

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const type = new URL(req.url).searchParams.get('type') ?? 'thumbnail'
  if (!/^\d{1,20}$/.test(id) || !TYPES.has(type)) return new Response('Not a creative id or file type.', { status: 400 })
  const key = process.env.MEDIARADAR_API_KEY?.trim()
  if (!key) return new Response('The MediaRadar creative API is not configured (MEDIARADAR_API_KEY).', { status: 503 })

  const url = `${API}?accessKey=${encodeURIComponent(key)}&globalCreativeID=${id}&fileType=${type}`
  let res: Response
  try {
    const range = req.headers.get('range')
    res = await fetch(url, { headers: range ? { range } : {}, signal: AbortSignal.timeout(60_000) })
  } catch (err) {
    const why = (err as Error).name === 'TimeoutError' ? 'it did not answer within a minute' : 'it could not be reached'
    return new Response(`The MediaRadar creative API failed: ${why}.`, { status: 502 })
  }
  if (!res.ok && res.status !== 206) return new Response(`The MediaRadar creative API answered ${res.status} for creative ${id}.`, { status: res.status === 404 ? 404 : 502 })

  const headers = new Headers({
    'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
    // A creative does not change; the viewer's browser may keep it for a day.
    'cache-control': 'private, max-age=86400',
  })
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = res.headers.get(h)
    if (v) headers.set(h, v)
  }
  return new Response(res.body, { status: res.status, headers })
}
