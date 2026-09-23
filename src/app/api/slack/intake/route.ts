/**
 * Slack slash-command intake.
 *
 * Configure a slash command (for example /portfolio-request) pointing at
 * POST /api/slack/intake and set SLACK_SIGNING_SECRET.
 *
 *   /portfolio-request Add LinkedIn coverage | Clients keep asking and we have no data | Brad
 *
 * The point of this endpoint is that a request captured where the conversation
 * happens actually gets captured. A request that requires someone to open a
 * web form usually stays a Slack message nobody can find in three weeks.
 */
import { NextResponse } from 'next/server'
import { desc } from 'drizzle-orm'
import { db } from '@/db/client'
import { intakeRequests } from '@/db/schema'
import { parseSlackIntake, verifySlackSignature } from '@/lib/sources/slack'
import { logChange } from '@/lib/portfolio'
import { nextRef } from '@/lib/util'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secret = process.env.SLACK_SIGNING_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'SLACK_SIGNING_SECRET is not configured' }, { status: 503 })
  }

  const rawBody = await req.text()
  const ok = verifySlackSignature({
    rawBody,
    timestamp: req.headers.get('x-slack-request-timestamp'),
    signature: req.headers.get('x-slack-signature'),
    secret,
  })
  if (!ok) return NextResponse.json({ error: 'bad signature' }, { status: 401 })

  const form = new URLSearchParams(rawBody)
  const text = form.get('text') ?? ''
  const userName = form.get('user_name') ?? 'unknown'

  const { title, problem, sponsor } = parseSlackIntake(text)
  if (!title) {
    return NextResponse.json({
      response_type: 'ephemeral',
      text: 'Usage: `/portfolio-request <title> | <what problem this solves> | <sponsor>`',
    })
  }

  const existing = await db
    .select({ ref: intakeRequests.ref })
    .from(intakeRequests)
    .orderBy(desc(intakeRequests.createdAt))
  const ref = nextRef('REQ-', existing.map((r) => r.ref))

  await db.insert(intakeRequests).values({
    ref,
    title,
    // A request with no stated problem is still worth capturing — triage can
    // chase the detail. Losing it entirely because a field was blank is worse.
    problem: problem || '(not stated — captured from Slack, needs detail at triage)',
    requesterName: userName,
    sponsor,
    status: 'new',
    source: 'slack',
  })

  await logChange({
    actor: userName,
    kind: 'change',
    summary: `${ref} raised from Slack: ${title}`,
  })

  return NextResponse.json({
    response_type: 'ephemeral',
    text: `Logged as *${ref}* — it will be triaged at the next review.${
      problem ? '' : ' Reply in thread with the problem it solves and someone will attach it.'
    }`,
  })
}
