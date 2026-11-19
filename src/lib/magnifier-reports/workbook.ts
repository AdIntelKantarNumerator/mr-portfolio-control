/**
 * Magnifier Offline Reports: the Excel downloads (Scott, 16 November 2026:
 * "an Excel download that produces an excel file similar to what they get
 * today").
 *
 * Three workbooks, one per Magnifier offline report, with the same sheet
 * names, order and look (Verdana, white on navy headers, dollars shown in
 * thousands) as the samples:
 *   Summary Report     Dashboard, Summary, Product|Campaign, MediaType, MediaMix,
 *                      MediaSOV, Product|Media|Trend, Creatives,
 *                      AdvertiserQuickPivot, PivotTableDetail, Notes
 *   Occurrence Table   Occurrences, Notes
 *   Weekly FastTrack   Dashboard, WeekAtAGlance, SpendingTrend, WeeklyMediaUsage,
 *                      MediaTrendSummary, MediaOutlet, Creatives, Detail,
 *                      AdvertiserQuickPivot, PivotTableDetail, Notes
 * What differs: the dashboards are tables with data bars rather than charts
 * (ExcelJS writes no charts), and PivotTableDetail is the flat table with
 * filters, not a ready-made pivot table.
 *
 * Spend cells hold real dollars, shown in thousands by the number format
 * (#,##0,), so a sum or a pivot built on them is exact.
 *
 * MEMORY (17 November 2026): the first version built each workbook whole in
 * memory, and a download for a big category ran the site's Node process out
 * of heap (B1 plan, about 1 GB) and took the site down. Workbooks are now
 * written with ExcelJS's streaming writer straight to the response: a big
 * table's rows are committed (flushed) as they are written, so memory holds
 * the rows read from ClickHouse, not the spreadsheet. The route also builds
 * one workbook at a time.
 */
import type { Writable } from 'node:stream'
import ExcelJS from 'exceljs'
import * as data from './data'
import {
  addDays, dayLabel, LEVEL_SQL, shiftYm, mediaMatrix, monthLabel, monthTotals, rank, shifts, sumBy, type CubeRow, type Level, type Ranked, type TaxNode, type Who,
} from './rules'

const FONT = 'Verdana'
const NAVY = 'FF1F3864'
const SUB = 'FFDCE6F1'
const BAR = 'FF2A78D6'
const ROW_CAP = 100_000
const LINK_CAP = 60_000
/** A table longer than this is flushed row by row; shorter ones (the dashboards) stay editable until the sheet is done. */
const FLUSH_FROM = 300

type Fmt = 'usd' | 'pct' | 'int' | 'pts' | 'text' | 'date'
interface Col {
  h: string
  w?: number
  f?: Fmt
}
type Cell = string | number | null | { text: string; hyperlink: string }
type Kind = 'sub' | 'total' | 'me' | undefined

const NUMFMT: Record<Fmt, string | undefined> = { usd: '#,##0,', pct: '0%', int: '#,##0', pts: '+0.0;-0.0;0.0', text: undefined, date: 'yyyy-mm-dd' }

export interface ReportInput {
  node: TaxNode
  trail: TaxNode[]
  scope: data.Scope
  who: Who
  focusName: string | null
  /** The site's address, for links to the ads. */
  appUrl: string
}

class Book {
  wb: ExcelJS.stream.xlsx.WorkbookWriter
  private current: ExcelJS.Worksheet | null = null
  constructor(
    private kind: string,
    private input: ReportInput,
    private periodText: string,
    stream: Writable,
  ) {
    this.wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false })
    this.wb.creator = 'MR Portfolio Control · Magnifier Offline Reports (prototype)'
    this.wb.created = new Date()
  }

  /** A sheet with the report header, as the samples have it. Returns the first free row. */
  sheet(name: string, title: string, note = 'Dollars shown in thousands'): { ws: ExcelJS.Worksheet; row: number } {
    // The streaming writer writes one sheet at a time: finish the last one first.
    this.current?.commit()
    const ws = this.wb.addWorksheet(name, { views: [{ showGridLines: false }] })
    this.current = ws
    const put = (r: number, v: string, size: number, bold = false) => {
      const c = ws.getCell(r, 1)
      c.value = v
      c.font = { name: FONT, size, bold }
    }
    put(1, this.kind, 12)
    put(2, `${this.input.node.name}${this.input.focusName ? ` · ${this.input.focusName}` : ''}`, 16)
    put(3, this.periodText, 12)
    if (note) put(4, note, 10)
    put(6, title, 16)
    return { ws, row: 8 }
  }

  /** A table: navy header row, then rows; `kinds` marks subtotal and total rows. Returns the next free row. */
  async table(ws: ExcelJS.Worksheet, at: number, cols: Col[], rows: Cell[][], opts: { kinds?: Kind[]; filter?: boolean; freeze?: boolean; bars?: number[] } = {}): Promise<number> {
    cols.forEach((c, i) => {
      const col = ws.getColumn(i + 1)
      const want = c.w ?? (c.f === 'text' || !c.f ? 22 : 13)
      if (!col.width || col.width < want) col.width = want
    })
    const head = ws.getRow(at)
    cols.forEach((c, i) => {
      const cell = head.getCell(i + 1)
      cell.value = c.h
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
      cell.alignment = { vertical: 'middle', horizontal: c.f && c.f !== 'text' && c.f !== 'date' ? 'right' : 'left', wrapText: true }
    })
    head.height = 26
    // Frozen panes go out with the sheet's first flushed row, so they are set before any row is written.
    if (opts.freeze) ws.views.splice(0, ws.views.length, { state: 'frozen', ySplit: at, showGridLines: false })
    const flush = rows.length > FLUSH_FROM
    // Excel refuses to open a sheet with more than 65,530 hyperlinks; past the cap an ad code is plain text.
    let links = 0
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri]
      // Let the server answer other requests, and the file flow out, while a long table is written.
      if (ri && ri % 1000 === 0) await new Promise((done) => setImmediate(done))
      const row = ws.getRow(at + 1 + ri)
      const kind = opts.kinds?.[ri]
      r.forEach((v0, ci) => {
        const v = typeof v0 === 'object' && v0 !== null && ++links > LINK_CAP ? v0.text : v0
        const cell = row.getCell(ci + 1)
        cell.value = v as ExcelJS.CellValue
        const f = cols[ci]?.f
        if (f && NUMFMT[f]) cell.numFmt = NUMFMT[f]!
        const link = typeof v === 'object' && v !== null
        cell.font = { name: FONT, size: 10, bold: kind === 'sub' || kind === 'total', color: link ? { argb: 'FF0563C1' } : undefined, underline: link ? true : undefined }
        if (kind === 'sub' || kind === 'me') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUB } }
        if (kind === 'total') cell.border = { top: { style: 'thin' } }
      })
      if (flush) row.commit()
    }
    const end = at + rows.length
    if (opts.filter && rows.length) ws.autoFilter = { from: { row: at, column: 1 }, to: { row: end, column: cols.length } }
    for (const ci of opts.bars ?? []) {
      if (!rows.length) continue
      const letter = ws.getColumn(ci + 1).letter
      ws.addConditionalFormatting({
        ref: `${letter}${at + 1}:${letter}${end}`,
        rules: [{ type: 'dataBar', priority: 1, gradient: false, color: { argb: BAR }, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }] } as unknown as ExcelJS.ConditionalFormattingRule],
      })
    }
    return end + 2
  }

  /** A small heading over a block on a dashboard sheet. */
  heading(ws: ExcelJS.Worksheet, at: number, text: string): number {
    const c = ws.getCell(at, 1)
    c.value = text
    c.font = { name: FONT, size: 12, bold: true }
    return at + 1
  }

  notes(params: Array<[string, string]>, tables: Array<[string, string]>) {
    const { ws } = this.sheet('Notes', 'Report notes', '')
    ws.getColumn(1).width = 28
    ws.getColumn(2).width = 90
    let r = 8
    const line = (a: string, b: string, bold = false) => {
      ws.getCell(r, 1).value = a
      ws.getCell(r, 2).value = b
      ws.getCell(r, 1).font = { name: FONT, size: 10, bold: true }
      ws.getCell(r, 2).font = { name: FONT, size: 10, bold }
      ws.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' }
      r++
    }
    line('Report run date:', new Date().toISOString().slice(0, 10))
    line('Report type:', this.kind)
    line('Category:', this.input.trail.map((t) => t.name).join(' › '))
    line('Level:', this.input.node.level)
    for (const [a, b] of params) line(a, b)
    r++
    ws.getCell(r++, 1).value = 'Tables in this report'
    for (const [a, b] of tables) line(a, b)
    r++
    line('About the data:', 'GPC taxonomy, production data (Prod ClickHouse, GPC serving model). Spend is the spend model\'s share for the paying advertiser and product. Promotional and public service announcements are left out. Every media is covered from August 2026; earlier months are not shown.')
    line('', '© 2026 MediaRadar, Inc. and affiliates. Prototype; figures on development data can change.')
  }

  /** Finish the last sheet and the file; the stream ends when this resolves. */
  async done(): Promise<void> {
    this.current?.commit()
    await this.wb.commit()
  }
}

const whoLabel = (who: Who) => (who === 'parent' ? 'Parent company' : 'Advertiser')
const share = (v: number, t: number) => (t ? v / t : 0)
/** The last day of a month, as 2026-10-31. */
const monthEnd = (ym: number) => addDays(`${String(shiftYm(ym, 1)).slice(0, 4)}-${String(shiftYm(ym, 1)).slice(4)}-01`, -1)
const weekNum = (w: string) => Number(w.replaceAll('-', ''))
const weekIso = (n: number) => `${String(n).slice(0, 4)}-${String(n).slice(4, 6)}-${String(n).slice(6)}`
const fullDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit', timeZone: 'UTC' })
const adLink = (app: string, id: string): Cell => ({ text: id, hyperlink: `${app}/taxonomy-comparison/creative/${id}?type=creative` })
const mediaParam = (s: data.Scope) => s.media ?? 'All media'

/** Advertiser x media blocks: spending, mix (row %) and share of voice (column %). */
async function mediaSheets(book: Book, rows: CubeRow[], who: Who) {
  const mm = mediaMatrix(rows, null, who)
  const people = mm.people.slice(0, 1000)
  const total = mm.media.reduce((a, m) => a + m.spend, 0)
  const cols: Col[] = [{ h: whoLabel(who), w: 40, f: 'text' }, ...mm.media.map((m) => ({ h: m.key, f: 'usd' as Fmt })), { h: 'Total', f: 'usd' }]
  const pc: Col[] = cols.map((c, i) => (i ? { ...c, f: 'pct' as Fmt } : c))
  const tKinds = (n: number): Kind[] => [...Array(n).fill(undefined), 'total']

  let { ws, row } = book.sheet('MediaType', 'Spending by Media Type')
  await book.table(ws, row, cols, [...people.map((p) => [p.name, ...mm.media.map((m) => mm.at(p.key, m.key)), p.spend]), ['Grand Total', ...mm.media.map((m) => m.spend), total]], { kinds: tKinds(people.length), freeze: true })
  ;({ ws, row } = book.sheet('MediaMix', 'Percent Media Mix', "Each advertiser's media mix; each row adds to 100%"))
  await book.table(ws, row, pc, [...people.map((p) => [p.name, ...mm.media.map((m) => share(mm.at(p.key, m.key), p.spend)), 1]), ['Grand Total', ...mm.media.map((m) => share(m.spend, total)), 1]], { kinds: tKinds(people.length), freeze: true })
  ;({ ws, row } = book.sheet('MediaSOV', 'Share of Voice by Media', "Each advertiser's share of each media; each column adds to 100%"))
  await book.table(ws, row, pc, [...people.map((p) => [p.name, ...mm.media.map((m) => share(mm.at(p.key, m.key), m.spend)), share(p.spend, total)]), ['Grand Total', ...mm.media.map(() => 1), 1]], { kinds: tKinds(people.length), freeze: true })
}

/** Product rows grouped by advertiser with a total under each, and a grand total (Product|Campaign, SpendingTrend, ...). */
function productBlock(list: data.ProductRow[], periods: number[], lead: (p: data.ProductRow) => Cell[], leadTotal: (name: string) => Cell[], withTotalFirst = false) {
  const out: Cell[][] = []
  const kinds: Kind[] = []
  const val = (r: data.ProductRow, p: number) => r.byMonth[p] ?? 0
  let i = 0
  while (i < list.length) {
    const aid = list[i].aid
    const group: data.ProductRow[] = []
    while (i < list.length && list[i].aid === aid) group.push(list[i++])
    for (const r of group) {
      out.push([...lead(r), ...(withTotalFirst ? [r.total] : []), ...periods.map((p) => val(r, p)), ...(withTotalFirst ? [] : [r.total])])
      kinds.push(undefined)
    }
    const sum = (p: number) => group.reduce((a, r) => a + val(r, p), 0)
    const tot = group.reduce((a, r) => a + r.total, 0)
    out.push([...leadTotal(`${group[0].advertiser} Total`), ...(withTotalFirst ? [tot] : []), ...periods.map(sum), ...(withTotalFirst ? [] : [tot])])
    kinds.push('sub')
  }
  const gsum = (p: number) => list.reduce((a, r) => a + val(r, p), 0)
  const gt = list.reduce((a, r) => a + r.total, 0)
  out.push([...leadTotal('Grand Total'), ...(withTotalFirst ? [gt] : []), ...periods.map(gsum), ...(withTotalFirst ? [] : [gt])])
  kinds.push('total')
  return { rows: out, kinds }
}

function creativeRows(list: data.CreativeRow[], app: string, newFrom: string) {
  return list.map((a) => [
    a.advertiser, adLink(app, a.id), a.firstSeen && a.firstSeen >= newFrom ? 'New' : 'Carryover', [a.format || a.type, a.length ? `${a.length}` : ''].filter(Boolean).join(' / '),
    a.media.join(', '), a.subcategory, a.product, a.firstSeen, a.spend, a.occ, a.title, a.lead,
  ])
}
const CREATIVE_COLS: Col[] = [
  { h: 'Advertiser', w: 34, f: 'text' }, { h: 'Ad Code', w: 14, f: 'text' }, { h: 'New/Carryover', w: 13, f: 'text' }, { h: 'Format/Length', w: 20, f: 'text' },
  { h: 'Media', w: 26, f: 'text' }, { h: 'Subcategory', w: 26, f: 'text' }, { h: 'Product/Campaign', w: 34, f: 'text' }, { h: 'First Run Date', w: 13, f: 'text' },
  { h: 'Ad Spend', f: 'usd' }, { h: 'Occ.Count', f: 'int' }, { h: 'Title', w: 40, f: 'text' }, { h: 'Lead', w: 60, f: 'text' },
]

async function pivotDetail(book: Book, det: { rows: data.DetailRow[]; more: boolean }, weekly: boolean) {
  const { ws, row } = book.sheet('PivotTableDetail', 'Pivot Table Detail', det.more ? `The first ${ROW_CAP.toLocaleString('en-US')} rows · dollars shown in thousands` : 'Dollars shown in thousands · filter or pivot from this table')
  const cols: Col[] = [
    { h: 'Advertiser', w: 34, f: 'text' }, { h: 'Parent', w: 28, f: 'text' }, { h: 'Category', w: 26, f: 'text' }, { h: 'Subcategory', w: 26, f: 'text' }, { h: 'Product/Campaign', w: 34, f: 'text' },
    { h: 'Media Type', w: 18, f: 'text' }, { h: 'Market', w: 18, f: 'text' }, { h: 'MediaOutlet', w: 28, f: 'text' },
    ...(weekly ? [{ h: 'Week of', w: 12, f: 'text' as Fmt }] : []), { h: 'Month', w: 8, f: 'text' }, { h: 'Quarter', w: 8, f: 'text' }, { h: 'Year', w: 8, f: 'int' }, { h: 'AdSpend', f: 'usd' }, { h: 'Occ.Count', f: 'int' },
  ]
  await book.table(
    ws,
    row,
    cols,
    det.rows.map((d) => {
      const iso = weekly ? weekIso(d.period) : `${String(d.period).slice(0, 4)}-${String(d.period).slice(4)}-01`
      const ym = Number(iso.slice(0, 7).replace('-', ''))
      return [d.advertiser, d.parent, d.category, d.subcategory, d.product, d.media, d.market, d.outlet, ...(weekly ? [iso] : []), monthLabel(ym, true), `Q${Math.ceil((ym % 100) / 3)}`, Math.floor(ym / 100), d.spend, d.occ]
    }),
    { filter: true, freeze: true },
  )
}

/** Market position against the leader, as the dashboards open (rank, SOV, dollars, gap). */
async function positionBlock(book: Book, ws: ExcelJS.Worksheet, at: number, title: string, ranked: Ranked[], focus: Ranked | null): Promise<number> {
  at = book.heading(ws, at, title)
  const leader = ranked[0]
  const cols: Col[] = [{ h: '', w: 34, f: 'text' }, { h: leader?.name ?? 'Leader', w: 30, f: 'text' }]
  if (focus) cols.push({ h: focus.name, w: 30, f: 'text' }, { h: 'Gap', w: 18, f: 'text' })
  const usd = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v / 1000)).toLocaleString('en-US')}K`
  const rows: Cell[][] = [
    ['Rank', '1', ...(focus ? [focus.rank ? String(focus.rank) : '—', focus.rank ? String(1 - focus.rank) : '—'] : [])],
    ['SOV', `${((leader?.sov ?? 0) * 100).toFixed(0)}%`, ...(focus ? [`${(focus.sov * 100).toFixed(0)}%`, `${((focus.sov - leader.sov) * 100).toFixed(0)} Points`] : [])],
    ['Dollars ($000s)', usd(leader?.spend ?? 0), ...(focus ? [usd(focus.spend), usd(focus.spend - leader.spend)] : [])],
  ]
  return await book.table(ws, at, cols, rows)
}

// ================================================================== Summary Report

export async function summaryReport(input: ReportInput, window: number[], ym: number, out: Writable): Promise<void> {
  // Every sheet covers the whole market; the focus advertiser is only highlighted, as in today's reports.
  const market = { ...input.scope, adv: null }
  const s = market
  const first = window[0]
  const startIso = `${String(first).slice(0, 4)}-${String(first).slice(4)}-01`
  const periodText = `${fullDate(startIso)} - ${fullDate(monthEnd(ym))}`
  const [rows, prods, prodsByMedia, ads, det] = await Promise.all([
    data.cube(s, window),
    data.products(market, { months: window }, false, 5000),
    data.products(market, { months: window }, true, 10000),
    data.creatives(market, { months: window }, 1000),
    data.detail(market, { months: window }, ROW_CAP),
  ])
  const who = input.who
  const ranked = rank(rows, ym, window, who)
  const totals = monthTotals(rows, window)
  const prior = window.length > 1 ? window.at(-2)! : null
  const focus = input.scope.adv ? ranked.find((r) => r.key === input.scope.adv) ?? null : null
  const book = new Book('Competitive Spending Summary Report', input, periodText, out)

  // Dashboard
  {
    const { ws, row } = book.sheet('Dashboard', `${monthLabel(ym)} Ad Spending: ${input.focusName ?? input.node.name}`, `Period: ${monthLabel(ym)} · dollars in thousands unless noted`)
    let r = await positionBlock(book, ws, row, `${focus ? `${focus.name} vs. ` : ''}${monthLabel(ym)} Market Leader`, ranked.filter((x) => x.spend > 0), focus)
    r = book.heading(ws, r, 'Total Market Spending Trend')
    r = await book.table(ws, r, [{ h: 'Month', w: 34, f: 'text' }, { h: 'Spending', f: 'usd' }, { h: 'Change', f: 'pct' }], window.map((m, i) => [monthLabel(m), totals[i], i ? share(totals[i] - totals[i - 1], totals[i - 1]) : null]), { bars: [1] })
    if (prior) {
      r = book.heading(ws, r, `${monthLabel(prior, true)} to ${monthLabel(ym, true)} Spending Shifts`)
      r = await book.table(ws, r, [{ h: 'Advertiser', w: 34, f: 'text' }, { h: monthLabel(prior, true), f: 'usd' }, { h: monthLabel(ym, true), f: 'usd' }, { h: 'Change', f: 'usd' }, { h: '% Change', f: 'pct' }], shifts(ranked, 10).map((x) => [x.name, x.prior, x.spend, x.spend - x.prior, x.delta]), { bars: [3] })
    }
    r = book.heading(ws, r, `${monthLabel(ym)} Advertiser Rankings`)
    r = await book.table(
      ws, r,
      [{ h: whoLabel(who), w: 34, f: 'text' }, { h: 'Rank', f: 'int', w: 8 }, { h: 'Spending', f: 'usd' }, { h: 'SOV', f: 'pct' }, { h: 'Prior SOV', f: 'pct' }, { h: '% Change', f: 'pct' }],
      ranked.filter((x) => x.spend > 0).slice(0, 15).map((x) => [x.name, x.rank, x.spend, x.sov, x.priorSov, x.delta]),
      { bars: [2], kinds: ranked.filter((x) => x.spend > 0).slice(0, 15).map((x) => (x.key === focus?.key ? 'me' : undefined)) },
    )
    const mm = mediaMatrix(rows, ym, who)
    const mt = mm.media.reduce((a, m) => a + m.spend, 0)
    r = book.heading(ws, r, `${monthLabel(ym)} Media Allocation: Total Market`)
    r = await book.table(ws, r, [{ h: 'Media', w: 34, f: 'text' }, { h: 'Spending', f: 'usd' }, { h: 'Share', f: 'pct' }], mm.media.map((m) => [m.key, m.spend, share(m.spend, mt)]), { bars: [1] })
    const kids = sumBy(rows, (x) => x.cid, (x) => x.cname, (x) => x.ym === ym).filter((k) => k.spend > 0)
    r = book.heading(ws, r, `${monthLabel(ym)} ${LEVEL_SQL[input.node.level as Level].child.label} Allocation: Total Market`)
    r = await book.table(ws, r, [{ h: LEVEL_SQL[input.node.level as Level].child.label, w: 34, f: 'text' }, { h: 'Spending', f: 'usd' }, { h: 'Share', f: 'pct' }], kids.slice(0, 25).map((k) => [k.name, k.spend, share(k.spend, totals.at(-1) ?? 0)]), { bars: [1] })
    const monthAds = await data.creatives(market, { months: [ym] }, 120)
    const seen = new Set<number>()
    const top = monthAds.filter((a) => (seen.has(a.aid) || seen.size >= 8 ? false : (seen.add(a.aid), true)))
    r = book.heading(ws, r, 'Creative Messaging Highlights for the Month: most heavily run message')
    await book.table(
      ws, r,
      [{ h: 'Advertiser', w: 34, f: 'text' }, { h: 'Ad Code', w: 14, f: 'text' }, { h: 'Media', w: 26, f: 'text' }, { h: 'Title', w: 40, f: 'text' }, { h: 'Lead', w: 60, f: 'text' }, { h: 'Spend', f: 'usd' }, { h: '% of Advertiser', f: 'pct' }, { h: 'New This Month', w: 14, f: 'text' }],
      // A plain ad code here: the streaming writer puts links ahead of the data bars on this sheet, an
      // order Excel refuses to open (17 November 2026). The Creatives sheet links every ad.
      top.map((a) => [a.advertiser, a.id, a.media.join(', '), a.title, a.lead, a.spend, share(a.spend, a.advTotal), a.firstSeen && a.firstSeen >= `${String(ym).slice(0, 4)}-${String(ym).slice(4)}-01` ? 'New' : '']),
    )
  }

  // Summary
  {
    const { ws, row } = book.sheet('Summary', 'Spending Summary with Share of Voice')
    const tm = monthLabel(ym, true), pm = prior ? monthLabel(prior, true) : 'Prior'
    const cols: Col[] = [{ h: whoLabel(who), w: 40, f: 'text' }, { h: `${monthLabel(first, true)}–${tm} Total`, f: 'usd' }, { h: tm, f: 'usd' }, { h: pm, f: 'usd' }, { h: '% Change', f: 'pct' }, { h: `SOV ${tm}`, f: 'pct' }, { h: `SOV ${pm}`, f: 'pct' }, { h: 'Change (pts)', f: 'pts' }]
    const list = ranked.slice(0, 2000)
    const t = totals.at(-1) ?? 0, pt = prior ? totals.at(-2)! : 0
    await book.table(ws, row, cols, [
      ...list.map((x) => [x.name, x.trend.reduce((a, b) => a + b, 0), x.spend, x.prior, x.delta, x.sov, x.priorSov, (x.sov - x.priorSov) * 100]),
      ['Grand Total', totals.reduce((a, b) => a + b, 0), t, pt, pt ? t / pt - 1 : null, 1, 1, 0],
    ], { kinds: [...list.map((x) => (x.key === focus?.key ? 'me' as Kind : undefined)), 'total'], freeze: true })
  }

  // Product|Campaign
  {
    const { ws, row } = book.sheet('Product|Campaign', 'Monthly Spending Trend by Product/Campaign')
    const b = productBlock(prods, window, (p) => [p.advertiser, p.category, p.subcategory, p.product], (n) => [n, '', '', ''])
    await book.table(ws, row, [{ h: 'Advertiser', w: 34, f: 'text' }, { h: 'Category', w: 24, f: 'text' }, { h: 'Subcategory', w: 26, f: 'text' }, { h: 'Product/Campaign', w: 36, f: 'text' }, ...window.map((m) => ({ h: monthLabel(m, true), f: 'usd' as Fmt })), { h: 'Total', f: 'usd' }], b.rows, { kinds: b.kinds, freeze: true })
  }

  await mediaSheets(book, rows, who)

  // Product|Media|Trend
  {
    const { ws, row } = book.sheet('Product|Media|Trend', 'Monthly Trend by Product and Media Type')
    const b = productBlock(prodsByMedia, window, (p) => [p.advertiser, p.category, p.subcategory, p.product, p.media], (n) => [n, '', '', '', ''])
    await book.table(ws, row, [{ h: 'Advertiser', w: 34, f: 'text' }, { h: 'Category', w: 24, f: 'text' }, { h: 'Subcategory', w: 26, f: 'text' }, { h: 'Product/Campaign', w: 36, f: 'text' }, { h: 'Media', w: 20, f: 'text' }, ...window.map((m) => ({ h: monthLabel(m, true), f: 'usd' as Fmt })), { h: 'Total', f: 'usd' }], b.rows, { kinds: b.kinds, freeze: true })
  }

  // Creatives
  {
    const { ws, row } = book.sheet('Creatives', 'Creative List With Ad Spend and Occurrences', 'Initially sorted by ad spend · click an Ad Code to see the ad · dollars shown in thousands')
    await book.table(ws, row, CREATIVE_COLS, creativeRows(ads, input.appUrl, startIso), { filter: true, freeze: true })
  }

  // AdvertiserQuickPivot
  {
    const { ws, row } = book.sheet('AdvertiserQuickPivot', 'Sum of AdSpend by Advertiser and Month')
    const list = ranked.slice(0, 2000).sort((a, b) => a.name.localeCompare(b.name))
    await book.table(ws, row, [{ h: whoLabel(who), w: 40, f: 'text' }, ...window.map((m) => ({ h: monthLabel(m, true), f: 'usd' as Fmt })), { h: 'Grand Total', f: 'usd' }], [
      ...list.map((x) => [x.name, ...x.trend, x.trend.reduce((a, b) => a + b, 0)]),
      ['Grand Total', ...totals, totals.reduce((a, b) => a + b, 0)],
    ], { kinds: [...list.map(() => undefined), 'total'], freeze: true })
  }

  await pivotDetail(book, det, false)

  book.notes(
    [['Media:', mediaParam(input.scope)], ['Period:', periodText], ['Report month:', monthLabel(ym)], ['Advertiser level:', whoLabel(who)], ...(input.focusName ? [['Focus advertiser:', input.focusName] as [string, string]] : [])],
    [
      ['Dashboard', 'The month at a glance: market position, trend, shifts, rankings, media and category allocation, creative highlights'],
      ['Summary', 'Spending for the period and the month, with share of voice against the prior month'],
      ['Product|Campaign', 'Spending trend by product'],
      ['MediaType', 'Spending by advertiser and media type'],
      ['MediaMix', "Percent of an advertiser's budget spent in each media"],
      ['MediaSOV', 'Advertiser share of voice within each media'],
      ['Product|Media|Trend', 'Monthly spending at the product level, by media'],
      ['Creatives', 'Creatives in the report, with spend and occurrences; the Ad Code opens the ad'],
      ['AdvertiserQuickPivot', 'Advertiser totals by month'],
      ['PivotTableDetail', 'The table the pivots are built from'],
    ],
  )
  return book.done()
}

// ================================================================== Occurrence Table

export async function occurrenceTable(input: ReportInput, week: string, out: Writable): Promise<void> {
  const end = addDays(week, 6)
  const market = { ...input.scope, adv: null }
  const { rows, more } = await data.occurrences(market, week, end, ROW_CAP)
  const periodText = `${fullDate(week)} - ${fullDate(end)}`
  const book = new Book('Occurrence Table', input, periodText, out)
  const { ws, row } = book.sheet('Occurrences', 'Occurrence List', more ? `The latest ${ROW_CAP.toLocaleString('en-US')} rows · dollars shown in thousands` : 'Run pivot tables from this list for further analysis · dollars shown in thousands')
  await book.table(
    ws, row,
    [
      { h: 'Advertiser', w: 34, f: 'text' }, { h: 'Ad Code', w: 14, f: 'text' }, { h: 'Media Type', w: 18, f: 'text' }, { h: 'Title', w: 40, f: 'text' }, { h: 'Subcategory', w: 26, f: 'text' },
      { h: 'Product/Campaign', w: 34, f: 'text' }, { h: 'Market', w: 18, f: 'text' }, { h: 'RunDate', w: 12, f: 'text' }, { h: 'MediaOutlet', w: 28, f: 'text' }, { h: 'AdSpend', f: 'usd' }, { h: '1stRunDate', w: 12, f: 'text' }, { h: 'Occ.Count', f: 'int' },
    ],
    rows.map((o) => [o.advertiser, adLink(input.appUrl, o.creative), o.media, o.title, o.subcategory, o.product, o.market, o.date, o.outlet, o.spend, o.firstSeen, o.occ]),
    { filter: true, freeze: true },
  )
  book.notes([['Media:', mediaParam(input.scope)], ['Period:', periodText], ['Rows:', `${rows.length.toLocaleString('en-US')}${more ? ' (capped)' : ''}`]], [['Occurrences', 'One row per ad, outlet, market and run date, with spend']])
  return book.done()
}

// ================================================================== Weekly FastTrack

export async function fastTrack(input: ReportInput, weeks: string[], week: string, out: Writable): Promise<void> {
  const upto = weeks.filter((w) => w <= week)
  const prevW = upto.length > 1 ? upto.at(-2)! : null
  const start = upto[0]
  const end = addDays(week, 6)
  const nums = upto.map(weekNum)
  // Every sheet covers the whole market; the focus advertiser is only highlighted, as in today's reports.
  const market = { ...input.scope, adv: null }
  const s = market
  const [rows, glance, trend, usage, outlets, ads, occ, det] = await Promise.all([
    data.weekCube(s, start, week),
    data.products(market, { from: prevW ?? week, to: end }, false, 5000),
    data.products(market, { from: start, to: end }, false, 5000),
    data.products(market, { from: week, to: end }, true, 5000),
    data.outlets(market, { from: week, to: end }, 1000),
    data.creatives(market, { from: start, to: end }, 1000),
    data.occurrences(market, week, end, ROW_CAP),
    data.detail(market, { from: start, to: end }, ROW_CAP),
  ])
  const who = input.who
  const ranked = rank(rows, weekNum(week), nums, who, prevW ? weekNum(prevW) : 0)
  const totals = monthTotals(rows, nums)
  const t = totals.at(-1) ?? 0, pt = prevW ? totals.at(-2)! : 0
  const focus = input.scope.adv ? ranked.find((r) => r.key === input.scope.adv) ?? null : null
  const periodText = `${fullDate(start)} - ${fullDate(end)}`
  const weekText = `${fullDate(week)} - ${fullDate(end)}`
  const book = new Book('MediaRadar Weekly FastTrack Report', input, periodText, out)

  // Dashboard
  {
    const { ws, row } = book.sheet('Dashboard', `Weekly FastTrack: ${input.focusName ?? input.node.name}`, `Week Ending: ${fullDate(end)} · all dollars in thousands`)
    let r = await positionBlock(book, ws, row, 'Current Week Spending vs. Leader', ranked.filter((x) => x.spend > 0), focus)
    const ptd = ranked.map((x) => ({ ...x, spend: x.trend.reduce((a, b) => a + b, 0) })).sort((a, b) => b.spend - a.spend)
    const ptdTotal = ptd.reduce((a, x) => a + x.spend, 0)
    ptd.forEach((x, i) => { x.rank = i + 1; x.sov = share(x.spend, ptdTotal) })
    r = await positionBlock(book, ws, r, `Period-to-Date Spending vs. Leader (since ${fullDate(start)})`, ptd, focus ? ptd.find((x) => x.key === focus.key) ?? null : null)
    r = book.heading(ws, r, 'Total Market Spending Trend')
    r = await book.table(ws, r, [{ h: 'Week of', w: 34, f: 'text' }, { h: 'Spending', f: 'usd' }, { h: 'Change', f: 'pct' }], upto.map((w, i) => [dayLabel(w), totals[i], i ? share(totals[i] - totals[i - 1], totals[i - 1]) : null]), { bars: [1] })
    if (prevW) {
      r = book.heading(ws, r, 'Week to Week Spending Shifts')
      r = await book.table(ws, r, [{ h: 'Advertiser', w: 34, f: 'text' }, { h: 'Last Week', f: 'usd' }, { h: 'This Week', f: 'usd' }, { h: 'Change', f: 'usd' }, { h: '% Change', f: 'pct' }], shifts(ranked, 10).map((x) => [x.name, x.prior, x.spend, x.spend - x.prior, x.delta]), { bars: [3] })
    }
    r = book.heading(ws, r, 'Weekly Advertiser Rankings')
    await book.table(ws, r, [{ h: whoLabel(who), w: 34, f: 'text' }, { h: 'Rank', f: 'int', w: 8 }, { h: 'This Week', f: 'usd' }, { h: 'SOV', f: 'pct' }, { h: '% Change', f: 'pct' }], ranked.filter((x) => x.spend > 0).slice(0, 15).map((x) => [x.name, x.rank, x.spend, x.sov, x.delta]), { bars: [2] })
  }

  // WeekAtAGlance
  {
    const { ws, row } = book.sheet('WeekAtAGlance', 'Week at a Glance', `${weekText} · dollars shown in thousands`)
    const tw = weekNum(week), pw = prevW ? weekNum(prevW) : -1
    const out: Cell[][] = []
    const kinds: Kind[] = []
    const line = (lead: Cell[], a: number, b: number, kind: Kind) => {
      out.push([...lead, a, b, a - b, b ? a / b - 1 : null, share(a, t), share(b, pt)])
      kinds.push(kind)
    }
    let i = 0
    const list = glance
    while (i < list.length) {
      const aid = list[i].aid
      const g: data.ProductRow[] = []
      while (i < list.length && list[i].aid === aid) g.push(list[i++])
      for (const p of g) line([p.advertiser, p.category, p.subcategory, p.product], p.byMonth[tw] ?? 0, p.byMonth[pw] ?? 0, undefined)
      line([`${g[0].advertiser} Total`, '', '', ''], g.reduce((a, p) => a + (p.byMonth[tw] ?? 0), 0), g.reduce((a, p) => a + (p.byMonth[pw] ?? 0), 0), 'sub')
    }
    line(['Grand Total', '', '', ''], t, pt, 'total')
    await book.table(ws, row, [
      { h: 'Advertiser', w: 34, f: 'text' }, { h: 'Category', w: 24, f: 'text' }, { h: 'Subcategory', w: 26, f: 'text' }, { h: 'Product/Campaign', w: 36, f: 'text' },
      { h: 'This Week', f: 'usd' }, { h: 'Prev Week', f: 'usd' }, { h: '$ Change', f: 'usd' }, { h: '% Change', f: 'pct' }, { h: 'SOV This Week', f: 'pct' }, { h: 'SOV Prev Week', f: 'pct' },
    ], out, { kinds, freeze: true })
  }

  // SpendingTrend
  {
    const { ws, row } = book.sheet('SpendingTrend', 'Weekly Spending Trend', `${periodText} · dollars shown in thousands`)
    const b = productBlock(trend, nums, (p) => [p.advertiser, p.category, p.subcategory, p.product], (n) => [n, '', '', ''], true)
    await book.table(ws, row, [{ h: 'Advertiser', w: 34, f: 'text' }, { h: 'Category', w: 24, f: 'text' }, { h: 'Subcategory', w: 26, f: 'text' }, { h: 'Product/Campaign', w: 36, f: 'text' }, { h: 'PTD Total', f: 'usd' }, ...upto.map((w, i) => ({ h: `Wk ${i + 1} (${dayLabel(w)})`, f: 'usd' as Fmt }))], b.rows, { kinds: b.kinds, freeze: true })
  }

  // WeeklyMediaUsage: product x media this week.
  {
    const { ws, row } = book.sheet('WeeklyMediaUsage', 'Current Week Spending by Media Type', `${weekText} · dollars shown in thousands`)
    const media = [...new Set(usage.map((p) => p.media))].sort()
    const byProd = new Map<string, { adv: string; aid: number; product: string; m: Record<string, number>; total: number }>()
    for (const p of usage) {
      const k = `${p.aid}|${p.pid}`
      const e = byProd.get(k) ?? { adv: p.advertiser, aid: p.aid, product: p.product, m: {}, total: 0 }
      e.m[p.media] = (e.m[p.media] ?? 0) + p.total
      e.total += p.total
      byProd.set(k, e)
    }
    const list = [...byProd.values()]
    const out: Cell[][] = []
    const kinds: Kind[] = []
    let i = 0
    while (i < list.length) {
      const aid = list[i].aid
      const g: typeof list = []
      while (i < list.length && list[i].aid === aid) g.push(list[i++])
      for (const p of g) { out.push([p.adv, p.product, ...media.map((m) => p.m[m] ?? 0), p.total]); kinds.push(undefined) }
      out.push([`${g[0].adv} Total`, '', ...media.map((m) => g.reduce((a, p) => a + (p.m[m] ?? 0), 0)), g.reduce((a, p) => a + p.total, 0)]); kinds.push('sub')
    }
    out.push(['Grand Total', '', ...media.map((m) => list.reduce((a, p) => a + (p.m[m] ?? 0), 0)), list.reduce((a, p) => a + p.total, 0)]); kinds.push('total')
    await book.table(ws, row, [{ h: 'Advertiser', w: 34, f: 'text' }, { h: 'Product/Campaign', w: 36, f: 'text' }, ...media.map((m) => ({ h: m, f: 'usd' as Fmt })), { h: 'Total', f: 'usd' }], out, { kinds, freeze: true })
  }

  // MediaTrendSummary: advertiser x media x week.
  {
    const { ws, row } = book.sheet('MediaTrendSummary', 'Weekly Media Trend Spending Summary', `${periodText} · dollars shown in thousands`)
    const key = (r: CubeRow) => (who === 'parent' ? r.pid : r.aid)
    const cell = new Map<string, number[]>()
    for (const r of rows) {
      const k = `${key(r)}|${r.media}`
      const v = cell.get(k) ?? nums.map(() => 0)
      const i = nums.indexOf(r.ym)
      if (i >= 0) v[i] += r.spend
      cell.set(k, v)
    }
    const out: Cell[][] = []
    const kinds: Kind[] = []
    for (const p of ranked.slice(0, 300).sort((a, b) => a.name.localeCompare(b.name))) {
      const medias = [...cell.keys()].filter((k) => k.startsWith(`${p.key}|`)).map((k) => k.slice(String(p.key).length + 1)).sort()
      for (const m of medias) {
        const v = cell.get(`${p.key}|${m}`)!
        out.push([p.name, m, v.reduce((a, b) => a + b, 0), ...v]); kinds.push(undefined)
      }
      out.push([`${p.name} Total`, '', p.trend.reduce((a, b) => a + b, 0), ...p.trend]); kinds.push('sub')
    }
    out.push(['Grand Total', '', totals.reduce((a, b) => a + b, 0), ...totals]); kinds.push('total')
    await book.table(ws, row, [{ h: whoLabel(who), w: 34, f: 'text' }, { h: 'MediaType', w: 22, f: 'text' }, { h: 'PTD Total', f: 'usd' }, ...upto.map((w, i) => ({ h: `Wk ${i + 1} (${dayLabel(w)})`, f: 'usd' as Fmt }))], out, { kinds, freeze: true })
  }

  // MediaOutlet: this week, outlets x the week's top advertisers.
  {
    const { ws, row } = book.sheet('MediaOutlet', 'Current Week Spending by Media Outlet', `${weekText} · dollars shown in thousands`)
    const top = ranked.filter((x) => x.spend > 0).slice(0, 10)
    const cols = focus && !top.includes(focus) ? [focus, ...top.slice(0, 9)] : top
    await book.table(
      ws, row,
      [{ h: 'MediaType', w: 20, f: 'text' }, { h: 'Market', w: 18, f: 'text' }, { h: 'MediaOutlet', w: 30, f: 'text' }, ...cols.map((c) => ({ h: c.name, f: 'usd' as Fmt })), { h: 'Others', f: 'usd' as Fmt }, { h: 'Total', f: 'usd' }],
      outlets.map((o) => {
        const shown = cols.reduce((a, c) => a + (o.byAdv[c.key] ?? 0), 0)
        return [o.media, o.market, o.outlet, ...cols.map((c) => o.byAdv[c.key] ?? 0), o.total - shown, o.total]
      }),
      { filter: true, freeze: true },
    )
  }

  // Creatives
  {
    const { ws, row } = book.sheet('Creatives', 'Creative List With Ad Spend and Occurrences', 'New creatives for the week are marked New · click an Ad Code to see the ad · dollars shown in thousands')
    await book.table(ws, row, CREATIVE_COLS.map((c) => (c.h === 'New/Carryover' ? { ...c, h: 'New This Week' } : c)), creativeRows(ads, input.appUrl, week).map((r) => { r[2] = r[2] === 'New' ? 'New' : ''; return r }), { filter: true, freeze: true })
  }

  // Detail: the week's occurrences.
  {
    const { ws, row } = book.sheet('Detail', 'Occurrence List', `${weekText} · ${occ.more ? `the latest ${ROW_CAP.toLocaleString('en-US')} rows · ` : ''}dollars shown in thousands`)
    await book.table(
      ws, row,
      [{ h: 'Advertiser', w: 34, f: 'text' }, { h: 'Ad Code', w: 14, f: 'text' }, { h: 'Media', w: 18, f: 'text' }, { h: 'Title', w: 40, f: 'text' }, { h: 'Subcategory', w: 26, f: 'text' }, { h: 'Product/Campaign', w: 34, f: 'text' }, { h: 'Market', w: 18, f: 'text' }, { h: 'RunDate', w: 12, f: 'text' }, { h: 'MediaOutlet', w: 28, f: 'text' }, { h: 'AdSpend', f: 'usd' }, { h: '1stRunDate', w: 12, f: 'text' }, { h: 'Occ.Count', f: 'int' }],
      occ.rows.map((o) => [o.advertiser, adLink(input.appUrl, o.creative), o.media, o.title, o.subcategory, o.product, o.market, o.date, o.outlet, o.spend, o.firstSeen, o.occ]),
      { filter: true, freeze: true },
    )
  }

  // AdvertiserQuickPivot
  {
    const { ws, row } = book.sheet('AdvertiserQuickPivot', 'Sum of AdSpend by Advertiser', `${periodText} · dollars shown in thousands`)
    const list = [...ranked].sort((a, b) => a.name.localeCompare(b.name))
    await book.table(ws, row, [{ h: whoLabel(who), w: 40, f: 'text' }, { h: 'Total', f: 'usd' }], [...list.map((x) => [x.name, x.trend.reduce((a, b) => a + b, 0)]), ['Grand Total', totals.reduce((a, b) => a + b, 0)]], { kinds: [...list.map(() => undefined), 'total'], freeze: true })
  }

  await pivotDetail(book, det, true)

  book.notes(
    [['Media:', mediaParam(input.scope)], ['Week:', weekText], ['Project start date:', fullDate(start)], ['Advertiser level:', whoLabel(who)], ...(input.focusName ? [['Focus advertiser:', input.focusName] as [string, string]] : [])],
    [
      ['Dashboard', 'The week at a glance: position against the leader, trend, shifts and rankings'],
      ['WeekAtAGlance', 'Spending and share of voice this week against last week, by product'],
      ['SpendingTrend', 'Weekly spending history by product'],
      ['WeeklyMediaUsage', 'Media usage for the week'],
      ['MediaTrendSummary', 'Weekly media usage by advertiser'],
      ['MediaOutlet', 'Weekly spending by media outlet'],
      ['Creatives', 'Creatives in the period, with this week\'s new ones marked'],
      ['Detail', 'The week\'s occurrences'],
      ['AdvertiserQuickPivot', 'Advertiser totals'],
      ['PivotTableDetail', 'The table the pivots are built from'],
    ],
  )
  return book.done()
}

/** A file name like today's: "Hospitals-Health-Systems-Clinics-SummaryReport-202610.xlsx". */
export function fileName(node: TaxNode, kind: string, stamp: string) {
  return `${node.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${kind}-${stamp}.xlsx`
}

export const _test = { productBlock, monthEnd, weekIso }
