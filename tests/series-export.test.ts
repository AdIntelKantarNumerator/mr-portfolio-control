/** The Word export of a session (13 October 2026). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { buildSeriesDocx, exportFilename } from '../src/lib/series-export'

const SUMMARY = `# Keystone SoS · 2026-10-12

## Part 1: Outline
### Decisions
- Alerts are out of MVP (A12).
### Actions
| Action | Owner | Due |
|---|---|---|
| Send the ETL plan | Edward | **undated** |
`

async function text(bytes: Buffer): Promise<string> {
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
  return xml.replace(/<w:br w:type="page"\/>/g, '\n[PAGE]\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
}

test('the reported ask: one document, the summary then the next agenda on its own page', async () => {
  const doc = await text(
    await buildSeriesDocx({
      seriesName: 'IS with GPC working sessions',
      goals: 'Ship the Nov 1 MVP.',
      summary: { meeting: 'Keystone SoS', sessionDay: '2026-10-12', markdown: SUMMARY, edited: false },
      agenda: {
        forDay: '2026-10-13',
        current: true,
        generatedAt: new Date(),
        agenda: { goalCheck: 'On track for scope.', decideFirst: [{ title: 'Legacy ad code search', why: 'Blocks Nov 1 scope', refs: ['B3'] }], topics: [{ title: 'Filters', why: '', refs: [], minutes: 15 }], flags: [] },
      },
      pageUrl: 'https://p.example/series/x',
    }),
  )
  const summaryAt = doc.indexOf('Meeting summary')
  const pageAt = doc.indexOf('[PAGE]')
  const agendaAt = doc.indexOf('Proposed agenda for the next meeting')
  assert.ok(summaryAt >= 0 && summaryAt < pageAt && pageAt < agendaAt, 'summary, page break, agenda')
  assert.match(doc, /Alerts are out of MVP \(A12\)\./)
  assert.match(doc, /Send the ETL plan/)
  assert.match(doc, /Tuesday, October 13, 2026/)
  assert.match(doc, /1\. Legacy ad code search {2}\(B3\)/)
  assert.match(doc, /Filters · 15 min/)
  assert.match(doc, /Ship the Nov 1 MVP\./)
})

test('a series with nothing written yet still exports, and says so', async () => {
  const doc = await text(await buildSeriesDocx({ seriesName: 'S', goals: null, summary: null, agenda: null, pageUrl: null }))
  assert.match(doc, /No session has been summarised yet/)
  assert.match(doc, /No agenda has been written yet/)
})

test('the file is named for the series and the session', () => {
  assert.equal(exportFilename('IS with GPC working sessions', '2026-10-12'), 'IS-with-GPC-working-sessions-2026-10-12.docx')
  assert.equal(exportFilename('***', null), 'meeting-series.docx')
})
