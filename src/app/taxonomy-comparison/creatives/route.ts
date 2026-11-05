/**
 * GET /taxonomy-comparison/creatives?run=<id>[&input=<pasted name>]
 *
 * Every creative behind a finished comparison — or one advertiser in it —
 * with its Aug–Sep spend, where it lands in GPC, and its metadata from
 * gold.creative. Read live from Databricks when asked (lib/taxonomy-run.ts
 * runCreatives), so it can take half a minute. Behind the sign-in like every
 * page.
 */
import { MONTH_LABEL, MONTHS, TAXONOMY_LABEL } from '@/lib/taxonomy-rules'
import { readRun, runCreatives } from '@/lib/taxonomy-run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const COLUMNS: [string, string][] = [
  ['creative_id', 'Creative ID'],
  ['media', 'Media type'],
  ['aug', `Spend ${MONTH_LABEL[MONTHS[0]]} (USD)`],
  ['sep', `Spend ${MONTH_LABEL[MONTHS[1]]} (USD)`],
  ['gpc_advertisers', 'GPC advertiser(s)'],
  ['gpc_top_parents', 'GPC top parent(s)'],
  ['gpc_attribution', 'GPC spend split (payer <- product)'],
  ['gpc_products', 'GPC product(s)'],
  ['gpc_nodes', 'GPC taxonomy node(s)'],
  ['creative_title', 'Title'],
  ['creative_headline', 'Headline'],
  ['source_channel', 'Source channel'],
  ['provider_code', 'Provider'],
  ['creative_type', 'Creative type'],
  ['creative_width', 'Width'],
  ['creative_height', 'Height'],
  ['creative_duration', 'Duration (s)'],
  ['classification_type', 'Classification'],
  ['gpc_classification_type', 'GPC classification'],
  ['created_timestamp', 'Created'],
  ['first_seen_occurrence_timestamp', 'First seen'],
  ['last_seen_timestamp', 'Last seen'],
  ['first_seen_media_property_name', 'First seen on'],
  ['first_seen_provider_advertiser_name', 'Provider advertiser'],
  ['first_seen_provider_product_name', 'Provider product'],
  ['first_seen_provider_creative_link_url', 'Creative link'],
  ['primary_product_id', 'VX0 product ID'],
  ['vx1_product_id', 'VX1 product ID'],
  ['vx2_product_id', 'VX2 product ID'],
  ['additional_multi_product_flag', 'Multi-product'],
  ['additional_coop_product_flag', 'Co-op'],
]

const esc = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const run = await readRun(params.get('run') ?? '')
  if (!run?.result) return new Response('No finished comparison with that id.', { status: 404 })
  const input = params.get('input')
  const from = run.result.from

  let rows
  try {
    rows = await runCreatives(run, input)
  } catch (err) {
    return new Response(`Could not read the creatives from Databricks: ${(err as Error).message}`, { status: 502 })
  }

  const head = ['Advertiser (as entered)', 'FROM taxonomy', 'FROM entity', 'FROM id', ...COLUMNS.map(([, label]) => label)]
  const lines = [head.map(esc).join(',')]
  for (const { advertiser, row } of rows) {
    const values = COLUMNS.map(([key]) => {
      const v = row[key]
      if ((key === 'aug' || key === 'sep') && v != null) return Math.round(Number(v))
      if (key.endsWith('timestamp') && v) return v.slice(0, 19).replace('T', ' ')
      return v
    })
    lines.push([advertiser.input, TAXONOMY_LABEL[from], advertiser.entity?.name, advertiser.entity?.id, ...values].map(esc).join(','))
  }

  const day = run.createdAt.slice(0, 10)
  const who = input ? `-${input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : ''
  return new Response(`﻿${lines.join('\r\n')}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="creatives-${from.toLowerCase()}-to-gpc${who}-${day}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
