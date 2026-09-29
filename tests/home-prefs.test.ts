/**
 * Remembering the board, and the one rule that keeps links working.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HOME_DEFAULTS,
  parseHomePrefs,
  resolveHomePrefs,
  serialiseHomePrefs,
} from '../src/lib/home-prefs'

test('a round trip survives', () => {
  const p = { level: 'project', sort: 'name', health: 'crit' } as const
  assert.deepEqual(parseHomePrefs(serialiseHomePrefs(p)), p)
})

test('no cookie is the default board', () => {
  assert.deepEqual(parseHomePrefs(undefined), HOME_DEFAULTS)
  assert.deepEqual(parseHomePrefs(''), HOME_DEFAULTS)
})

test('a stale cookie degrades one field, not the board', () => {
  // A value written by an older build — say a sort that no longer exists —
  // must not take the level and the health filter down with it.
  const p = parseHomePrefs('project.byVibes.crit')
  assert.equal(p.level, 'project')
  assert.equal(p.sort, HOME_DEFAULTS.sort)
  assert.equal(p.health, 'crit')
})

test('junk is the default board, not a crash', () => {
  assert.deepEqual(parseHomePrefs('%%%%'), HOME_DEFAULTS)
  assert.deepEqual(parseHomePrefs('a.b.c.d.e'), HOME_DEFAULTS)
})

test('the URL beats the cookie, field by field', () => {
  // A shared link has to show the recipient the board it describes, whatever
  // their own last view was — otherwise it is not a link, it is a suggestion.
  // But only for the fields it actually names.
  const cookie = serialiseHomePrefs({ level: 'initiative', sort: 'name', health: 'crit' })
  const got = resolveHomePrefs({ level: 'project' }, cookie)
  assert.equal(got.level, 'project', 'the URL said project')
  assert.equal(got.sort, 'name', 'the URL said nothing about sort, so the cookie stands')
  assert.equal(got.health, 'crit')
})

test('an unrecognised query value falls back rather than erroring', () => {
  const got = resolveHomePrefs({ level: 'galaxy', sort: 'sideways' }, 'initiative.name.all')
  assert.equal(got.level, 'initiative')
  assert.equal(got.sort, 'name')
})
