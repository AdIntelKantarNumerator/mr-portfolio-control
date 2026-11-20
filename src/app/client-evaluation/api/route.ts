/**
 * Client Evaluation's reads and actions (app/client-evaluation).
 *
 *   GET  ?op=sources                          each platform's snapshot and any refresh in progress
 *   GET  ?op=clients&q&platform&sort&active&internal&offset
 *   GET  ?op=account&key=<platform:account>   one account's entitlements (the popup)
 *   GET  ?op=people&client=<id>               a client's people across platforms
 *   GET  ?op=reports&user=<360 usr id>        a 360 user's reports used in 2026, live
 *   GET  ?op=report&key=<mnemonic:id>         one 360 report's spec, live, described
 *   GET  ?op=profiles&user=<360 usr id>       a 360 user's reporting profiles, live
 *   POST { op: 'refresh', platform }          start a refresh (360, Magnifier)
 *   POST { op: 'merge', member, withMember }  put an account with another's client
 *   POST { op: 'split', member }              make an account its own client
 *
 * Under /client-evaluation, so the request gate already requires "Sees Client
 * Evaluation"; checked again here because the gate does not enforce roles on
 * the embedded local database.
 */
import { NextResponse } from 'next/server'
import { db } from '@/db/client'
import { currentAccess } from '@/lib/auth/access'
import { describe } from '@/lib/import360/decode'
import { live360Configured, liveLookup, liveReport, liveReports } from '@/lib/import360/source'
import { ensureExport } from '@/lib/client-eval/export-cache'
import { liveProfiles } from '@/lib/client-eval/profiles'
import { canRefreshHere, startRefresh } from '@/lib/client-eval/refresh'
import { accountDetail, addOverride, clientPeople, listClients, sources } from '@/lib/client-eval/store'
import { isPlatform, parseMember } from '@/lib/client-eval/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

async function allowed() {
  const a = await currentAccess()
  return a.canSeeClientEvaluation ? a : null
}

export async function GET(req: Request) {
  if (!(await allowed())) return bad('Client Evaluation is not switched on for you.', 403)
  const u = new URL(req.url).searchParams
  const op = u.get('op')
  try {
    if (op === 'sources') {
      const s = await sources(db)
      return NextResponse.json({ sources: s.map((x) => ({ ...x, refreshable: canRefreshHere(x.platform) })) })
    }
    if (op === 'clients') {
      const platform = u.get('platform') ?? 'all'
      const sort = u.get('sort') ?? 'reports'
      return NextResponse.json(
        await listClients(db, {
          q: (u.get('q') ?? '').slice(0, 200),
          platform: platform === 'multi' || platform === 'all' || isPlatform(platform) ? platform : 'all',
          sort: sort === 'name' || sort === 'users' ? sort : 'reports',
          active: u.get('active') === '1',
          internal: u.get('internal') === '1',
          offset: Math.max(0, Number(u.get('offset')) || 0),
          limit: 100,
        }),
      )
    }
    if (op === 'account') {
      const key = u.get('key') ?? ''
      if (!parseMember(key)) return bad('Unknown account.')
      const a = await accountDetail(db, key)
      return a ? NextResponse.json(a) : bad('That account is not in the snapshot.', 404)
    }
    if (op === 'people') {
      const p = await clientPeople(db, u.get('client') ?? '')
      return p ? NextResponse.json(p) : bad('That client is not in the list. It may have changed with a refresh.', 404)
    }
    if (op === 'reports') {
      const usr = Number(u.get('user'))
      if (!Number.isInteger(usr) || usr <= 0) return bad('Unknown 360 user.')
      if (!live360Configured()) return bad('360 is not reachable from this server.')
      return NextResponse.json({ reports: await liveReports(usr) })
    }
    if (op === 'profiles') {
      const usr = Number(u.get('user'))
      if (!Number.isInteger(usr) || usr <= 0) return bad('Unknown 360 user.')
      if (!live360Configured()) return bad('360 is not reachable from this server.')
      return NextResponse.json({ profiles: await liveProfiles(usr) })
    }
    if (op === 'report') {
      const key = u.get('key') ?? ''
      if (!live360Configured()) return bad('360 is not reachable from this server.')
      const r = await liveReport(key)
      const described = describe(r.spec, await liveLookup(r.spec))
      return NextResponse.json({ key, name: r.name, client: r.client, user: r.user, lastUsed: r.lastUsed ? r.lastUsed.toISOString().slice(0, 10) : null, described })
    }
    return bad('Unknown request.')
  } catch (err) {
    console.error('[client-eval] GET', op, err)
    return bad((err as Error).message || 'That could not be read.', 500)
  }
}

export async function POST(req: Request) {
  const who = await allowed()
  if (!who) return bad('Client Evaluation is not switched on for you.', 403)
  const body = (await req.json().catch(() => ({}))) as { op?: string; platform?: string; member?: string; withMember?: string }
  const by = who.email || who.name || null
  try {
    if (body.op === 'refresh') {
      if (!isPlatform(body.platform)) return bad('Unknown platform.')
      const r = await startRefresh(body.platform, by)
      return 'error' in r ? bad(r.error, 409) : NextResponse.json({ ok: true })
    }
    if (body.op === 'merge' || body.op === 'split') {
      const member = String(body.member ?? '')
      const withMember = body.op === 'merge' ? String(body.withMember ?? '') : null
      if (!parseMember(member) || (withMember !== null && !parseMember(withMember))) return bad('Unknown account.')
      if (member === withMember) return bad('That is the same account.')
      await addOverride(db, { kind: body.op, member, withMember, by })
      // The clients changed: rebuild the kept export in the background.
      void ensureExport(by).catch((err) => console.error('[client-eval] export after override', err))
      return NextResponse.json({ ok: true })
    }
    return bad('Unknown request.')
  } catch (err) {
    console.error('[client-eval] POST', body.op, err)
    return bad((err as Error).message || 'That could not be saved.', 500)
  }
}
