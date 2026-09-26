/**
 * The rules behind click-to-edit.
 *
 * These are the decisions that used to sit inside the server action, where
 * nothing could reach them without a database and a request. Each one is
 * here because getting it wrong is silent: a date that shifts a day, a
 * percentage that clamps instead of complaining, a no-op that writes a
 * changelog line saying `Platform → Platform`.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { FIELDS, isLevel, isSameValue, parseDate, parsePercent, specFor } from '../src/lib/field-rules'
import { PRIORITY, PROJECT_STATUS, WORKSTREAM_STATUS_SET } from '../src/lib/domain'

test('the editable surface', async (t) => {
  await t.test('only the two levels that have list rows', () => {
    assert.ok(isLevel('project'))
    assert.ok(isLevel('workstream'))
    assert.ok(!isLevel('initiative'))
    assert.ok(!isLevel('milestone'))
  })

  await t.test('an unknown field is not editable by accident', () => {
    assert.equal(specFor('project', 'name'), undefined)
    assert.equal(specFor('workstream', 'ownerId'), undefined)
    assert.equal(specFor('project', 'progress'), undefined)
  })

  await t.test('every vocabulary comes from domain.ts, not a second list', () => {
    // A copy here would drift, and the failure is a status the UI offers and
    // the server refuses.
    assert.deepEqual([...FIELDS.project.status!.allowed!].sort(), [...PROJECT_STATUS].sort())
    assert.deepEqual([...FIELDS.workstream.status!.allowed!].sort(), [...WORKSTREAM_STATUS_SET].sort())
    assert.deepEqual([...FIELDS.workstream.priority!.allowed!].sort(), [...PRIORITY].sort())
  })

  await t.test('nothing editable here re-parents or renames anything', () => {
    const columns = Object.values(FIELDS).flatMap((f) => Object.values(f).map((s) => s.column))
    for (const forbidden of ['name', 'key', 'projectId', 'initiativeId', 'id']) {
      assert.ok(!columns.includes(forbidden), `${forbidden} must not be editable from a list row`)
    }
  })
})

test('dates', async (t) => {
  await t.test('a typed date is that date, in UTC', () => {
    const r = parseDate('2026-11-14')
    assert.ok(r.ok)
    assert.equal(r.value!.toISOString(), '2026-11-14T00:00:00.000Z')
  })

  await t.test('clearing the field clears the column', () => {
    const r = parseDate('   ')
    assert.ok(r.ok)
    assert.equal(r.value, null)
  })

  await t.test('nonsense is refused rather than becoming Invalid Date', () => {
    assert.equal(parseDate('next tuesday').ok, false)
    assert.equal(parseDate('2026-13-40').ok, false)
  })
})

test('progress', async (t) => {
  await t.test('the ways a person types a percentage all mean the same', () => {
    for (const raw of ['80', ' 80 ', '80%', '80 %']) {
      const r = parsePercent(raw)
      assert.ok(r.ok, raw)
      assert.equal(r.value, 80, raw)
    }
  })

  await t.test('out of range is refused, not clamped', () => {
    const over = parsePercent('120')
    assert.equal(over.ok, false)
    assert.match(over.ok ? '' : over.why, /0 to 100/)
    assert.equal(parsePercent('-5').ok, false)
  })

  await t.test('empty is not zero', () => {
    // Clearing a progress box and meaning "0%" is a guess. Nothing in the UI
    // offers it, and the server should not invent it either.
    assert.equal(parsePercent('').ok, false)
    assert.equal(parsePercent('abc').ok, false)
  })

  await t.test('the ends of the scale are allowed', () => {
    assert.deepEqual(parsePercent('0'), { ok: true, value: 0 })
    assert.deepEqual(parsePercent('100'), { ok: true, value: 100 })
  })
})

test('what counts as a change', async (t) => {
  await t.test('two dates at the same instant are the same value', () => {
    assert.ok(isSameValue(new Date('2026-11-14T00:00:00Z'), new Date('2026-11-14T00:00:00Z')))
    assert.ok(!isSameValue(new Date('2026-11-14T00:00:00Z'), new Date('2026-11-15T00:00:00Z')))
  })

  await t.test('setting a date where there was none is a change, and clearing one is too', () => {
    assert.ok(!isSameValue(null, new Date('2026-11-14T00:00:00Z')))
    assert.ok(!isSameValue(new Date('2026-11-14T00:00:00Z'), null))
    assert.ok(isSameValue(null, null))
  })

  await t.test('every way of saying empty is the same emptiness', () => {
    assert.ok(isSameValue(null, undefined))
    assert.ok(isSameValue('', null))
    assert.ok(isSameValue(undefined, ''))
  })

  await t.test('re-picking the same person or status records nothing', () => {
    assert.ok(isSameValue('p_123', 'p_123'))
    assert.ok(isSameValue('active', 'active'))
    assert.ok(!isSameValue('active', 'paused'))
  })

  await t.test('zero is a value, not an absence', () => {
    assert.ok(!isSameValue(0, null))
    assert.ok(isSameValue(0, 0))
  })
})
