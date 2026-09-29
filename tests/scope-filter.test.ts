/**
 * Clicking a count on the home board.
 *
 * Three things were wrong at once. A blocker linked to /decisions?ref=B-12 —
 * a page that did not exist, so a 404. A decision linked to the same missing
 * page. An action linked to /actions with no filter, so a card saying "3 open
 * actions" opened a list of ninety.
 *
 * The fix is one rule on both ends: the link carries which card it came from,
 * and the page filters to the same set the count was taken over — everything
 * at or beneath that card. These tests hold the two ends together, because a
 * link is a string and nothing else in the build checks it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { scopeFilter } from '../src/lib/scope-filter'

const objectives = [{ id: 'i1', name: 'Insights Studio GPC' }]
const initiatives = [
  { id: 'p1', name: 'ClickHouse', objectiveId: 'i1' },
  { id: 'p2', name: 'Ingest', objectiveId: 'i1' },
  { id: 'p9', name: 'Somewhere else', objectiveId: 'i9' },
]
const projects = [
  { id: 'w1', name: 'Schema', initiativeId: 'p1' },
  { id: 'w9', name: 'Unrelated', initiativeId: 'p9' },
]

test('the reported case: an objective shows what its children carry', () => {
  // "11 blockers" on an objective is eleven across everything beneath it.
  // Filtering to the objective row alone answers that link with an empty
  // list, which reads as data loss rather than as a filter.
  const f = scopeFilter('objective:i1', initiatives, projects, objectives)
  assert.ok(f.covers('i1'), 'a blocker filed on the objective itself')
  assert.ok(f.covers('p1'))
  assert.ok(f.covers('w1'))
  assert.equal(f.covers('p9'), false)
  assert.equal(f.covers('w9'), false)
})

test('an initiative scope stops at its own projects', () => {
  const f = scopeFilter('initiative:p1', initiatives, projects, objectives)
  assert.ok(f.covers('p1'))
  assert.ok(f.covers('w1'))
  assert.equal(f.covers('i1'), false, 'the objective above is not part of the initiative')
  assert.equal(f.covers('p2'), false)
})

test('a project scope is only itself', () => {
  const f = scopeFilter('project:w1', initiatives, projects, objectives)
  assert.ok(f.covers('w1'))
  assert.equal(f.covers('p1'), false)
})

test('no scope means no filtering, and no chip', () => {
  for (const raw of [null, undefined, '', 'nonsense']) {
    const f = scopeFilter(raw, initiatives, projects, objectives)
    assert.ok(f.covers('anything at all'))
    assert.equal(f.label, null, `${raw} should not draw a chip`)
  }
})

test('the chip is named after the thing clicked', () => {
  assert.equal(scopeFilter('objective:i1', initiatives, projects, objectives).label, 'Insights Studio GPC')
  assert.equal(scopeFilter('initiative:p1', initiatives, projects, objectives).label, 'ClickHouse')
  assert.equal(scopeFilter('project:w1', initiatives, projects, objectives).label, 'Schema')
})

test('a scope whose record is gone filters to nothing and says so', () => {
  // Rather than silently showing everything, which would look like the filter
  // had been ignored.
  const f = scopeFilter('initiative:deleted', initiatives, projects, objectives)
  assert.equal(f.covers('p1'), false)
  assert.equal(f.covers('deleted'), true, 'its own records, if any survive, still belong to it')
  assert.ok(f.label, 'a missing record still draws a chip')
})

test('nothing filed against anything is never covered by a scope', () => {
  const f = scopeFilter('objective:i1', initiatives, projects, objectives)
  assert.equal(f.covers(null), false)
  assert.equal(f.covers(undefined), false)
  assert.equal(f.covers(''), false)
})

// --- the other end of the link ---------------------------------------------

/** The hrefs the home cards' signals carry, read out of the source. */
function signalHrefs(): string[] {
  const src = readFileSync('src/lib/home.ts', 'utf8')
  const from = src.indexOf('const signals: Signal[] = []')
  // Stops at the tier-below links, which are dynamic routes to one record and
  // are not narrowings of a list.
  const block = src.slice(from, src.indexOf('const below', from))
  return [...block.matchAll(/href:\s*`([^`]+)`/g)].map((m) => m[1]!)
}

test('every signal link points at a page that exists', () => {
  // The 404 Scott hit: /decisions had no page.tsx at all.
  const missing = signalHrefs()
    .map((h) => h.split('?')[0]!)
    .filter((path) => !existsSync(`src/app${path}/page.tsx`))
  assert.deepEqual(missing, [], `these links would 404: ${missing.join(', ')}`)
})

test('every signal link carries its scope', () => {
  // A link without one opens the whole board, which is the bug on Action
  // items: a card counting three opened a list of ninety.
  const bare = signalHrefs().filter((h) => !h.includes('scope=${from}'))
  assert.deepEqual(bare, [], `these links would show everything: ${bare.join(', ')}`)
})

test('blockers and decisions go to their own pages', () => {
  const hrefs = signalHrefs().map((h) => h.split('?')[0])
  assert.ok(hrefs.includes('/blockers'), 'blockers linked to /decisions before')
  assert.ok(hrefs.includes('/decisions'))
  assert.ok(hrefs.includes('/actions'))
})

test('each page reads the scope it is sent', () => {
  for (const page of ['blockers', 'decisions', 'actions']) {
    const src = readFileSync(`src/app/${page}/page.tsx`, 'utf8')
    assert.ok(src.includes('scope?: string'), `${page} does not accept a scope`)
    assert.ok(src.includes('scopeFilter('), `${page} accepts a scope but ignores it`)
  }
})
