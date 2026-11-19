/**
 * GET /prototypes/magnifier-offline-reports/workbook?kind=summary|occurrences|fasttrack&node=..&m=..&w=..&media=..&adv=..&who=..
 *
 * The Excel workbook for the report on screen, laid out like the Magnifier
 * offline report clients receive today (lib/magnifier-reports/workbook.ts):
 * the Summary Report from the monthly tabs, the Occurrence Table from the
 * Occurrences tab, the Weekly FastTrack from the weekly tab. Behind the same
 * "Sees prototypes" switch as the page.
 *
 * 17 November 2026: a download for a big category ran the site out of memory
 * and took it down. The workbook is now streamed to the browser as it is
 * written (lib/magnifier-reports/workbook.ts), and only one is built at a
 * time per server: a second request while one is building is turned away
 * with a "try again" rather than doubling the memory.
 */
import { PassThrough, Readable } from 'node:stream'
import { currentAccess } from '@/lib/auth/access'
import { getAuthConfig } from '@/lib/auth/config'
import * as data from '@/lib/magnifier-reports/data'
import { trail, type Level } from '@/lib/magnifier-reports/rules'
import { fastTrack, fileName, occurrenceTable, summaryReport, type ReportInput } from '@/lib/magnifier-reports/workbook'
import { readState } from '../state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const KINDS = { summary: 'SummaryReport', occurrences: 'OccurrenceTable', fasttrack: 'FastTrack' } as const

/** The workbook being built on this server, if any. */
let building: string | null = null

export async function GET(req: Request) {
  const access = await currentAccess()
  if (getAuthConfig().enabled && !access.canSeePrototypes) return new Response('Prototypes are not switched on for you.', { status: 403 })
  if (!data.configured()) return new Response('Prod ClickHouse is not connected here.', { status: 503 })

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind') as keyof typeof KINDS | null
  if (!kind || !(kind in KINDS)) return new Response('Ask for kind=summary, occurrences or fasttrack.', { status: 400 })
  const s = readState(Object.fromEntries(url.searchParams))
  if (building) return new Response(`Another workbook (${building}) is being prepared. Try again in a minute.`, { status: 429, headers: { 'retry-after': '60' } })

  try {
    const months = await data.months()
    const tax = await data.taxonomy(months.at(-1)!)
    const node = tax.nodes.find((n) => n.id === s.node)
    if (!node) return new Response('Pick a category first.', { status: 400 })
    const level = node.level as Level
    const scope: data.Scope = { node: node.id, level, media: s.media, adv: s.adv, who: s.who }

    let focusName: string | null = null
    if (s.adv) {
      const rows = await data.cube({ node: node.id, level, media: s.media }, months)
      const r = rows.find((x) => (s.who === 'parent' ? x.pid : x.aid) === s.adv)
      focusName = r ? (s.who === 'parent' ? r.pname || r.aname : r.aname) : null
    }
    const input: ReportInput = { node, trail: trail(tax.nodes, node.id), scope, who: s.who, focusName, appUrl: process.env.APP_URL?.trim().replace(/\/+$/, '') || url.origin }

    let stamp: string
    let write: (out: PassThrough) => Promise<void>
    if (kind === 'summary') {
      const ym = s.m != null && months.includes(s.m) ? s.m : months.at(-1)!
      write = (out) => summaryReport(input, months.filter((m) => m <= ym), ym, out)
      stamp = String(ym)
    } else {
      const weeks = await data.weeks(months[0])
      const week = s.w && weeks.includes(s.w) ? s.w : weeks.at(-1)
      if (!week) return new Response('No whole week of data yet.', { status: 404 })
      write = (out) => (kind === 'fasttrack' ? fastTrack(input, weeks, week, out) : occurrenceTable(input, week, out))
      stamp = week
    }

    // The file goes to the browser as it is written. If building fails part way, the download fails
    // rather than handing over a broken file.
    const name = fileName(node, KINDS[kind], stamp)
    building = name
    const out = new PassThrough()
    write(out)
      .catch((err) => {
        console.error('[magnifier workbook] build failed', name, err)
        out.destroy(err as Error)
      })
      .finally(() => {
        building = null
      })
    return new Response(Readable.toWeb(out) as ReadableStream<Uint8Array>, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'private, no-store',
      },
    })
  } catch (err) {
    return new Response(`The workbook could not be built: ${(err as Error).message}`, { status: 502 })
  }
}
