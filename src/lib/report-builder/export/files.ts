/**
 * A Report Builder report as a file, laid out the way 360 lays out its own
 * (12 November 2026): CSV, Excel and PDF.
 *
 * Scott sent 360's three outputs of one report as the model. All three
 * share a head (title, when it was completed, the period reported) and a
 * flat table: the row breakouts as text columns, one column per measure (per
 * period with a column breakout, headed "Oct 2026  Spend"), and a GRAND
 * TOTAL row. Then:
 *   - CSV: the head, the table with every value repeated, the footer lines.
 *   - Excel: a Report sheet (bold heads, 360's number formats with negatives
 *     in red brackets, fixed widths) and a Summary sheet saying what the
 *     report is - its layout, measures, selections, the data's date and, for
 *     a report imported from 360, what the import changed.
 *   - PDF: landscape letter in Times, the logo and title on every page, the
 *     period over its measures in the heading, a breakout value shown only
 *     when it changes, a grey GRAND TOTAL band, and the footer with page
 *     numbers on the last page.
 * Figures stay in Report Builder's own units (whole dollars), not 360's
 * thousands, so the file agrees with the page.
 *
 * Big reports (13 November 2026: a 40,000-row PDF failed). The web app has
 * 1.75 GB, so the files are built lean: Excel through exceljs's streaming
 * writer, row by row; PDF one compressed content stream per page, written as
 * PDF operators rather than one object per drawn string (pdf-lib is kept for
 * the document, fonts and logo). 40,000 rows then take a few seconds and a
 * fraction of the memory. The standard PDF fonts cover Western characters
 * only (WinAnsi), so every string is made safe before it is measured or
 * drawn: a Japanese name became an error before; now its letters show as "?".
 *
 * Pure but for the logo, read once from public/brand.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import ExcelJS from 'exceljs'
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Column, Result } from '../engine'

export type FileFormat = 'csv' | 'xlsx' | 'pdf'
export const FORMATS: Record<FileFormat, { ext: string; type: string }> = {
  csv: { ext: 'csv', type: 'text/csv; charset=utf-8' },
  xlsx: { ext: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pdf: { ext: 'pdf', type: 'application/pdf' },
}

/** What the files say about the report beyond its numbers. */
export interface FileMeta {
  title: string
  /** When the report was run. */
  completed: Date
  /** The Summary sheet: label and value pairs, in order (from the side panel). */
  summary: Array<{ label: string; value: string }>
  owner?: string
  /** For a report imported from 360: what the import changed. */
  imported?: { client: string; user: string; report: string; notes: Array<{ impact: string; what: string; did: string }> }
}

const COPYRIGHT = (y: number) => `Copyright ${y} MediaRadar, Inc. and affiliates. All rights reserved.`

/** "11/12/2026 07:32:53 PM ET", as 360 stamps its reports. */
export function stamp(d: Date): string {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${g('month')}/${g('day')}/${g('year')} ${g('hour')}:${g('minute')}:${g('second')} ${g('dayPeriod')} ET`
}

/** "8/1/2026-10/31/2026" from the period's first and last months (YYYY-MM). */
export function periodSpan(start: string, end: string): string {
  const [ys, ms] = start.split('-').map(Number) as [number, number]
  const [ye, me] = end.split('-').map(Number) as [number, number]
  if (!ys || !ms || !ye || !me) return `${start}-${end}`
  const last = new Date(Date.UTC(ye, me, 0)).getUTCDate()
  return `${ms}/1/${ys}-${me}/${last}/${ye}`
}

// ---------------------------------------------------------------- the shared table

interface Grid {
  /** Row breakouts (text columns), then measures. */
  cols: Array<{ head: string; group: string | null; measure: string; type: Column['type'] }>
  rows: unknown[][]
  total: unknown[] | null
  dims: number
}

function grid(result: Result): Grid {
  const cols = result.columns.map((c) => ({
    head: c.type === 'text' ? c.label.toUpperCase() : c.group && c.measure ? `${c.group}  ${c.measure}` : c.label,
    group: c.type === 'text' ? null : (c.group ?? null),
    measure: c.type === 'text' ? c.label.toUpperCase() : (c.measure ?? c.label),
    type: c.type,
  }))
  const dims = cols.filter((c) => c.type === 'text').length
  const total = result.totals ? result.totals.map((v, i) => (i === 0 ? 'GRAND TOTAL' : i < dims ? '' : v)) : null
  return { cols, rows: result.rows, total, dims }
}

const num = (v: unknown) => (v == null || v === '' ? null : Number(v))

// ---------------------------------------------------------------- CSV

export function csvFile(result: Result, meta: FileMeta): string {
  const g = grid(result)
  const esc = (v: unknown) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`)
  const val = (v: unknown, t: Column['type']) => (t === 'text' ? esc(v) : num(v) == null ? '' : String(num(v)))
  const lines = [`${','.repeat(Math.min(3, g.cols.length - 1))}${meta.title}`, '', '', `Report Completed: ${stamp(meta.completed)}`, `Reported Time Period: ${periodSpan(result.period.start, result.period.end)}`]
  lines.push(g.cols.map((c) => esc(c.head)).join(','))
  for (const r of g.rows) lines.push(r.map((v, i) => val(v, g.cols[i]!.type)).join(','))
  if (g.total) lines.push(g.total.map((v, i) => (i < g.dims ? (v ? esc(v) : '') : val(v, g.cols[i]!.type))).join(','))
  lines.push('', `${COPYRIGHT(meta.completed.getFullYear())} Report Builder`, `Data through ${result.data_through_label}.`, ...result.notes)
  return '﻿' + lines.join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------- Excel

/** 360's formats: whole numbers with thousands, negatives red in brackets. */
const XL_FORMAT: Record<Column['type'], string | undefined> = {
  money: '#,##0;[Red](#,##0)',
  int: '#,##0;[Red](#,##0)',
  pct: '0.0%;[Red](0.0%)',
  change: '+0.0%;[Red]-0.0%',
  text: undefined,
}

/** Written row by row through exceljs's streaming writer, so a big report never sits in memory as a workbook. */
export async function xlsxFile(result: Result, meta: FileMeta): Promise<Buffer> {
  const g = grid(result)
  const out = new PassThrough()
  const chunks: Buffer[] = []
  out.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((ok, fail) => {
    out.on('end', ok)
    out.on('error', fail)
  })
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false })
  wb.creator = 'Report Builder'
  wb.created = meta.completed
  const bold = { bold: true }
  const xl = (v: unknown, t: Column['type']) => (t === 'text' ? (v ?? '') : num(v) == null ? null : t === 'pct' || t === 'change' ? num(v)! / 100 : num(v))

  const ws = wb.addWorksheet('Report', { views: [{ state: 'frozen', ySplit: 8 }] })
  ws.columns = g.cols.map((c, i) => ({ width: c.type === 'text' ? (i === 0 ? 24 : 36) : Math.max(14, Math.min(24, c.head.length + 2)) }))
  const titleAt = Math.min(3, g.cols.length)
  const put = (values: unknown[], style?: (cell: ExcelJS.Cell, i: number) => void) => {
    const row = ws.addRow(values as ExcelJS.CellValue[])
    if (style) values.forEach((_, i) => style(row.getCell(i + 1), i))
    row.commit()
  }
  put([...Array(titleAt - 1).fill(null), meta.title], (c, i) => i === titleAt - 1 && (c.font = bold))
  put([])
  put([])
  put([])
  put(['Report Completed:', stamp(meta.completed)], (c, i) => i === 0 && (c.font = bold))
  put(['Reported Time Period:', periodSpan(result.period.start, result.period.end)], (c, i) => i === 0 && (c.font = bold))
  put([])
  put(
    g.cols.map((c) => c.head),
    (c) => (c.font = bold),
  )
  const data = (r: unknown[], isTotal: boolean) =>
    put(
      r.map((v, i) => xl(v, g.cols[i]!.type)),
      (cell, i) => {
        const f = XL_FORMAT[g.cols[i]!.type]
        if (f) cell.numFmt = f
        if (isTotal) cell.font = bold
      },
    )
  for (const r of g.rows) data(r, false)
  if (g.total) data(g.total, true)
  ws.commit()

  // Summary: what the report is.
  const sm = wb.addWorksheet('Summary')
  sm.columns = [{ width: 30 }, { width: 60 }, { width: 60 }]
  const line = (a: string, b = '', c = '', strong = false) => {
    const r = sm.addRow([a, b, c || null])
    if (strong) r.getCell(1).font = bold
    r.getCell(2).alignment = r.getCell(3).alignment = { wrapText: true, vertical: 'top' }
    r.commit()
  }
  for (let i = 0; i < 4; i++) line('')
  line('Report Title:', meta.title, '', true)
  if (meta.owner) line('Report Owner:', meta.owner, '', true)
  line('Report Completed:', stamp(meta.completed), '', true)
  line('Reported Time Period:', `${periodSpan(result.period.start, result.period.end)} (${result.period.label})`, '', true)
  line('Data Through:', result.data_through_label, '', true)
  line('')
  line('Layout', '', '', true)
  for (const s of meta.summary) line(`  ${s.label}`, s.value)
  if (result.notes.length) {
    line('')
    line('Notes', '', '', true)
    for (const t of result.notes) line('', t)
  }
  if (meta.imported) {
    line('')
    line('Imported from 360', `${meta.imported.client} › ${meta.imported.user} › ${meta.imported.report}`, '', true)
    for (const x of meta.imported.notes) line(`  ${x.impact}`, x.what, x.did)
  }
  line('')
  line(COPYRIGHT(meta.completed.getFullYear()))
  sm.commit()
  await wb.commit()
  await done
  return Buffer.concat(chunks)
}

// ---------------------------------------------------------------- PDF

let logoBytes: Uint8Array | null | undefined
function logo(): Uint8Array | null {
  if (logoBytes === undefined) {
    try {
      logoBytes = readFileSync(join(process.cwd(), 'public', 'brand', 'mediaradar.png'))
    } catch {
      logoBytes = null
    }
  }
  return logoBytes
}

/** The characters the standard PDF fonts can show (WinAnsi): printable Latin-1 and a few typographic marks. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
/** A string the standard fonts can measure and draw: full-width and compatibility forms folded, anything else "?". */
export function pdfSafe(s: string): string {
  let out = ''
  for (const ch of s.normalize('NFKC')) {
    const c = ch.codePointAt(0)!
    out += (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch) ? ch : c === 0x09 || c === 0x0a || c === 0x0d ? ' ' : '?'
  }
  return out
}

const PDF_FMT = (v: unknown, t: Column['type']): string => {
  if (t === 'text') return pdfSafe(String(v ?? ''))
  const n = num(v)
  if (n == null || Number.isNaN(n)) return ''
  const body = t === 'pct' || t === 'change' ? `${Math.abs(n).toFixed(1)}%` : Math.round(Math.abs(n)).toLocaleString('en-US')
  if (n < 0) return `(${body})`
  return t === 'change' && n > 0 ? `+${body}` : body
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toString()

export async function pdfFile(result: Result, meta: FileMeta): Promise<Uint8Array> {
  const g = grid(result)
  const doc = await PDFDocument.create()
  const title = pdfSafe(meta.title)
  doc.setTitle(meta.title)
  doc.setCreator('Report Builder')
  const roman = await doc.embedFont(StandardFonts.TimesRoman)
  const boldF = await doc.embedFont(StandardFonts.TimesRomanBold)
  const png = logo()
  const img = png ? await doc.embedPng(png).catch(() => null) : null

  const W = 792
  const H = 612
  const M = 21.6
  const SIZE = 6
  const LINE = 7.04 // 360's row pitch

  // Widths: breakouts share what the measures leave, measures fit their widest figure.
  const measureIdx = g.cols.map((_, i) => i).filter((i) => i >= g.dims)
  const measureW = measureIdx.map((i) => {
    const values = [...g.rows.slice(0, 2000).map((r) => r[i]), g.total?.[i]].map((v) => PDF_FMT(v, g.cols[i]!.type))
    const widest = Math.max(roman.widthOfTextAtSize(pdfSafe(g.cols[i]!.measure), SIZE), ...values.map((s) => roman.widthOfTextAtSize(s, SIZE)))
    return Math.max(34, widest + 8)
  })
  const room = W - 2 * M - measureW.reduce((a, b) => a + b, 0)
  const dimW = g.dims ? Math.max(60, Math.min(160, room / g.dims)) : 0
  const xs: number[] = []
  let x = M
  for (let i = 0; i < g.cols.length; i++) {
    xs.push(x)
    x += i < g.dims ? dimW : measureW[i - g.dims]!
  }
  const right = x
  const edge = (i: number) => (i + 1 < xs.length ? xs[i + 1]! : right)

  const fit = (s: string, w: number, f: PDFFont) => {
    if (f.widthOfTextAtSize(s, SIZE) <= w) return s
    let lo = 0
    let hi = s.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (f.widthOfTextAtSize(s.slice(0, mid) + '…', SIZE) <= w) lo = mid
      else hi = mid - 1
    }
    return s.slice(0, lo) + '…'
  }

  // Column groups (periods) for the two-line heading.
  const groups: Array<{ name: string; from: number; to: number }> = []
  for (const i of measureIdx) {
    const name = pdfSafe(g.cols[i]!.group ?? '')
    const last = groups[groups.length - 1]
    if (last && last.name === name) last.to = i
    else groups.push({ name, from: i, to: i })
  }

  /** One page's drawing, as PDF operators, flushed into a single compressed stream. */
  class Sheet {
    ops: string[] = []
    fonts = new Map<PDFFont, string>()
    constructor(readonly page: PDFPage) {}
    key(f: PDFFont) {
      let k = this.fonts.get(f)
      if (!k) {
        k = this.page.node.newFontDictionary('F', f.ref).toString()
        this.fonts.set(f, k)
      }
      return k
    }
    text(s: string, at: number, y: number, f: PDFFont, size = SIZE) {
      if (!s) return
      this.ops.push(`BT ${this.key(f)} ${size} Tf ${f2(at)} ${f2(y)} Td ${f.encodeText(s).toString()} Tj ET`)
    }
    textRight(s: string, edgeX: number, y: number, f: PDFFont) {
      this.text(s, edgeX - f.widthOfTextAtSize(s, SIZE), y, f)
    }
    line(x1: number, y1: number, x2: number, y2: number, w: number) {
      this.ops.push(`${w} w 0 G ${f2(x1)} ${f2(y1)} m ${f2(x2)} ${f2(y2)} l S`)
    }
    band(x0: number, y0: number, w: number, h: number) {
      this.ops.push(`0.843 g ${f2(x0)} ${f2(y0)} ${f2(w)} ${f2(h)} re f 0 g`)
    }
    image() {
      if (!img) return
      const k = this.page.node.newXObject('Im', img.ref).toString()
      this.ops.push(`q 23 0 0 23 ${M} ${f2(H - M - 23)} cm ${k} Do Q`)
    }
    flush() {
      if (!this.ops.length) return
      this.page.node.addContentStream(doc.context.register(doc.context.flateStream(this.ops.join('\n'))))
      this.ops = []
    }
  }

  const sheets: Sheet[] = []
  let sheet!: Sheet
  let y = 0
  const newPage = () => {
    sheet?.flush()
    sheet = new Sheet(doc.addPage([W, H]))
    sheets.push(sheet)
    sheet.image()
    sheet.text('MediaRadar', M + 28, H - M - 15, boldF, 10)
    sheet.text(title, (W - boldF.widthOfTextAtSize(title, 10)) / 2, H - M - 9, boldF, 10)
    y = H - 75
    // Heading: the periods over their measures, the breakouts named together.
    for (const gr of groups) {
      if (!gr.name) continue
      const mid = (xs[gr.from]! + edge(gr.to)) / 2
      sheet.text(gr.name, mid - boldF.widthOfTextAtSize(gr.name, SIZE) / 2, y, boldF)
      sheet.line(xs[gr.from]! + 2, y - 2, edge(gr.to) - 2, y - 2, 0.5)
    }
    y -= LINE + 2
    sheet.text(fit(pdfSafe(g.cols.slice(0, g.dims).map((c) => c.measure).join('/')), dimW * Math.max(1, g.dims) - 4, boldF), M, y, boldF)
    for (const i of measureIdx) sheet.textRight(pdfSafe(g.cols[i]!.measure), edge(i) - 3, y, boldF)
    sheet.line(M, y - 3, right, y - 3, 0.7)
    y -= LINE + 3
  }
  const bottom = M + 30
  newPage()

  const last: string[] = []
  const drawRow = (r: unknown[], isTotal: boolean) => {
    if (y < bottom) {
      newPage()
      last.length = 0 // a new page names its breakouts again
    }
    const f = isTotal ? boldF : roman
    if (isTotal) sheet.band(M, y - 2, right - M, LINE + 1)
    let changed = false
    for (let i = 0; i < g.dims; i++) {
      const v = pdfSafe(String(r[i] ?? ''))
      if (isTotal || changed || last[i] !== v) {
        changed = true
        if (v) sheet.text(fit(v, dimW - 4, f), xs[i]! + 1, y, f)
      }
      last[i] = v
    }
    for (const i of measureIdx) sheet.textRight(PDF_FMT(r[i], g.cols[i]!.type), edge(i) - 3, y, f)
    y -= LINE
  }
  for (const r of g.rows) drawRow(r, false)
  if (g.total) drawRow(g.total, true)

  // Footer: when, what period, copyright and notes, as 360 ends its reports.
  const foot = [
    `Report Completed: ${stamp(meta.completed)}`,
    `Reported Time Period: ${periodSpan(result.period.start, result.period.end)}`,
    `Data through ${result.data_through_label}.`,
    ...result.notes,
    COPYRIGHT(meta.completed.getFullYear()),
  ]
  y -= LINE
  for (const s of foot) {
    if (y < M + 10) newPage()
    sheet.text(fit(pdfSafe(s), W - 2 * M, roman), M, y, roman)
    y -= LINE
  }
  sheet.flush()
  sheets.forEach((p, i) => {
    const label = `Page ${i + 1} of ${sheets.length}`
    p.textRight(label, W - M, M - 8, roman)
    p.flush()
  })
  return doc.save({ objectsPerTick: 2000 })
}
