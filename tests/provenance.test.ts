/**
 * Where an entry came from, assembled from three tables that record it three
 * different ways.
 *
 * The cases that matter are the ragged ones: a field holding a URL where a
 * name was expected, a document row that exists but has no link, an entry with
 * nothing at all. The last is the one worth being careful about — a popup that
 * comes up empty reads as a bug, and "nobody recorded a source" is a fact
 * about the entry that the reader should be told.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  hostOf,
  isUrl,
  provenanceLine,
  provenanceOfAction,
  provenanceOfEntry,
} from '../src/lib/provenance'

// --- action items -----------------------------------------------------------

test('an action item names its meeting', () => {
  const p = provenanceOfAction({
    sourceKind: 'meeting',
    sourceTitle: 'Weekly programme call',
    raisedAt: new Date('2026-09-18T09:00:00Z'),
    authoredBy: 'Yaara',
  })
  assert.equal(p.where, 'Weekly programme call')
  assert.equal(p.when, '2026-09-18')
  assert.equal(p.who, 'Yaara')
  assert.equal(p.medium, 'meeting')
  assert.equal(p.unattributed, false)
})

test('a title that is really a URL becomes the link, not the name', () => {
  // The writer had one field and put the more useful thing in it.
  const p = provenanceOfAction({ sourceTitle: 'https://docs.example.com/notes/42' })
  assert.equal(p.url, 'https://docs.example.com/notes/42')
  assert.equal(p.where, 'docs.example.com')
})

test('an action nobody attributed says so', () => {
  const p = provenanceOfAction({})
  assert.equal(p.unattributed, true)
  assert.equal(provenanceLine(p), 'No source recorded')
})

test('whitespace is not attribution', () => {
  assert.equal(provenanceOfAction({ sourceTitle: '   ', sourceUrl: '' }).unattributed, true)
})

// --- blockers and decisions -------------------------------------------------

test('the document the agent read wins over the meeting name it recorded', () => {
  const p = provenanceOfEntry({
    evidence: 'Jul 6 Leads call',
    raisedAtMeeting: 'Leads call',
    document: { title: 'Leads call — 6 Jul transcript', url: 'https://drive.example/abc' },
  })
  assert.equal(p.where, 'Leads call — 6 Jul transcript')
  assert.equal(p.url, 'https://drive.example/abc')
})

test('free-text evidence is used when nothing better exists', () => {
  const p = provenanceOfEntry({ evidence: 'CE / GPC deck' })
  assert.equal(p.where, 'CE / GPC deck')
  assert.equal(p.url, null)
  assert.equal(p.unattributed, false)
})

test('evidence holding a bare URL becomes a link, not a sentence', () => {
  // The agent API writes `document.url ?? document.title` into this field, so
  // roughly half of them are URLs.
  const p = provenanceOfEntry({ evidence: 'https://drive.example/xyz' })
  assert.equal(p.url, 'https://drive.example/xyz')
  assert.equal(p.where, 'drive.example', 'a link with no name still says where it goes')
})

test('the earliest raising is the source, not the newest mention', () => {
  const p = provenanceOfEntry({
    events: [
      { kind: 'discussed', where: 'Sep call', when: '2026-09-01', who: null, note: 'Still stuck', url: null },
      { kind: 'raised', where: 'Jul call', when: '2026-07-06', who: 'Anthony', note: 'Feed is late', url: null },
    ],
  })
  assert.equal(p.where, 'Jul call')
  assert.equal(p.when, '2026-07-06')
  assert.equal(p.who, 'Anthony')
})

test('later mentions come back newest first, and are counted', () => {
  const p = provenanceOfEntry({
    events: [
      { kind: 'raised', where: 'Jul call', when: '2026-07-06', who: null, note: null, url: null },
      { kind: 'discussed', where: 'Aug call', when: '2026-08-04', who: null, note: null, url: null },
      { kind: 'discussed', where: 'Sep call', when: '2026-09-01', who: null, note: null, url: null },
    ],
  })
  assert.deepEqual(p.later.map((m) => m.where), ['Sep call', 'Aug call'])
  assert.match(provenanceLine(p), /mentioned 3 times/)
})

test('a closed entry says where it was closed', () => {
  const p = provenanceOfEntry({
    raisedAtMeeting: 'Jul call',
    resolvedAtMeeting: 'Sep review',
    resolvedAt: new Date('2026-09-12T00:00:00Z'),
  })
  assert.deepEqual(p.closed, { where: 'Sep review', when: '2026-09-12' })
})

test('an entry with nothing recorded says so rather than showing a blank card', () => {
  const p = provenanceOfEntry({ evidence: null, raisedAtMeeting: null, events: [] })
  assert.equal(p.unattributed, true)
})

test('an entry known only to have been closed is still attributed', () => {
  // Something is better than "no source recorded", which would be wrong.
  const p = provenanceOfEntry({ resolvedAtMeeting: 'Sep review' })
  assert.equal(p.unattributed, false)
  assert.equal(p.closed?.where, 'Sep review')
})

// --- the bits ---------------------------------------------------------------

test('a URL is recognised, and a meeting name is not', () => {
  assert.ok(isUrl('https://example.com/a'))
  assert.ok(isUrl('http://example.com'))
  assert.equal(isUrl('Jul 6 Leads call'), false)
  assert.equal(isUrl('drive.google.com/file/d/1'), false, 'no scheme, so not a link we can open')
  assert.equal(isUrl(null), false)
})

test('a link is printed as its host, not as four hundred characters', () => {
  assert.equal(hostOf('https://www.drive.google.com/file/d/1abc/view?usp=sharing'), 'drive.google.com')
  assert.equal(hostOf('not a url at all'), 'not a url at all')
})

test('the one-line version reads as a sentence', () => {
  const p = provenanceOfAction({ sourceTitle: 'Weekly programme call', raisedAt: '2026-09-18', authoredBy: 'Yaara' })
  assert.equal(provenanceLine(p), 'From Weekly programme call · 2026-09-18 · Yaara')
})

// --- entered on the page ----------------------------------------------------

test('an entry typed on the page says so, rather than reading as sourceless', () => {
  // The agent API always writes raisedAtMeeting alongside what it files, so a
  // raiser with no meeting means somebody typed it here.
  const p = provenanceOfEntry({ raisedAt: '2026-09-24', raisedBy: 'Ashley' })
  assert.equal(p.enteredHere, true)
  assert.equal(p.unattributed, false)
  assert.equal(provenanceLine(p), 'Added on this page by Ashley on 2026-09-24')
})

test('a meeting name is enough to stop it being called a page entry', () => {
  const p = provenanceOfEntry({ raisedAtMeeting: 'Jul call', raisedAt: '2026-07-06', raisedBy: 'Anthony' })
  assert.equal(p.enteredHere, false)
})

test('a later mention is enough too, even with no meeting on the row', () => {
  const p = provenanceOfEntry({
    raisedBy: 'Ashley',
    events: [{ kind: 'discussed', where: 'Sep call', when: '2026-09-01', who: null, note: null, url: null }],
  })
  assert.equal(p.enteredHere, false)
})

test('an action item with only a date and an author is a page entry too', () => {
  const p = provenanceOfAction({ raisedAt: '2026-09-24', authoredBy: 'Ashley' })
  assert.equal(p.enteredHere, true)
})

test('nothing at all is not a page entry - it is nothing', () => {
  assert.equal(provenanceOfEntry({}).enteredHere, false)
  assert.equal(provenanceOfAction({}).enteredHere, false)
})

// --- the three pages actually show it ---------------------------------------

/*
 * The model can be right and the page can still not use it. These read the
 * source for the same reason tests/nav.test.ts reads hrefs: an unwrapped cell
 * is not a type error and not a failing assertion anywhere else.
 */
test('the prose column on each register opens a source card', () => {
  const pages: Array<[string, string]> = [
    ['src/app/actions/list.tsx', 'What was said'],
    ['src/components/records/register-list.tsx', 'What is in the way / What has to be decided'],
  ]
  for (const [file, column] of pages) {
    const src = readFileSync(file, 'utf8')
    assert.ok(src.includes('<SourceHover'), `${column} (${file}) does not wrap its cell`)
  }
})

test('both register pages build the provenance rather than leaving it blank', () => {
  for (const file of ['src/app/blockers/page.tsx', 'src/app/decisions/page.tsx']) {
    const src = readFileSync(file, 'utf8')
    assert.ok(src.includes('provenanceOfEntry('), `${file} does not build a source`)
    assert.ok(src.includes('decisionEvents'), `${file} does not read the mention log`)
  }
  const acts = readFileSync('src/app/actions/page.tsx', 'utf8')
  assert.ok(acts.includes('provenanceOfAction('), 'the actions page does not build a source')
})
