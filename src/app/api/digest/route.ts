/**
 * Weekly Slack digest. Point a scheduler at this, e.g. Monday 08:00:
 *   curl -XPOST -H "Authorization: Bearer $SYNC_TOKEN" $APP_URL/api/digest
 */
import { NextResponse } from 'next/server'
import { buildDigest, postDigest } from '@/lib/sources/slack'
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const result = await postDigest(process.env.APP_URL)
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}

/**
 * Preview the digest without posting it.
 *
 * Authenticated like the POST: the preview contains the same portfolio
 * content, so leaving it open would defeat the point of protecting the send.
 */
export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  return NextResponse.json({ blocks: await buildDigest(process.env.APP_URL) })
}
