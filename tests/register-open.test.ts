/**
 * Which register entries are still open, and which dependencies are still live.
 *
 * THE REPORTED CASE
 *
 * A blocker about SMTP configuration was closed on the blockers page. It went
 * on being counted and listed on the home card, and clicking through to the
 * page showed a list without it — the card and the page disagreeing about the
 * same row.
 *
 * WHY IT WAS INVISIBLE
 *
 * Two status vocabularies live in this app and they share no words:
 *
 *     decisions and blockers   open | watch | decided | dropped
 *     dependencies             open | at_risk | resolved | accepted_risk
 *
 * home.ts filtered blockers with `status !== 'resolved' && status !== 'closed'`
 * — the dependency vocabulary, plus a word from neither. Because no decision
 * row is ever `resolved`, that predicate was not merely wrong, it was ALWAYS
 * TRUE: every blocker ever raised counted as open, and had since the home page
 * was written. Nothing threw, nothing logged, and the number on the card was
 * plausible, which is why it survived.
 *
 * That is the shape worth testing against. A swapped vocabulary cannot fail
 * loudly — it can only quietly stop filtering — so the tests below check the
 * disjointness that makes the swap silent, and the source guard at the bottom
 * checks that the call sites ask `domain.ts` instead of remembering.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DECISION_CLOSED,
  DECISION_STATUS,
  DEPENDENCY_SETTLED,
  DEPENDENCY_STATUS,
  isLiveDependency,
  isOpenEntry,
} from '../src/lib/domain'

test('a register entry is open until it is decided or dropped', () => {
  assert.equal(isOpenEntry('open'), true)
  assert.equal(isOpenEntry('watch'), true, 'watching is still carrying it')
  assert.equal(isOpenEntry('decided'), false)
  assert.equal(isOpenEntry('dropped'), false)
})

test('the reported case: a closed blocker is closed everywhere', () => {
  // setBlockerStatus writes one of these two and stamps resolvedAt. Both of
  // them used to survive the home page's filter.
  for (const closed of ['decided', 'dropped']) {
    assert.equal(isOpenEntry(closed), false, `${closed} counted as open on the card`)
  }
})

test('the dependency words do not close a register entry', () => {
  // The exact predicate home.ts had. Kept as a test rather than a comment
  // because the failure mode is a filter that stops filtering, and nothing
  // else in the build notices that.
  assert.equal(isOpenEntry('resolved'), true)
  assert.equal(isOpenEntry('accepted_risk'), true)
})

test('a dependency is live until it is resolved or accepted', () => {
  assert.equal(isLiveDependency('open'), true)
  assert.equal(isLiveDependency('at_risk'), true, 'at risk is the one most worth showing')
  assert.equal(isLiveDependency('resolved'), false)
  assert.equal(isLiveDependency('accepted_risk'), false)
})

test('the register words do not settle a dependency', () => {
  assert.equal(isLiveDependency('decided'), true)
  assert.equal(isLiveDependency('dropped'), true)
})

test('an absent status is open, not closed', () => {
  // A row with no status is a row somebody has not finished with. Treating
  // blank as closed would hide it, which is the more expensive mistake.
  for (const v of [null, undefined, '']) {
    assert.equal(isOpenEntry(v), true)
    assert.equal(isLiveDependency(v), true)
  }
})

test('the two vocabularies share no word — which is why a swap is silent', () => {
  const overlap = DECISION_STATUS.filter((s) => (DEPENDENCY_STATUS as readonly string[]).includes(s))
  assert.deepEqual(
    overlap,
    ['open'],
    'only `open` is common; if that changes, a swapped predicate could start throwing instead of silently passing everything',
  )
})

test('every closing word is a real word from its own vocabulary', () => {
  for (const s of DECISION_CLOSED) {
    assert.ok((DECISION_STATUS as readonly string[]).includes(s), `${s} is not a decision status`)
  }
  for (const s of DEPENDENCY_SETTLED) {
    assert.ok((DEPENDENCY_STATUS as readonly string[]).includes(s), `${s} is not a dependency status`)
  }
})

// --- the source guard ------------------------------------------------------


/**
 * The surfaces that read the register. Each one displays a count or a list
 * that has to agree with the blockers and decisions pages, and each one got
 * this wrong by writing the comparison out by hand.
 */
const SURFACES = [
  'src/lib/home.ts',
  'src/lib/detail.ts',
  'src/app/blockers/page.tsx',
  'src/app/decisions/page.tsx',
]

test('no surface writes its own open/closed comparison', () => {
  // Not style. A hand-written comparison is how all four of these drifted
  // apart in the first place, and the drift does not show up as a failure
  // anywhere else in this build.
  const offenders: string[] = []
  for (const file of SURFACES) {
    const src = readFileSync(file, 'utf8')
    for (const [i, line] of src.split('\n').entries()) {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue
      if (/status\s*[!=]==\s*'(decided|dropped|resolved|accepted_risk)'/.test(line)) {
        offenders.push(`${file}:${i + 1}  ${line.trim()}`)
      }
    }
  }
  assert.deepEqual(offenders, [], `use isOpenEntry / isLiveDependency from lib/domain:\n${offenders.join('\n')}`)
})

test('no surface compares a status against a word nothing ever writes', () => {
  // `'closed'` and `'blocked'` were both in this code and neither is a status
  // of a decision or a dependency. A comparison against an invented word is
  // dead in one direction and always-true in the other; it cannot be right
  // either way, and it is the exact shape of the bug this file exists for.
  const invented = /\bstatus\s*[!=]==\s*'(closed|blocked|complete|done)'/
  const offenders: string[] = []
  for (const file of [...SURFACES, 'src/lib/graph.ts', 'src/lib/dependency-risk.ts']) {
    const src = readFileSync(file, 'utf8')
    for (const [i, line] of src.split('\n').entries()) {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue
      // Milestones legitimately use PROJECT_STATUS words; this guard is about
      // the register and its dependencies, so only those two files' rows.
      if (/milestone|ms\b|m\.status/i.test(line)) continue
      if (invented.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`)
    }
  }
  assert.deepEqual(offenders, [], `no decision or dependency ever has these statuses:\n${offenders.join('\n')}`)
})

test('the source files still exist under the names this guard reads', () => {
  // A guard that silently reads nothing passes forever. If a surface is
  // renamed, this fails rather than the guards quietly going green.
  for (const file of SURFACES) {
    assert.ok(readFileSync(file, 'utf8').length > 0, `${file} is missing`)
  }
})
