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
 * Pure but for the logo, read once from public/brand.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
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

export async function xlsxFile(result: Result, meta: FileMeta): Promise<Buffer> {
  const g = grid(result)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Report Builder'
  wb.created = meta.completed
  const ws = wb.addWorksheet('Report')
  const bold = { bold: true }
  const xl = (v: unknown, t: Column['type']) => (t === 'text' ? (v ?? '') : num(v) == null ? null : t === 'pct' || t === 'change' ? num(v)! / 100 : num(v))

  ws.getCell(1, Math.min(3, g.cols.length)).value = meta.title
  ws.getCell(1, Math.min(3, g.cols.length)).font = bold
  ws.getCell('A5').value = 'Report Completed:'
  ws.getCell('B5').value = stamp(meta.completed)
  ws.getCell('A6').value = 'Reported Time Period:'
  ws.getCell('B6').value = periodSpan(result.period.start, result.period.end)
  ws.getCell('A5').font = ws.getCell('A6').font = bold

  const head = ws.getRow(8)
  g.cols.forEach((c, i) => {
    head.getCell(i + 1).value = c.head
    head.getCell(i + 1).font = bold
  })
  const put = (rowNo: number, values: unknown[], isTotal: boolean) => {
    const row = ws.getRow(rowNo)
    values.forEach((v, i) => {
      const c = g.cols[i]!
      const cell = row.getCell(i + 1)
      cell.value = xl(v, c.type) as ExcelJS.CellValue
      if (XL_FORMAT[c.type]) cell.numFmt = XL_FORMAT[c.type]!
      if (isTotal) cell.font = bold
    })
  }
  g.rows.forEach((r, i) => put(9 + i, r, false))
  if (g.total) put(9 + g.rows.length, g.total, true)
  g.cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.type === 'text' ? (i === 0 ? 24 : 36) : Math.max(14, Math.min(24, c.head.length + 2))
  })
  ws.views = [{ state: 'frozen', ySplit: 8 }]

  // Summary: what the report is.
  const sm = wb.addWorksheet('Summary')
  sm.getColumn(1).width = 30
  sm.getColumn(2).width = 60
  sm.getColumn(3).width = 60
  let n = 5
  const line = (a: string, b = '', c = '', strong = false) => {
    const r = sm.getRow(n++)
    r.getCell(1).value = a
    r.getCell(2).value = b
    if (c) r.getCell(3).value = c
    if (strong) r.getCell(1).font = bold
    r.getCell(2).alignment = r.getCell(3).alignment = { wrapText: true, vertical: 'top' }
  }
  line('Report Title:', meta.title, '', true)
  if (meta.owner) line('Report Owner:', meta.owner, '', true)
  line('Report Completed:', stamp(meta.completed), '', true)
  line('Reported Time Period:', `${periodSpan(result.period.start, result.period.end)} (${result.period.label})`, '', true)
  line('Data Through:', result.data_through_label, '', true)
  n++
  line('Layout', '', '', true)
  for (const s of meta.summary) line(`  ${s.label}`, s.value)
  if (result.notes.length) {
    n++
    line('Notes', '', '', true)
    for (const t of result.notes) line('', t)
  }
  if (meta.imported) {
    n++
    line('Imported from 360', `${meta.imported.client} › ${meta.imported.user} › ${meta.imported.report}`, '', true)
    for (const x of meta.imported.notes) line(`  ${x.impact}`, x.what, x.did)
  }
  n++
  line(COPYRIGHT(meta.completed.getFullYear()))
  return Buffer.from(await wb.xlsx.writeBuffer())
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

const PDF_FMT = (v: unknown, t: Column['type']): string => {
  if (t === 'text') return String(v ?? '')
  const n = num(v)
  if (n == null || Number.isNaN(n)) return ''
  const body = t === 'pct' || t === 'change' ? `${Math.abs(n).toFixed(1)}%` : Math.round(Math.abs(n)).toLocaleString('en-US')
  if (n < 0) return `(${body})`
  return t === 'change' && n > 0 ? `+${body}` : body
}

export async function pdfFile(result: Result, meta: FileMeta): Promise<Uint8Array> {
  const g = grid(result)
  const doc = await PDFDocument.create()
  doc.setTitle(meta.title)
  doc.setCreator('Report Builder')
  const roman = await doc.embedFont(StandardFonts.TimesRoman)
  const boldF = await doc.embedFont(StandardFonts.TimesRomanBold)
  const png = logo()
  const img: PDFImage | null = png ? await doc.embedPng(png).catch(() => null) : null

  const W = 792
  const H = 612
  const M = 21.6
  const SIZE = 6
  const LINE = 7.04 // 360's row pitch
  const black = rgb(0, 0, 0)

  // Widths: breakouts share what the measures leave, measures fit their widest figure.
  const measureIdx = g.cols.map((_, i) => i).filter((i) => i >= g.dims)
  const measureW = measureIdx.map((i) => {
    const values = [...g.rows.slice(0, 2000).map((r) => r[i]), g.total?.[i]].map((v) => PDF_FMT(v, g.cols[i]!.type))
    const widest = Math.max(roman.widthOfTextAtSize(g.cols[i]!.measure, SIZE), ...values.map((s) => roman.widthOfTextAtSize(s, SIZE)))
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

  const fit = (s: string, w: number, f: PDFFont) => {
    if (f.widthOfTextAtSize(s, SIZE) <= w) return s
    let t = s
    while (t.length > 1 && f.widthOfTextAtSize(t + '…', SIZE) > w) t = t.slice(0, -1)
    return t + '…'
  }
  const text = (p: PDFPage, s: string, at: number, y: number, f: PDFFont, size = SIZE) => p.drawText(s.replace(/[^\x20-\x7E -ÿ…]/g, '?'), { x: at, y, size, font: f, color: black })
  const textRight = (p: PDFPage, s: string, edge: number, y: number, f: PDFFont) => text(p, s, edge - f.widthOfTextAtSize(s, SIZE), y, f)

  // Column groups (periods) for the two-line heading.
  const groups: Array<{ name: string; from: number; to: number }> = []
  for (const i of measureIdx) {
    const name = g.cols[i]!.group ?? ''
    const last = groups[groups.length - 1]
    if (last && last.name === name) last.to = i
    else groups.push({ name, from: i, to: i })
  }

  const pages: PDFPage[] = []
  let page!: PDFPage
  let y = 0
  const newPage = () => {
    page = doc.addPage([W, H])
    pages.push(page)
    if (img) page.drawImage(img, { x: M, y: H - M - 23, width: 23, height: 23 })
    text(page, 'MediaRadar', M + 28, H - M - 15, boldF, 10)
    text(page, meta.title, (W - boldF.widthOfTextAtSize(meta.title, 10)) / 2, H - M - 9, boldF, 10)
    y = H - 75
    // Heading: the periods over their measures, the breakouts named together.
    for (const gr of groups) {
      if (!gr.name) continue
      const mid = (xs[gr.from]! + (gr.to + 1 < xs.length ? xs[gr.to + 1]! : right)) / 2
      text(page, gr.name, mid - boldF.widthOfTextAtSize(gr.name, SIZE) / 2, y, boldF)
      page.drawLine({ start: { x: xs[gr.from]! + 2, y: y - 2 }, end: { x: (gr.to + 1 < xs.length ? xs[gr.to + 1]! : right) - 2, y: y - 2 }, thickness: 0.5, color: black })
    }
    y -= LINE + 2
    text(page, fit(g.cols.slice(0, g.dims).map((c) => c.measure).join('/'), dimW * Math.max(1, g.dims) - 4, boldF), M, y, boldF)
    for (const i of measureIdx) textRight(page, g.cols[i]!.measure, (i + 1 < xs.length ? xs[i + 1]! : right) - 3, y, boldF)
    page.drawLine({ start: { x: M, y: y - 3 }, end: { x: right, y: y - 3 }, thickness: 0.7, color: black })
    y -= LINE + 3
  }
  const bottom = M + 30
  newPage()

  const last: unknown[] = []
  const drawRow = (r: unknown[], isTotal: boolean) => {
    if (y < bottom) {
      newPage()
      last.length = 0 // a new page names its breakouts again
    }
    const f = isTotal ? boldF : roman
    if (isTotal) page.drawRectangle({ x: M, y: y - 2, width: right - M, height: LINE + 1, color: rgb(0.843, 0.843, 0.843) })
    let changed = false
    for (let i = 0; i < g.dims; i++) {
      const v = String(r[i] ?? '')
      if (isTotal || changed || last[i] !== v) {
        changed = true
        if (v) text(page, fit(v, dimW - 4, f), xs[i]! + 1, y, f)
      }
      last[i] = v
    }
    for (const i of measureIdx) textRight(page, PDF_FMT(r[i], g.cols[i]!.type), (i + 1 < xs.length ? xs[i + 1]! : right) - 3, y, f)
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
    text(page, fit(s, W - 2 * M, roman), M, y, roman)
    y -= LINE
  }
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`
    p.drawText(label, { x: W - M - roman.widthOfTextAtSize(label, SIZE), y: M - 8, size: SIZE, font: roman, color: black })
  })
  return doc.save()
}
