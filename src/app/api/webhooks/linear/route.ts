/**
 * Linear webhook receiver.
 *
 * Point a Linear webhook at POST /api/webhooks/linear and subscribe to
 * Projects, Initiatives and Project milestones. Set LINEAR_WEBHOOK_SECRET to
 * the signing secret Linear shows when you create the webhook.
 *
 * Security notes, because this endpoint is necessarily public:
 *   - the signature is verified against the RAW body, before any parsing;
 *   - comparison is constant-time, so the endpoint can't be used as an oracle;
 *   - the payload timestamp is checked against a 60s window to stop replays;
 *   - an unset secret rejects everything rather than defaulting to open.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  archiveByExternalId,
  upsertInitiative,
  upsertMilestone,
  upsertProject,
} from '@/lib/sources/linear'
import { logChange } from '@/lib/portfolio'
import { db } from '@/db/client'
import { sourceRecords } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REPLAY_WINDOW_MS = 60_000

function verify(raw: string, signature: string | null, secret: string): boolean {
  if (!signature) return false
  const expected = createHmac('sha256', secret).update(raw).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

interface LinearWebhook {
  action: 'create' | 'update' | 'remove'
  type: string
  data: Record<string, unknown>
  webhookTimestamp?: number
  url?: string
}

export async function POST(req: Request) {
  const secret = process.env.LINEAR_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'LINEAR_WEBHOOK_SECRET is not configured' },
      { status: 503 },
    )
  }

  const raw = await req.text()
  if (!verify(raw, req.headers.get('linear-signature'), secret)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 })
  }

  let payload: LinearWebhook
  try {
    payload = JSON.parse(raw) as LinearWebhook
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  if (
    payload.webhookTimestamp &&
    Math.abs(Date.now() - payload.webhookTimestamp) > REPLAY_WINDOW_MS
  ) {
    return NextResponse.json({ error: 'stale timestamp' }, { status: 401 })
  }

  try {
    await handle(payload)
  } catch (err) {
    // Return 200 on a handling error: Linear retries non-2xx, and a payload we
    // can't process will fail identically on every retry. The scheduled
    // reconciliation sync is the backstop that repairs whatever was missed.
    console.error('[linear-webhook] handling failed', err)
    await logChange({
      actor: 'linear-webhook',
      kind: 'sync',
      summary: `Webhook for ${payload.type} could not be applied`,
      detail: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ ok: true, applied: false })
  }

  return NextResponse.json({ ok: true, applied: true })
}

async function handle(payload: LinearWebhook) {
  const { type, action, data } = payload
  const id = data.id as string | undefined
  if (!id) return

  if (action === 'remove') {
    await archiveByExternalId(id)
    await logChange({
      actor: 'linear-webhook',
      kind: 'sync',
      summary: `${type} removed in Linear — archived here`,
    })
    return
  }

  switch (type) {
    case 'Project': {
      await upsertProject(data)
      await logChange({
        actor: 'linear-webhook',
        kind: 'sync',
        summary: `Project "${data.name ?? id}" ${action}d in Linear`,
      })
      return
    }
    case 'Initiative': {
      await upsertInitiative(data)
      await logChange({
        actor: 'linear-webhook',
        kind: 'sync',
        summary: `Initiative "${data.name ?? id}" ${action}d in Linear`,
      })
      return
    }
    case 'ProjectMilestone': {
      // The webhook gives the parent by external id; resolve it to ours.
      const projectExternalId = (data.projectId ?? (data.project as { id?: string })?.id) as
        | string
        | undefined
      if (!projectExternalId) return
      const [link] = await db
        .select({ entityId: sourceRecords.entityId })
        .from(sourceRecords)
        .where(
          and(
            eq(sourceRecords.system, 'linear'),
            eq(sourceRecords.externalId, projectExternalId),
          ),
        )
        .limit(1)
      if (!link) return // parent not synced yet; the next full sync will pick it up
      await upsertMilestone(data, link.entityId)
      await logChange({
        actor: 'linear-webhook',
        kind: 'sync',
        summary: `Milestone "${data.name ?? id}" ${action}d in Linear`,
      })
      return
    }
    default:
      return
  }
}
