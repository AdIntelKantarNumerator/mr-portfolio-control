/**
 * Report Builder files laid out like 360's (12 November 2026): CSV, Excel
 * and PDF from one run, each with the head, the flat table and a GRAND TOTAL.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import { csvFile, periodSpan, pdfFile, xlsxFile, type FileMeta } from '../src/lib/report-builder/export/files'
import type { Result } from '../src/lib/report-builder/engine'

const markets = ['National', 'Abilene', 'Albany, GA', 'New York']
const media = ['Network TV', 'Spot TV', 'Local Radio']
const rows: unknown[][] = []
for (const m of markets) for (const t of media) rows.push([m, 'McDonalds Restaurant', t, 1000 + rows.length * 37.5, rows.length * 3, -12.5 + rows.length])
// Enough rows for several PDF pages.
for (let i = 0; i < 160; i++) rows.push([`Market ${i}`, 'McDonalds Restaurant', 'Spot TV', i * 10, i, 0])

const RESULT: Result = {
  columns: [
    { key: 'market', label: 'Market', type: 'text' },
    { key: 'advertiser', label: 'Advertiser', type: 'text' },
    { key: 'media_type', label: 'Media type', type: 'text' },
    { key: 'c:2026-10:spend', label: 'Oct 2026 · Spend', type: 'money', colId: '2026-10', group: 'Oct 2026', measure: 'Spend' },
    { key: 'c:2026-10:occ', label: 'Oct 2026 · Occurrences', type: 'int', colId: '2026-10', group: 'Oct 2026', measure: 'Occurrences' },
    { key: 'change', label: 'Change', type: 'change' },
  ],
  rows,
  totals: ['Total', '', '', 999999.4, 1234, 5.5],
  row_count: rows.length,
  rows_shown: rows.length,
  total: 999999.4,
  total_measure: 'spend',
  period: { start: '2026-08', end: '2026-10', label: 'Aug–Oct 2026', how: 'static', moves_with_new_data: false },
  data_through: '2026-10-31',
  data_through_label: 'October 2026',
  summary: '',
  notes: ['Figures for October 2026 are preliminary and still loading.'],
}
const META: FileMeta = {
  title: 'McDonalds November',
  completed: new Date('2026-11-12T23:32:53Z'),
  summary: [{ label: 'Showing', value: 'Spend, Occurrences' }, { label: 'Broken out by', value: 'Market › Advertiser › Media type' }],
  owner: 'someone@example.com',
  imported: { client: 'Client', user: 'user_ai', report: 'McDonalds NOvember', notes: [{ impact: 'changed', what: 'Period: Nov 2024', did: 'Aug – Oct 2026' }] },
}

test('the period reads as 360 writes it', () => {
  assert.equal(periodSpan('2026-08', '2026-10'), '8/1/2026-10/31/2026')
  assert.equal(periodSpan('2024-02', '2024-02'), '2/1/2024-2/29/2024')
})

test('CSV: the head, a heading per measure under its period, every value, and a GRAND TOTAL', () => {
  const lines = csvFile(RESULT, META).replace(/^﻿/, '').split('\r\n')
  assert.equal(lines[0], ',,,McDonalds November')
  assert.equal(lines[3], 'Report Completed: 11/12/2026 06:32:53 PM ET', 'Eastern time, standard in November')
  assert.equal(lines[4], 'Reported Time Period: 8/1/2026-10/31/2026')
  assert.equal(lines[5], '"MARKET","ADVERTISER","MEDIA TYPE","Oct 2026  Spend","Oct 2026  Occurrences","Change"')
  assert.equal(lines[6], '"National","McDonalds Restaurant","Network TV",1000,0,-12.5')
  assert.ok(lines.includes('"GRAND TOTAL",,,999999.4,1234,5.5'))
})

test('Excel: a Report sheet with 360 number formats and a Summary sheet with the import changes', async () => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load((await xlsxFile(RESULT, META)) as unknown as ArrayBuffer)
  const ws = wb.getWorksheet('Report')!
  assert.equal(ws.getCell('C1').value, 'McDonalds November')
  assert.equal(ws.getCell('A8').value, 'MARKET')
  assert.equal(ws.getCell('D8').value, 'Oct 2026  Spend')
  assert.equal(ws.getCell('D9').value, 1000)
  assert.equal(ws.getCell('D9').numFmt, '#,##0;[Red](#,##0)')
  assert.equal(ws.getCell('F9').value, -0.125, 'percentages are stored as fractions, shown as %')
  const total = ws.getRow(9 + rows.length)
  assert.equal(total.getCell(1).value, 'GRAND TOTAL')
  assert.equal(total.getCell(1).font?.bold, true)
  const sm = wb.getWorksheet('Summary')!
  const text: string[] = []
  sm.eachRow((r) => text.push(r.values!.toString()))
  assert.ok(text.some((t) => t.includes('Imported from 360')))
  assert.ok(text.some((t) => t.includes('Period: Nov 2024')))
  assert.ok(text.some((t) => t.includes('Market › Advertiser › Media type')))
})

test('PDF: landscape letter pages, numbered', async () => {
  const bytes = await pdfFile(RESULT, META)
  const doc = await PDFDocument.load(bytes)
  assert.ok(doc.getPageCount() >= 3, `several pages for ${rows.length} rows`)
  const { width, height } = doc.getPage(0).getSize()
  assert.deepEqual([width, height], [792, 612])
  assert.equal(doc.getTitle(), 'McDonalds November')
})
