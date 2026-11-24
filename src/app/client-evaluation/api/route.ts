/**
 * Client Evaluation's reads and actions (app/client-evaluation).
 *
 *   GET  ?op=sources                          each platform's snapshot and any refresh in progress
 *   GET  ?op=clients&q&platform&sort&active&internal&offset
 *   GET  ?op=account&key=<platform:account>   one account's entitlements (the popup)
 *   GET  ?op=people&client=<id>               a client's people across platforms
 *   GET  ?op=ratings&from=YYYY-MM&to=YYYY-MM  360 reports run with VideoAmp ratings, by client and user, live
 *   GET  ?op=inactive&since=YYYY-MM-DD        active accounts with no login on or after that day
 *   GET  ?op=plan&client=<id>                 a client's Migration Plan, or where it is in the queue (and, for admins, the planner's progress)
 *   GET  ?op=plan-doc&client=<id>             the Migration Plan as a Word document
 *   GET  ?op=reports&user=<360 usr id>        a 360 user's reports used in 2026, live
 *   GET  ?op=report&key=<mnemonic:id>         one 360 report's spec, live, described
 *   GET  ?op=profiles&user=<360 usr id>       a 360 user's reporting profiles, live
 *   GET  ?op=searches&user=<code>&accounts=<codes>  a Magnifier user's 2026 saved searches, live
 *   POST { op: 'refresh', platform }          start a refresh (360, Magnifier)
 *   POST { op: 'merge', member, withMember }  put an account with another's client
 *   POST { op: 'split', member }              make an account its own client
 *   POST { op: 'export', clients: [ids] }     the ticked clients and their users, as an Excel workbook
 *   POST { op: 'plan', client }               build (or rebuild) a client's Migration Plan now, in full
 *   POST { op: 'plans-refresh', client? }     admins: rebuild every plan, or one client's
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
import { buildExport, EXPORT_MAX } from '@/lib/client-eval/export'
import { inactiveAccounts, LOGIN_FROM, validSince } from '@/lib/client-eval/inactive'
import { planDocx } from '@/lib/client-eval/migration/plan-docx'
import { ensurePlanner, plannerStats, readPlan, refreshPlans, requestPlan } from '@/lib/client-eval/migration/planner'
import { liveProfiles } from '@/lib/client-eval/profiles'
import { USAGE_FROM, usageMonths, videoAmpUsage } from '@/lib/client-eval/ratings-usage'
import { liveSearches, mongoUrl } from '@/lib/client-eval/saved-searches'
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
  const who = await allowed()
  if (!who) return bad('Client Evaluation is not switched on for you.', 403)
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
      const q = (u.get('q') ?? '').slice(0, 200)
      const filter = {
        q,
        platform: platform === 'multi' || platform === 'all' || isPlatform(platform) ? platform : 'all',
        sort: sort === 'name' || sort === 'users' || sort === 'logins' ? sort : 'reports',
        active: u.get('active') === '1',
        internal: u.get('internal') === '1',
        // Canada is left out unless asked for (Scott, 24 November 2026: "Exclude Canada", on by default).
        canada: u.get('canada') === '1',
      } as const
      // Select all: every client the search matches, ids and names only. Only for a search (Scott, 20 November 2026).
      if (u.get('ids') === '1') {
        if (!q.trim()) return bad('Search first: select all works on a searched list.')
        const r = await listClients(db, { ...filter, offset: 0, limit: EXPORT_MAX + 1 })
        return NextResponse.json({ total: r.total, clients: r.rows.slice(0, EXPORT_MAX).map((c) => ({ id: c.id, name: c.name })) })
      }
      return NextResponse.json(await listClients(db, { ...filter, offset: Math.max(0, Number(u.get('offset')) || 0), limit: 100 }))
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
    if (op === 'ratings') {
      if (!live360Configured()) return bad('360 is not reachable from this server.')
      const months = usageMonths()
      const from = u.get('from') ?? USAGE_FROM
      const to = u.get('to') ?? months[months.length - 1]!
      return NextResponse.json({ months, ...(await videoAmpUsage(db, from, to)) })
    }
    if (op === 'inactive') {
      let since: string
      try {
        since = validSince(u.get('since'))
      } catch (e) {
        return bad((e as Error).message)
      }
      return NextResponse.json({ since, loginFrom: LOGIN_FROM, accounts: await inactiveAccounts(db, since) })
    }
    if (op === 'plan') {
      ensurePlanner()
      const client = (u.get('client') ?? '').slice(0, 300)
      const view = await readPlan(client)
      return NextResponse.json({ ...view, admin: who.isAdmin, planner: who.isAdmin ? await plannerStats() : null })
    }
    if (op === 'plan-doc') {
      const view = await readPlan((u.get('client') ?? '').slice(0, 300))
      if (!view.plan) return bad('That plan is not built yet.', 404)
      const file = await planDocx(view.plan)
      const name = `${view.plan.client.replace(/[^A-Za-z0-9 ._-]+/g, '').trim().slice(0, 80) || 'Client'} - Migration Plan ${view.plan.built.slice(0, 10)}.docx`
      return new Response(new Uint8Array(file), {
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'content-disposition': `attachment; filename="${name}"`,
          'cache-control': 'no-store',
        },
      })
    }
    if (op === 'reports') {
      const usr = Number(u.get('user'))
      if (!Number.isInteger(usr) || usr <= 0) return bad('Unknown 360 user.')
      if (!live360Configured()) return bad('360 is not reachable from this server.')
      return NextResponse.json({ reports: await liveReports(usr) })
    }
    if (op === 'searches') {
      const user = (u.get('user') ?? '').trim()
      const accounts = (u.get('accounts') ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20)
      if (!user || user.length > 100) return bad('Unknown Magnifier user.')
      if (!mongoUrl()) return bad("Magnifier's saved searches are not configured on this server.")
      return NextResponse.json(await liveSearches(user, accounts))
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
  const body = (await req.json().catch(() => ({}))) as { op?: string; platform?: string; member?: string; withMember?: string; clients?: unknown; client?: unknown }
  const by = who.email || who.name || null
  try {
    if (body.op === 'export') {
      const ids = Array.isArray(body.clients) ? body.clients.filter((x): x is string => typeof x === 'string' && x.length <= 300) : []
      if (!ids.length) return bad('Tick the clients to export.')
      if (ids.length > EXPORT_MAX) return bad(`Export up to ${EXPORT_MAX} clients at a time.`)
      const file = await buildExport(db, ids)
      const name = `Client Evaluation - ${ids.length} client${ids.length === 1 ? '' : 's'} ${new Date().toISOString().slice(0, 10)}.xlsx`
      return new Response(new Uint8Array(file), {
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="${name}"`,
          'cache-control': 'no-store',
        },
      })
    }
    if (body.op === 'plan') {
      const client = typeof body.client === 'string' ? body.client.slice(0, 300) : ''
      await requestPlan(client, by)
      return NextResponse.json({ ok: true })
    }
    if (body.op === 'plans-refresh') {
      if (!who.isAdmin) return bad('Only Portfolio admins can refresh the plans.', 403)
      const client = typeof body.client === 'string' && body.client ? body.client.slice(0, 300) : undefined
      return NextResponse.json({ ok: true, queued: await refreshPlans(by, client) })
    }
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
      return NextResponse.json({ ok: true })
    }
    return bad('Unknown request.')
  } catch (err) {
    console.error('[client-eval] POST', body.op, err)
    return bad((err as Error).message || 'That could not be saved.', 500)
  }
}
