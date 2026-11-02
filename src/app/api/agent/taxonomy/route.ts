/**
 * Taxonomy Comparison for Yaara (Scott, 2 November 2026): the same comparison
 * the /taxonomy-comparison screen runs, so what she says in Slack is what the
 * screen shows.
 *
 *   POST /api/agent/taxonomy   { from: "VX1"|"VX2"|"Classic", advertisers: string[], askedBy? }
 *                              → { runId, seeIt }
 *   POST /api/agent/taxonomy   { action: "pick", run, input, candidateId }   ("" for none)
 *                              → the run, as GET returns it
 *   GET  /api/agent/taxonomy?run=<id>[&detail=<pasted name>|all]
 *                              → { status, steps, summaries, detail? }
 *
 * A run takes a minute or two (Databricks), so she starts it and polls GET.
 * The summaries are lib/taxonomy-rules.ts summarise/summaryText — computed,
 * never the model's. `detail` is what she needs for follow-up questions: the
 * candidates, every GPC advertiser and node, splits by media and month, and
 * each charted GPC entity's whole spend by FROM entity.
 *
 * Protected by SYNC_TOKEN, like every /api/agent route.
 */
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import {
  filterFlows,
  flowTotal,
  gpcTotalKey,
  gpcTotalView,
  isFromTaxonomy,
  MEDIA_TYPES,
  MONTH_LABEL,
  MONTHS,
  parseAdvertisers,
  rankAdvertisers,
  rankNodes,
  summarise,
  summaryText,
  TAXONOMY_LABEL,
  type AdvertiserResult,
  type FromTaxonomy,
  type GpcBy,
  type GpcTotalRow,
  type Ranked,
} from '@/lib/taxonomy-rules'
import { chooseEntity, readRun, startRun, type RunView } from '@/lib/taxonomy-run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const seeIt = (id: string) => `/taxonomy-comparison?run=${id}`

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  if (body.action === 'pick') {
    const run = String(body.run ?? '')
    const input = String(body.input ?? '')
    const by = typeof body.askedBy === 'string' && body.askedBy.trim() ? `${body.askedBy.trim()} (through Yaara)` : 'Yaara'
    try {
      const out = await chooseEntity(run, input, String(body.candidateId ?? '') || null, by)
      if (out.error) return Response.json({ error: out.error }, { status: 400 })
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 502 })
    }
    const view = await readRun(run)
    return view ? Response.json(present(view, input)) : Response.json({ error: 'No such run.' }, { status: 404 })
  }

  const from = String(body.from ?? '')
  if (!isFromTaxonomy(from)) {
    return Response.json({ error: 'Say which taxonomy to compare from: "VX1", "VX2" or "Classic" (MediaRadar Classic). The target is always GPC.' }, { status: 400 })
  }
  const list = Array.isArray(body.advertisers) ? body.advertisers.map(String).join('\n') : String(body.advertisers ?? '')
  const { names, error } = parseAdvertisers(list)
  if (error) return Response.json({ error }, { status: 400 })
  const askedBy = typeof body.askedBy === 'string' && body.askedBy.trim() ? `${body.askedBy.trim()} (through Yaara)` : 'Yaara'
  const runId = await startRun(from, names, askedBy)
  return Response.json({ runId, from, advertisers: names, seeIt: seeIt(runId) })
}

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const params = new URL(req.url).searchParams
  const view = await readRun(params.get('run') ?? '')
  if (!view) return Response.json({ error: 'No such run.' }, { status: 404 })
  return Response.json(present(view, params.get('detail')))
}

function present(view: RunView, detail: string | null) {
  const out: Record<string, unknown> = {
    runId: view.id,
    status: view.outdated ? 'outdated' : view.status,
    from: view.input.from,
    advertisers: view.input.names,
    steps: view.steps.map((s) => ({ step: s.label, state: s.state, detail: s.detail ?? null })),
    error: view.error,
    seeIt: seeIt(view.id),
  }
  const r = view.result
  if (!r) return out
  const totals = r.gpcTotals ?? {}
  out.model = r.model
  out.summaries = r.advertisers.map((a) => {
    const s = summarise(a, r.from, totals)
    return { input: a.input, text: summaryText(s, r.from), summary: s }
  })
  if (detail) {
    const wanted = detail === 'all' ? r.advertisers : r.advertisers.filter((a) => a.input.toLowerCase() === detail.toLowerCase())
    out.detail = wanted.map((a) => detailOf(a, r.from, totals))
    out.creativesCsv = `/taxonomy-comparison/creatives?run=${view.id}${detail === 'all' ? '' : `&input=${encodeURIComponent(detail)}`}`
  }
  return out
}

const share = (rows: Ranked[], total: number, n: number) =>
  rows.slice(0, n).map((x) => ({ name: x.label, spend: Math.round(x.spend), share: total ? +(x.spend / total).toFixed(4) : 0 }))

function detailOf(a: AdvertiserResult, from: FromTaxonomy, totals: Record<string, GpcTotalRow[]>) {
  const total = flowTotal(a.flows)
  const gpcTotals = (['advertiser', 'parent'] as GpcBy[]).flatMap((by) =>
    rankAdvertisers(a.flows, by)
      .slice(0, 8)
      .flatMap((g) => {
        const rows = totals[gpcTotalKey(by, g.key)]
        if (!rows) return []
        const v = gpcTotalView(rows, {}, a.entity, from)
        return [{
          level: by === 'parent' ? 'GPC top parent' : 'GPC advertiser',
          gpc: g.label,
          totalInGpc: Math.round(v.total),
          fromThisAdvertiser: Math.round(v.own),
          fromOtherAdvertisers: Math.round(v.total - v.own),
          byFromEntity: v.rows.slice(0, 10).map((x) => ({ name: x.label, parent: x.parent ?? null, spend: Math.round(x.spend), thisComparison: x.own })),
        }]
      }),
  )
  return {
    input: a.input,
    fromTaxonomy: TAXONOMY_LABEL[from],
    matched: a.entity ? { id: a.entity.id, name: a.entity.name, level: a.entity.level ?? null, why: a.entity.reason ?? null, chosenBy: a.entity.chosenBy ?? null } : null,
    otherCandidates: a.candidates
      .filter((c) => c.id !== a.entity?.id)
      .map((c) => ({ id: c.id, name: c.name, level: c.level ?? null, size: c.spend != null ? `$${Math.round(c.spend).toLocaleString('en-US')}` : (c.size ?? null), via: c.via ?? null })),
    totalSpend: Math.round(total),
    classicReportedSpend: a.classicReported != null ? Math.round(a.classicReported) : null,
    byMedia: Object.fromEntries(MEDIA_TYPES.map((m) => [m, Math.round(flowTotal(filterFlows(a.flows, { media: m })))])),
    byMonth: Object.fromEntries(MONTHS.map((m) => [MONTH_LABEL[m], Math.round(flowTotal(filterFlows(a.flows, { month: m })))])),
    gpcAdvertisers: share(rankAdvertisers(a.flows, 'advertiser'), total, 25),
    gpcTopParents: share(rankAdvertisers(a.flows, 'parent'), total, 15),
    gpcIndustries: share(rankNodes(a.flows, 'industry'), total, 15),
    gpcCategories: share(rankNodes(a.flows, 'category'), total, 25),
    gpcAdvertisersByMedia: Object.fromEntries(MEDIA_TYPES.map((m) => {
      const f = filterFlows(a.flows, { media: m })
      return [m, share(rankAdvertisers(f, 'advertiser'), flowTotal(f), 5)]
    })),
    gpcTotals,
    flags: a.flags.map((f) => f.text),
    commentary: a.commentary,
  }
}
