/**
 * Tests for the logic that would otherwise fail silently.
 *
 * Deliberately no UI tests and no database: these cover the rules that decide
 * what a number on screen *means* — whether an edit survives a sync, whether
 * an unassessed project reads as green, whether a signature check can be
 * bypassed. Those are the failures nobody notices until a decision has already
 * been made on bad information.
 *
 *   npm test
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

import { resolveHealth, computeScore, TSHIRT_WEEKS } from '../src/lib/domain'
import { applyOverrides, overrideSurvivesSourceChange, type OverrideMap } from '../src/lib/merge'
import { parseCsv, rowsToObjects, csvUrlFor } from '../src/lib/sources/csv'
import { verifySlackSignature, parseSlackIntake } from '../src/lib/sources/slack-protocol'
import { mapProjectStatus, mapInitiativeStatus } from '../src/lib/sources/linear-map'
import { nextRef, slugify } from '../src/lib/util'

// ---------------------------------------------------------------------------

describe('health resolution', () => {
  test('an unassessed item with no source value is unknown, never green', () => {
    const h = resolveHealth({ sourceHealth: null, assessment: null })
    assert.equal(h.rag, 'unknown')
    assert.equal(h.origin, 'none')
  })

  test('a human assessment beats the source', () => {
    const h = resolveHealth({
      sourceHealth: 'onTrack',
      assessment: { rag: 'red', rationale: 'BiS feed has no ETA' },
    })
    assert.equal(h.rag, 'red')
    assert.equal(h.origin, 'assessed')
  })

  test('disagreement between source and assessment is flagged, not hidden', () => {
    const h = resolveHealth({
      sourceHealth: 'onTrack',
      assessment: { rag: 'red', rationale: 'x' },
    })
    assert.equal(h.conflict, true)
  })

  test('agreement is not flagged as a conflict', () => {
    const h = resolveHealth({
      sourceHealth: 'atRisk',
      assessment: { rag: 'amber', rationale: 'x' },
    })
    assert.equal(h.conflict, false)
  })

  test('source health is used when nobody has assessed', () => {
    const h = resolveHealth({ sourceHealth: 'offTrack', assessment: null })
    assert.equal(h.rag, 'red')
    assert.equal(h.origin, 'source')
  })

  test('an unrecognised assessment value degrades to unknown rather than throwing', () => {
    const h = resolveHealth({ sourceHealth: null, assessment: { rag: 'chartreuse', rationale: 'x' } })
    assert.equal(h.rag, 'unknown')
  })
})

// ---------------------------------------------------------------------------

describe('override merge', () => {
  const makeMap = (field: string, value: unknown, reason = 'board-locked'): OverrideMap =>
    new Map([
      [
        'project:p1',
        new Map([
          [
            field,
            {
              entityType: 'project',
              entityId: 'p1',
              field,
              value: JSON.stringify(value),
              reason,
              pinned: true,
              updatedAt: new Date(),
            },
          ],
        ]),
      ],
    ])

  test('a manual value replaces the synced one and is reported as overridden', () => {
    const row = { id: 'p1', name: 'GPC', status: 'backlog' }
    const merged = applyOverrides(row, 'project', makeMap('status', 'in_progress'))
    assert.equal(merged.value.status, 'in_progress')
    assert.ok(merged.overridden.has('status'))
  })

  test('the original source value is preserved so both can be shown', () => {
    const row = { id: 'p1', name: 'GPC', status: 'backlog' }
    const merged = applyOverrides(row, 'project', makeMap('status', 'in_progress'))
    assert.equal(merged.sourceValues.status, 'backlog')
    assert.equal(merged.reasons.status, 'board-locked')
  })

  test('date fields come back as real Dates, not JSON strings', () => {
    const row = { id: 'p1', targetDate: new Date('2026-10-05') }
    const merged = applyOverrides(row, 'project', makeMap('targetDate', '2026-11-20'), ['targetDate'])
    assert.ok(merged.value.targetDate instanceof Date)
    assert.equal(merged.value.targetDate.toISOString().slice(0, 10), '2026-11-20')
  })

  test('an override for a field the row does not have is ignored', () => {
    const row = { id: 'p1', name: 'GPC' }
    const merged = applyOverrides(row, 'project', makeMap('nonexistent', 'x'))
    assert.equal(merged.overridden.size, 0)
  })

  test('rows with no overrides pass through untouched', () => {
    const row = { id: 'p2', name: 'Other' }
    const merged = applyOverrides(row, 'project', makeMap('status', 'x'))
    assert.equal(merged.value, row)
    assert.equal(merged.overridden.size, 0)
  })

  test('reconciliation: pinned survives a source change, unpinned yields', () => {
    assert.equal(overrideSurvivesSourceChange({ pinned: true }, true), true)
    assert.equal(overrideSurvivesSourceChange({ pinned: false }, true), false)
    // A sync that did not touch the field must not clear the correction.
    assert.equal(overrideSurvivesSourceChange({ pinned: false }, false), true)
  })
})

// ---------------------------------------------------------------------------

describe('scoring', () => {
  const criteria = [
    { id: 'c1', key: 'value', weight: 3, direction: 'benefit', scaleMin: 1, scaleMax: 5 },
    { id: 'c2', key: 'effort', weight: 2, direction: 'cost', scaleMin: 1, scaleMax: 5 },
  ]

  test('a cost criterion pushes the score down', () => {
    const cheap = computeScore(criteria, { c1: 4, c2: 1 })
    const pricey = computeScore(criteria, { c1: 4, c2: 5 })
    assert.ok(cheap.score! > pricey.score!)
  })

  test('unscored criteria are excluded rather than counted as zero', () => {
    const partial = computeScore(criteria, { c1: 5 })
    assert.equal(partial.scored, 1)
    assert.equal(partial.total, 2)
    // Scoring only the max-value criterion must read as 100, not 60.
    assert.equal(partial.score, 100)
  })

  test('a fully unscored request has no score at all', () => {
    const none = computeScore(criteria, {})
    assert.equal(none.score, null)
  })

  test('values outside the scale are clamped, not extrapolated', () => {
    assert.equal(computeScore(criteria, { c1: 99 }).score, 100)
    assert.equal(computeScore(criteria, { c1: -5 }).score, 0)
  })

  test('t-shirt sizes are monotonic, so the cut line cannot invert', () => {
    const order = ['xs', 's', 'm', 'l', 'xl'] as const
    for (let i = 1; i < order.length; i++) {
      assert.ok(TSHIRT_WEEKS[order[i]] > TSHIRT_WEEKS[order[i - 1]])
    }
  })
})

// ---------------------------------------------------------------------------

describe('CSV ingestion', () => {
  test('a comma inside a quoted field does not split the row', () => {
    const rows = parseCsv('name,status\n"Migrations, phase 2",active')
    assert.deepEqual(rows[1], ['Migrations, phase 2', 'active'])
  })

  test('escaped quotes survive', () => {
    const rows = parseCsv('name\n"He said ""go"""')
    assert.equal(rows[1][0], 'He said "go"')
  })

  test('blank rows are dropped', () => {
    assert.equal(parseCsv('a,b\n1,2\n\n,\n3,4').length, 3)
  })

  test('headers map onto objects', () => {
    const objs = rowsToObjects(parseCsv('Project,Target\nGPC,2026-10-05'))
    assert.deepEqual(objs, [{ Project: 'GPC', Target: '2026-10-05' }])
  })

  test('a sheet URL becomes a CSV export URL, keeping the gid', () => {
    const url = csvUrlFor('https://docs.google.com/spreadsheets/d/ABC123/edit?gid=570899029#gid=570899029')
    assert.ok(url.includes('/spreadsheets/d/ABC123/export?format=csv'))
    assert.ok(url.includes('gid=570899029'))
  })

  test('a non-Sheets URL is passed through untouched', () => {
    assert.equal(csvUrlFor('https://example.com/data.csv'), 'https://example.com/data.csv')
  })
})

// ---------------------------------------------------------------------------

describe('Slack signature verification', () => {
  const secret = 'test-secret'
  const body = 'token=x&text=hello'
  const sign = (ts: number, b = body) =>
    `v0=${createHmac('sha256', secret).update(`v0:${ts}:${b}`).digest('hex')}`

  test('a correct signature passes', () => {
    const now = Date.now()
    const ts = Math.floor(now / 1000)
    assert.equal(
      verifySlackSignature({ rawBody: body, timestamp: String(ts), signature: sign(ts), secret, now }),
      true,
    )
  })

  test('a tampered body fails', () => {
    const now = Date.now()
    const ts = Math.floor(now / 1000)
    assert.equal(
      verifySlackSignature({
        rawBody: 'token=x&text=evil',
        timestamp: String(ts),
        signature: sign(ts),
        secret,
        now,
      }),
      false,
    )
  })

  test('an old timestamp is rejected, so captured requests cannot be replayed', () => {
    const now = Date.now()
    const ts = Math.floor(now / 1000) - 600
    assert.equal(
      verifySlackSignature({ rawBody: body, timestamp: String(ts), signature: sign(ts), secret, now }),
      false,
    )
  })

  test('missing headers fail closed', () => {
    assert.equal(
      verifySlackSignature({ rawBody: body, timestamp: null, signature: null, secret }),
      false,
    )
  })

  test('a signature of the wrong length fails without throwing', () => {
    const ts = Math.floor(Date.now() / 1000)
    assert.equal(
      verifySlackSignature({ rawBody: body, timestamp: String(ts), signature: 'v0=short', secret }),
      false,
    )
  })
})

describe('Slack intake parsing', () => {
  test('pipes split title, problem and sponsor', () => {
    const r = parseSlackIntake('Add LinkedIn | Clients keep asking | Brad')
    assert.deepEqual(r, { title: 'Add LinkedIn', problem: 'Clients keep asking', sponsor: 'Brad' })
  })

  test('a bare title still parses, so the request is not lost', () => {
    const r = parseSlackIntake('Add LinkedIn')
    assert.equal(r.title, 'Add LinkedIn')
    assert.equal(r.problem, '')
    assert.equal(r.sponsor, null)
  })
})

// ---------------------------------------------------------------------------

describe('Linear value mapping', () => {
  test('both the legacy state string and the newer status type map to our vocabulary', () => {
    assert.equal(mapProjectStatus('started', null), 'in_progress')
    assert.equal(mapProjectStatus(null, 'started'), 'in_progress')
    assert.equal(mapProjectStatus('completed', null), 'completed')
    assert.equal(mapProjectStatus('cancelled', null), 'canceled')
  })

  test('the status object wins over the legacy string when both are present', () => {
    assert.equal(mapProjectStatus('backlog', 'completed'), 'completed')
  })

  test('an unknown state falls back to backlog rather than throwing', () => {
    assert.equal(mapProjectStatus('something-new', null), 'backlog')
    assert.equal(mapInitiativeStatus(undefined), 'planned')
  })
})

// ---------------------------------------------------------------------------

describe('utilities', () => {
  test('refs increment past the highest existing number', () => {
    assert.equal(nextRef('REQ-', ['REQ-001', 'REQ-009', 'REQ-002']), 'REQ-010')
  })

  test('the first ref is generated from an empty list', () => {
    assert.equal(nextRef('REQ-', []), 'REQ-001')
  })

  test('slugify strips accents and punctuation', () => {
    assert.equal(slugify('Créative Central (Avo Toast)'), 'creative-central-avo-toast')
  })
})

describe('brief parsing', () => {
  // These rules are the difference between a summary a reader can check and a
  // machine-written paragraph that sounds authoritative. All of them fail
  // silently if they regress: the page still renders, it is just no longer
  // traceable.
  const allowed = new Set(['t1', 't2'])

  test('a well-formed item survives', async () => {
    const { parseItems } = await import('../src/lib/summarize')
    const { items } = parseItems(
      '{"items":[{"kind":"decision","text":"Cutover moved to 15 Oct","sourceTranscriptIds":["t1"]}]}',
      allowed,
    )
    assert.equal(items.length, 1)
    assert.equal(items[0].kind, 'decision')
    assert.deepEqual(items[0].sourceTranscriptIds, ['t1'])
  })

  test('an uncited bullet is dropped, not shown', async () => {
    const { parseItems } = await import('../src/lib/summarize')
    const { items, warnings } = parseItems(
      '{"items":[{"kind":"risk","text":"Something might go wrong","sourceTranscriptIds":[]}]}',
      allowed,
    )
    assert.equal(items.length, 0)
    assert.equal(warnings.length, 1)
  })

  test('a citation to a transcript that was not sent is discarded', async () => {
    // Guards against the model inventing an id, which would render a bullet
    // whose "from" line points at nothing.
    const { parseItems } = await import('../src/lib/summarize')
    const { items } = parseItems(
      '{"items":[{"kind":"risk","text":"x","sourceTranscriptIds":["made-up"]}]}',
      allowed,
    )
    assert.equal(items.length, 0)
  })

  test('an unknown category is refused', async () => {
    const { parseItems } = await import('../src/lib/summarize')
    const { items } = parseItems(
      '{"items":[{"kind":"vibes","text":"x","sourceTranscriptIds":["t1"]}]}',
      allowed,
    )
    assert.equal(items.length, 0)
  })

  test('prose around the JSON is tolerated', async () => {
    const { parseItems } = await import('../src/lib/summarize')
    const { items } = parseItems(
      'Here you go:\n{"items":[{"kind":"change","text":"Date moved","sourceTranscriptIds":["t2"]}]}\nHope that helps.',
      allowed,
    )
    assert.equal(items.length, 1)
  })

  test('the bullet count is capped', async () => {
    const { parseItems } = await import('../src/lib/summarize')
    const many = Array.from({ length: 20 }, (_, i) => ({
      kind: 'risk',
      text: `risk ${i}`,
      sourceTranscriptIds: ['t1'],
    }))
    const { items } = parseItems(JSON.stringify({ items: many }), allowed)
    assert.equal(items.length, 8)
  })

  test('malformed output raises rather than rendering nothing quietly', async () => {
    const { parseItems, SummariseError } = await import('../src/lib/summarize')
    assert.throws(() => parseItems('not json at all', allowed), SummariseError)
  })
})

describe('transcript budgeting', () => {
  const make = (id: string, days: number, length: number) => ({
    id,
    kind: 'meeting',
    title: `meeting ${id}`,
    occurredAt: new Date(Date.now() - days * 864e5),
    body: 'x'.repeat(length),
  })

  test('newest conversations are kept when everything does not fit', async () => {
    // Dropping this week's meeting to make room for one from March would be
    // worse than covering less and saying so. Five full-size transcripts
    // exceed the total budget, so the oldest must be the one left behind.
    const { budget } = await import('../src/lib/summarize')
    const { used, warnings } = budget([
      make('oldest', 120, 40_000),
      make('old', 90, 40_000),
      make('mid', 60, 40_000),
      make('recent', 10, 40_000),
      make('newest', 1, 40_000),
    ])
    assert.equal(used[0].id, 'newest')
    assert.ok(used.length < 5)
    assert.ok(!used.some((t) => t.id === 'oldest'))
    assert.ok(warnings.some((w) => w.includes('left out')))
  })

  test('an oversized transcript is truncated and the reader is told', async () => {
    const { budget } = await import('../src/lib/summarize')
    const { used, warnings } = budget([make('huge', 1, 90_000)])
    assert.ok(used[0].body.length <= 40_000)
    assert.ok(warnings.some((w) => w.includes('truncated')))
  })
})
