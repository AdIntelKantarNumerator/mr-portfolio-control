/**
 * A plain list of one application's users (Scott, 23 November 2026, for client
 * support): name, email, platform, account, username, created, last login.
 *
 *   GET ?platform=360|classic|magnifier   a CSV of every active user in the snapshot (Scott: active only)
 *
 * CSV, not Excel, to keep the file small, and streamed from the snapshot a
 * batch at a time, so nothing is built up or kept on the server.
 *
 * Under /client-evaluation, so the gate already requires "Sees Client
 * Evaluation"; checked again here because the gate does not enforce roles on
 * the embedded local database.
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/db/client'
import { ceAccounts, ceUsers } from '@/db/schema'
import { currentAccess } from '@/lib/auth/access'
import { csvField } from '@/lib/client-eval/csv'
import { PLATFORM_LABEL, PLATFORMS, type Platform } from '@/lib/client-eval/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BATCH = 5000
const HEAD = ['Name', 'Email', 'Platform', 'Account', 'Username', 'Created', 'Last login']

export async function GET(req: Request) {
  const who = await currentAccess()
  if (!who.canSeeClientEvaluation) return NextResponse.json({ error: 'Client Evaluation is not switched on for you.' }, { status: 403 })
  const platform = new URL(req.url).searchParams.get('platform') as Platform | null
  if (!platform || !PLATFORMS.includes(platform)) return NextResponse.json({ error: 'Which application?' }, { status: 400 })

  const d = db
  const names = new Map((await d.select({ id: ceAccounts.accountId, name: ceAccounts.name }).from(ceAccounts).where(eq(ceAccounts.platform, platform))).map((a) => [a.id, a.name]))
  const label = PLATFORM_LABEL[platform]
  const enc = new TextEncoder()
  let after: { a: string; u: string } | null = null
  let started = false

  const body = new ReadableStream<Uint8Array>({
    async pull(ctl) {
      if (!started) {
        started = true
        // The byte-order mark tells Excel the file is UTF-8, so accented names read right.
        ctl.enqueue(enc.encode('﻿' + HEAD.join(',') + '\r\n'))
        return
      }
      const rows = await d
        .select({ accountId: ceUsers.accountId, userId: ceUsers.userId, name: ceUsers.name, email: ceUsers.email, login: ceUsers.login, created: ceUsers.created, lastSeen: ceUsers.lastSeen })
        .from(ceUsers)
        .where(and(eq(ceUsers.platform, platform), eq(ceUsers.active, true), after ? sql`(${ceUsers.accountId}, ${ceUsers.userId}) > (${after.a}, ${after.u})` : undefined))
        .orderBy(asc(ceUsers.accountId), asc(ceUsers.userId))
        .limit(BATCH)
      if (!rows.length) return ctl.close()
      const last = rows[rows.length - 1]!
      after = { a: last.accountId, u: last.userId }
      ctl.enqueue(
        enc.encode(
          rows
            .map((r) => [r.name, r.email, label, names.get(r.accountId) ?? r.accountId.trim(), r.login, r.created, r.lastSeen].map(csvField).join(',') + '\r\n')
            .join(''),
        ),
      )
    },
  })

  const day = new Date().toISOString().slice(0, 10)
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${label} users ${day}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
