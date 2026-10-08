/**
 * Meeting series rules, opened with the series they were built for: the IS
 * with GPC working sessions of the week of 6 October 2026.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  baseMeetingName,
  bucketOf,
  changeLine,
  derivedCheck,
  inSeries,
  latestChange,
  nextSession,
  sessionDay,
  shortDay,
  type SeriesItem,
} from '../src/lib/series'

const NAMES = ['Working Sessions: Insights Studio with GPC', 'Keystone SoS', 'Insights Studio with GPC/GEC']

test('a session title belongs by its name without the date or the Meet suffix', () => {
  assert.equal(baseMeetingName('Working Sessions: Insights Studio with GPC - 2026/10/08 08:29 EDT'), 'Working Sessions: Insights Studio with GPC')
  assert.equal(baseMeetingName('Keystone SoS - 2026/10/08 10:30 EDT - Notes by Gemini'), 'Keystone SoS')
  assert.equal(sessionDay('Keystone SoS - 2026/10/08 10:30 EDT'), '2026-10-08')
  assert.equal(sessionDay('Insights Studio with GPC/GEC'), null, 'a running doc has no session date')
  assert.ok(inSeries('keystone sos - 2026/10/06 10:29 EDT', NAMES))
  assert.ok(inSeries('Insights Studio with GPC/GEC', NAMES))
  assert.ok(!inSeries('GPC into Insights Studio Daily SoS - 2026/10/05 10:30 EDT', NAMES), 'a different meeting with a similar name')
  assert.ok(!inSeries(null, NAMES))
})

test('daily sessions: after Thursday 10/8 the next one is Friday 10/9, and after Friday it is Monday', () => {
  assert.equal(nextSession(['2026-10-06', '2026-10-07', '2026-10-08'], '2026-10-08'), '2026-10-09')
  assert.equal(nextSession(['2026-10-07', '2026-10-08', '2026-10-09'], '2026-10-09'), '2026-10-12')
  assert.equal(shortDay('2026-10-09'), 'Fri 10/9')
})

test('a weekly sync is a week on, and a gap that has passed rolls forward', () => {
  assert.equal(nextSession(['2026-09-24', '2026-10-01'], '2026-10-02'), '2026-10-08')
  assert.equal(nextSession(['2026-09-24', '2026-10-01'], '2026-10-09'), '2026-10-15')
  assert.equal(nextSession([], '2026-10-08'), null)
})

const since = '2026-10-08'
const base: SeriesItem = {
  kind: 'action',
  ref: 'A408',
  title: 'Notify Rohan to provide credentials for the multi-node ClickHouse environment',
  href: '/actions?focus=A408',
  status: 'open',
  open: true,
  owner: 'Mukesh Kumar',
  dueDate: null,
  createdAt: new Date('2026-10-07T17:40:00Z'),
  closedAt: null,
  mergedInto: null,
  source: 'Working Sessions: Insights Studio with GPC - 2026/10/07 08:30 EDT',
  events: [],
}

test('the four sections, relative to the start of the last session day', () => {
  assert.equal(bucketOf({ ...base, createdAt: new Date('2026-10-08T15:00:00Z'), source: 'Working Sessions: Insights Studio with GPC - 2026/10/08 08:29 EDT' }, since), 'new')
  assert.equal(bucketOf({ ...base, open: false, status: 'done', closedAt: new Date('2026-10-08T20:00:00Z') }, since), 'resolved')
  assert.equal(bucketOf({ ...base, open: false, status: 'done', closedAt: new Date('2026-10-06T20:00:00Z') }, since), null, 'closed before: not news')
  assert.equal(bucketOf(base, since), 'quiet')
  const changed = { ...base, events: [{ kind: 'changed', at: new Date('2026-10-08T14:41:00Z'), source: 'Keystone SoS - 2026/10/08 10:30 EDT', url: null, note: 'Server to the app team Monday', changes: [{ field: 'dueDate', from: null, to: '2026-10-12' }] }] }
  assert.equal(bucketOf(changed, since), 'changed')
  assert.equal(changeLine(latestChange(changed, since)), 'Due set to "2026-10-12"')
})

test('a merged duplicate appears nowhere', () => {
  assert.equal(bucketOf({ ...base, ref: 'A441', mergedInto: 'A408', open: false, status: 'dropped' }, since), null)
})

test('a reminder being sent or a score moving is not anybody discussing it', () => {
  const nudged = { ...base, events: [{ kind: 'nudged', at: new Date('2026-10-08T12:30:00Z'), source: null, url: null, note: null, changes: [] }] }
  assert.equal(bucketOf(nudged, since), 'quiet')
})

test('next check: overdue, then unowned, then due, then a plain question', () => {
  const today = '2026-10-08'
  assert.equal(derivedCheck({ ...base, dueDate: new Date('2026-10-07T00:00:00Z') }, 'quiet', today), 'Overdue since Wed 10/7')
  assert.equal(derivedCheck({ ...base, owner: 'The group' }, 'quiet', today), 'Needs an owner')
  assert.equal(derivedCheck({ ...base, dueDate: new Date('2026-10-09T00:00:00Z') }, 'new', today), 'Due Fri 10/9')
  assert.equal(derivedCheck(base, 'quiet', today), 'Status?')
  assert.equal(derivedCheck({ ...base, kind: 'blocker' }, 'changed', today), 'Still blocked?')
  assert.equal(derivedCheck({ ...base, open: false }, 'resolved', today), null)
})

test('the 10/7 notes filed after midnight are still from 10/7: when is the session, not the filing', () => {
  const filedLate = {
    ...base,
    createdAt: new Date('2026-10-08T00:40:00Z'),
    events: [{ kind: 'raised', at: new Date('2026-10-08T00:40:00Z'), source: base.source, url: null, note: null, changes: [] }],
  }
  assert.equal(bucketOf(filedLate, since), 'quiet')
  const cameUpAgainFromOldNotes = { ...base, events: [{ kind: 'updated', at: new Date('2026-10-08T00:40:00Z'), source: base.source, url: null, note: 'Came up again.', changes: [] }] }
  assert.equal(bucketOf(cameUpAgainFromOldNotes, since), 'quiet')
})

test('a long change is clipped to stay scannable', () => {
  const line = changeLine({ kind: 'changed', at: new Date(), source: null, url: null, note: null, changes: [{ field: 'title', from: 'x'.repeat(200), to: 'short' }] })!
  assert.ok(line.length < 100)
  assert.match(line, /…" → "short"/)
})
