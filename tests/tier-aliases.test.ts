/**
 * Reading a tier name from a caller that may not have been redeployed yet.
 *
 * The case worth being careful about is not the word that gets rejected, it is
 * the word that gets accepted: every old tier name is also a current tier name
 * for a DIFFERENT level. "project" meant one thing yesterday and its parent
 * today, and nothing in a payload says which. A parser that guesses files the
 * record one level off, which nobody notices until a rollup is wrong.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { LEGACY_VOCABULARY, VOCABULARY_HEADER, readTier, vocabularyOf } from '../src/lib/tier-aliases'

test("today's words are read as today's tiers", () => {
  assert.equal(readTier('project', false).tier, 'project')
  assert.equal(readTier('initiative', false).tier, 'initiative')
  assert.equal(readTier('objective', false).tier, 'objective')
})

test('a caller that declares the old vocabulary gets the old meanings', () => {
  assert.equal(readTier('workstream', true).tier, 'project')
  assert.equal(readTier('project', true).tier, 'initiative')
  assert.equal(readTier('initiative', true).tier, 'objective')
})

test('the dangerous word is read differently depending on the declaration', () => {
  // This is the whole reason the header exists. Same payload, two meanings.
  assert.equal(readTier('project', false).tier, 'project')
  assert.equal(readTier('project', true).tier, 'initiative')
})

test('a word nobody renamed passes through either way', () => {
  for (const legacy of [true, false]) {
    assert.equal(readTier('milestone', legacy).tier, 'milestone')
    assert.equal(readTier('external', legacy).tier, 'external')
  }
})

test('a retired word without the declaration is refused, and says what to do', () => {
  // Not silently mapped: a caller sending "workstream" today is stale or
  // confused, and picking a tier for it would hide that.
  const out = readTier('workstream', false)
  assert.equal(out.tier, null)
  assert.match(out.problem ?? '', /a workstream is now a project/)
  assert.match(out.problem ?? '', new RegExp(VOCABULARY_HEADER))
})

test('a word from neither vocabulary is refused in both', () => {
  assert.equal(readTier('epic', false).tier, null)
  assert.equal(readTier('epic', true).tier, null)
  assert.match(readTier('epic', true).problem ?? '', /2026-09/)
})

test('an absent level is a problem, not a silent default', () => {
  for (const v of [null, undefined, '', '   ']) {
    const out = readTier(v, false)
    assert.equal(out.tier, null)
    assert.ok(out.problem)
  }
})

test('case and padding are not something a caller should have to get right', () => {
  assert.equal(readTier('  Project  ', false).tier, 'project')
  assert.equal(readTier('WORKSTREAM', true).tier, 'project')
})

test('the header is read exactly, not loosely', () => {
  const head = (v: string | null) => new Headers(v === null ? {} : { [VOCABULARY_HEADER]: v })
  assert.equal(vocabularyOf(head(LEGACY_VOCABULARY)), true)
  assert.equal(vocabularyOf(head(` ${LEGACY_VOCABULARY} `)), true)
  assert.equal(vocabularyOf(head(null)), false)
  assert.equal(vocabularyOf(head('')), false)
  assert.equal(vocabularyOf(head('yes')), false, 'a truthy-looking value is not the version')
  assert.equal(vocabularyOf(head('2026-10')), false, 'a different version is not this one')
})
