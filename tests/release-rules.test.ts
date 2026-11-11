/**
 * Release Calendar (Scott, 11 November 2026): Linear tickets labelled as a
 * production release, on their target dates; announced in
 * #mr-production-deployments when new and when their date moves.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addMonths, announceFor, announceKey, monthGrid, parseRelease, previousDate, rangeOf, step, weekStart } from '../src/lib/release-rules'

// MED-339, the first one: Scott's own, 7 December 2026.
const med339 = {
  linearId: 'a1b2',
  identifier: 'MED-339',
  title: 'Logo Detection in Creative Central Production Deployment',
  description: 'This impacts C&D, as well as ... Insights Studio.',
  url: 'https://linear.app/mediaradar/issue/MED-339',
  targetDate: '2026-12-07',
  status: 'Todo',
  statusType: 'unstarted',
  createdBy: 'Scott Bernberg',
  assignee: 'Anthony DiVanna',
  projectLinearId: 'p1',
  projectName: 'CC - Logo Detection',
  projectLead: 'Pavan Kumar Kanekal Yogendra Kumar',
  teamsImpacted: ['C&D', 'Insights Studio', 'C&D'],
  contactName: 'Anthony DiVanna',
  contactSlackUrl: 'https://slack.com/app_redirect?team=T04EJHD06&channel=U123',
}

test('a release is read as sent, teams de-duplicated; a bad date or a foreign link is refused or dropped', () => {
  const r = parseRelease(med339)
  assert.ok(typeof r !== 'string')
  assert.deepEqual(r.teamsImpacted, ['C&D', 'Insights Studio'])
  assert.equal(r.contactSlackUrl, med339.contactSlackUrl)
  assert.match(parseRelease({ ...med339, targetDate: '12/7/2026' }) as string, /YYYY-MM-DD/)
  assert.equal((parseRelease({ ...med339, contactSlackUrl: 'https://evil.example/x' }) as { contactSlackUrl: string | null }).contactSlackUrl, null)
  assert.match(parseRelease({ title: 'x' }) as string, /linearId/)
})

test('the reported case, INS-659: no date of its own, so its project target date stands in, and says so', () => {
  const r = parseRelease({ ...med339, identifier: 'INS-659', targetDate: '2026-11-14', targetDateFrom: 'project' })
  assert.ok(typeof r !== 'string')
  assert.equal(r.targetDate, '2026-11-14')
  assert.equal(r.targetDateFrom, 'project')
  assert.equal((parseRelease(med339) as { targetDateFrom: string }).targetDateFrom, 'ticket', 'a sender that does not say: the ticket')
  assert.equal((parseRelease({ ...med339, targetDate: null, targetDateFrom: 'project' }) as { targetDateFrom: string | null }).targetDateFrom, null)
  // Announced with "no date" before; the stand-in date is a change, and is announced.
  assert.equal(announceFor({ announcedKey: 'none' }, r), 'date')
})

test('announced once when new, again only when the date moves; never for a done or cancelled ticket', () => {
  assert.equal(announceFor(null, med339), 'new')
  assert.equal(announceFor({ announcedKey: null }, med339), 'new', 'seen but never posted: still owed')
  assert.equal(announceFor({ announcedKey: '2026-12-07' }, med339), null)
  assert.equal(announceFor({ announcedKey: '2026-12-07' }, { ...med339, targetDate: '2026-12-14' }), 'date')
  assert.equal(announceFor({ announcedKey: '2026-12-07' }, { ...med339, targetDate: null }), 'date', 'losing its date is a change')
  assert.equal(announceFor({ announcedKey: 'none' }, { ...med339, targetDate: null }), null)
  assert.equal(announceFor(null, { ...med339, statusType: 'completed' }), null)
  assert.equal(announceKey(null), 'none')
  assert.equal(previousDate({ announcedKey: '2026-12-07' }), '2026-12-07')
  assert.equal(previousDate({ announcedKey: 'none' }), null)
})

test('the default view is this month and next; month, week (Sunday first) and day are what they say', () => {
  assert.deepEqual(rangeOf('months', '2026-11-11'), { from: '2026-11-01', to: '2026-12-31' })
  assert.deepEqual(rangeOf('month', '2026-02-11'), { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(rangeOf('week', '2026-11-11'), { from: '2026-11-08', to: '2026-11-14' })
  assert.deepEqual(rangeOf('day', '2026-11-11'), { from: '2026-11-11', to: '2026-11-11' })
  assert.equal(weekStart('2026-11-08'), '2026-11-08')
})

test('back and forward: a month for the month views, across the year end; a week; a day', () => {
  assert.equal(step('months', '2026-12-20', 1), '2027-01-01')
  assert.equal(step('month', '2026-01-31', -1), '2025-12-01')
  assert.equal(step('week', '2026-11-11', 1), '2026-11-18')
  assert.equal(step('day', '2026-12-31', 1), '2027-01-01')
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
})

test('a month grid is whole weeks, Sunday first, with the days outside it blank', () => {
  const weeks = monthGrid('2026-11-11')
  assert.equal(weeks[0]![0], '2026-11-01', '1 November 2026 is a Sunday')
  assert.ok(weeks.every((w) => w.length === 7))
  assert.equal(weeks.flat().filter(Boolean).length, 30)
  assert.equal(monthGrid('2026-12-01')[0]![0], null, '1 December 2026 is a Tuesday')
})
